/**
 * Media health watchdog — detects no-RTP bridges and terminates them.
 *
 * After CHANNEL_BRIDGE fires, FreeSWITCH establishes a two-way audio channel.
 * However, the bridge can succeed at the signalling level (SIP 200 OK) while
 * no actual RTP packets flow (codec mismatch, firewall, ICE failure, etc.).
 *
 * This module:
 *   1. Arms a timer (default 8 s) after each CHANNEL_BRIDGE event
 *   2. Queries `uuid_dump` via ESL bgapi to read media_ms and rtp_packets_received
 *   3. If both are 0, terminates both legs and emits a media_timeout CallEvent
 *
 * Env vars:
 *   MEDIA_WATCHDOG_MS    — grace period after bridge before checking (default 8000 ms)
 *   MEDIA_WATCHDOG_OFF   — set to "true" to disable (useful for bare-SIP testing)
 */

import { appendCallEvent } from "./callEventLog";
import { metrics } from "./metrics";
import { logger } from "./logger";
import { connectDB, CallModel } from "@workspace/db";

const MEDIA_WATCHDOG_MS  = parseInt(process.env.MEDIA_WATCHDOG_MS  ?? "8000", 10);
const MEDIA_WATCHDOG_OFF = process.env.MEDIA_WATCHDOG_OFF === "true";

/** Active watchdog timers: callId → timer handle */
const watchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** ESL bgapi awaitable — injected at startup to avoid circular imports */
type BgapiAwaitable = (cmd: string) => Promise<string>;
let bgapiAwait: BgapiAwaitable | null = null;

/** ESL send-command — injected at startup */
let eslCommandFn: ((cmd: string) => void) | null = null;

export function setMediaWatchdogEsl(
  bgapi: BgapiAwaitable,
  cmd: (c: string) => void,
): void {
  bgapiAwait = bgapi;
  eslCommandFn = cmd;
}

function sendEslCmd(cmd: string): void {
  if (eslCommandFn) eslCommandFn(cmd);
}

/** Cancel watchdog for a call (call ended normally before timer fired). */
export function cancelMediaWatchdog(fsCallId: string): void {
  const t = watchdogTimers.get(fsCallId);
  if (t) { clearTimeout(t); watchdogTimers.delete(fsCallId); }
}

export function clearAllMediaWatchdogs(): void {
  for (const t of watchdogTimers.values()) clearTimeout(t);
  watchdogTimers.clear();
}

/**
 * Parse `uuid_dump` output into a key-value map.
 * Output format: "Key: Value\n" (one per line).
 */
function parseUuidDump(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const colon = line.indexOf(": ");
    if (colon === -1) continue;
    result[line.slice(0, colon).trim()] = line.slice(colon + 2).trim();
  }
  return result;
}

/**
 * Arm the media watchdog for a newly-bridged call.
 *
 * @param fsCallId    The A-leg UUID (key used in watchdogTimers)
 * @param otherLegId  The B-leg UUID (used to kill both legs if needed)
 * @param callId      MongoDB call _id (for event logging)
 * @param userId      MongoDB user _id (for event logging)
 */
export function armMediaWatchdog(
  fsCallId: string,
  otherLegId: string | undefined,
  callId: string,
  userId: string,
): void {
  if (MEDIA_WATCHDOG_OFF || !fsCallId) return;
  if (!bgapiAwait) {
    logger.warn({ fsCallId }, "[MediaWatchdog] bgapi not injected yet — watchdog skipped");
    return;
  }

  cancelMediaWatchdog(fsCallId);

  const timer = setTimeout(() => {
    watchdogTimers.delete(fsCallId);
    void checkRtp(fsCallId, otherLegId, callId, userId);
  }, MEDIA_WATCHDOG_MS);

  watchdogTimers.set(fsCallId, timer);
  logger.debug(
    { fsCallId, otherLegId, watchdogMs: MEDIA_WATCHDOG_MS },
    "[MediaWatchdog] Armed",
  );
}

async function checkRtp(
  fsCallId: string,
  otherLegId: string | undefined,
  callId: string,
  userId: string,
): Promise<void> {
  if (!bgapiAwait) return;

  try {
    const raw = await bgapiAwait(`uuid_dump ${fsCallId}`);

    // If the channel is gone, uuid_dump returns -ERR — call already ended
    if (raw.startsWith("-ERR") || raw.startsWith("-USAGE")) {
      logger.debug({ fsCallId }, "[MediaWatchdog] Channel already gone — no action needed");
      return;
    }

    const dump = parseUuidDump(raw);

    const mediaMs        = parseInt(dump["variable_media_ms"]           ?? "0", 10);
    const rtpRecv        = parseInt(dump["variable_rtp_packets_received"] ?? "0", 10);
    const rtpSent        = parseInt(dump["variable_rtp_packets_sent"]     ?? "0", 10);
    const codec          = dump["variable_rtp_use_codec_name"]           ?? "unknown";
    const iceState       = dump["variable_ice_state"]                    ?? "unknown";
    const candidatePair  = dump["variable_rtp_use_candidate_ip"]        ?? "unknown";
    const answerState    = dump["variable_answer_state"]                  ?? "";

    const ctx = { fsCallId, callId, mediaMs, rtpRecv, rtpSent, codec, iceState, candidatePair };

    // If the call is no longer answered/bridged, do nothing — it ended already
    if (answerState && answerState !== "answered" && answerState !== "early") {
      logger.debug({ ...ctx, answerState }, "[MediaWatchdog] Call no longer active — skip");
      return;
    }

    logger.info(ctx, "[MediaWatchdog] RTP check result");

    if (mediaMs === 0 && rtpRecv === 0) {
      // No audio at all — kill both legs
      logger.error(
        { ...ctx },
        "[MediaWatchdog] NO RTP after bridge — killing call with MEDIA_TIMEOUT",
      );

      sendEslCmd(`uuid_kill ${fsCallId} MEDIA_TIMEOUT`);
      if (otherLegId && otherLegId !== fsCallId) {
        sendEslCmd(`uuid_kill ${otherLegId} MEDIA_TIMEOUT`);
      }

      metrics.rtpFailures++;

      // Mark call failed in DB (best-effort — CHANNEL_HANGUP_COMPLETE will also fire)
      try {
        await connectDB();
        await CallModel.findOneAndUpdate(
          { _id: callId, endedAt: null, status: { $nin: ["failed", "ended", "completed", "missed", "cancelled", "rejected", "voicemail"] } },
          {
            $set: {
              status:      "failed",
              endedAt:     new Date(),
              failReason:  "No RTP audio detected within 8 s of bridge — possible codec/firewall/ICE issue",
              hangupCause: "MEDIA_TIMEOUT",
            },
          },
        );
      } catch (dbErr) {
        logger.warn({ dbErr, callId }, "[MediaWatchdog] DB update failed — HANGUP_COMPLETE will finalize");
      }

      appendCallEvent({
        callId,
        fsCallId,
        userId,
        event: "media_timeout",
        metadata: { mediaMs, rtpRecv, rtpSent, codec, iceState, candidatePair, watchdogMs: MEDIA_WATCHDOG_MS },
      }).catch(() => {});

    } else {
      logger.debug({ ...ctx }, "[MediaWatchdog] RTP OK — media flowing");
    }
  } catch (err) {
    logger.error({ err, fsCallId, callId }, "[MediaWatchdog] Check failed");
  }
}
