/**
 * Conference (group call) routes.
 *
 * Conference rooms use FreeSWITCH mod_conference. The dialplan routes
 * destinations matching /^(conf\d{4})$/ into the conference application.
 *
 * Rooms are persisted to MongoDB so they survive API restarts.
 * A 4-hour TTL index on the ConferenceRoom collection auto-purges stale rooms.
 *
 * Workflow:
 *   1. Caller POSTs /api/conference with their active callId.
 *      The backend looks up fsCallId → ESL uuid_transfer moves the A-leg
 *      into the conference room.
 *   2. Caller POSTs /api/conference/:roomId/invite with an extension or phone.
 *      The backend issues an ESL originate into the same room.
 *   3. Creator DELETEs /api/conference/:roomId to kick all members and dissolve.
 *   4. Creator can kick individual members, mute/unmute, and lock/unlock.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import mongoose from "mongoose";
import { connectDB, CallModel, UserModel } from "@workspace/db";
import { sendEslBgapiAwait } from "../lib/freeswitchESL";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Persistent conference room model ─────────────────────────────────────────
// Defined inline to avoid changes to the shared @workspace/db package.
// MongoDB TTL index auto-deletes rooms after 4 hours, preventing zombie rooms
// from accumulating after API crashes without ever sending a DELETE request.

const RoomSchema = new mongoose.Schema(
  {
    roomId:        { type: String, required: true, unique: true, index: true },
    creatorUserId: { type: String, required: true },
    callId:        { type: String, default: null },
    isLocked:      { type: Boolean, default: false },
  },
  { timestamps: true },
);
// TTL: auto-delete documents 4 hours after createdAt
RoomSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14_400 });

const RoomModel: mongoose.Model<any> =
  (mongoose.models["ConferenceRoom"] as mongoose.Model<any>) ??
  mongoose.model("ConferenceRoom", RoomSchema);

// ── In-memory fast-access cache ───────────────────────────────────────────────

interface RoomEntry {
  createdAt:     number;
  creatorUserId: string;
  callId?:       string;
  isLocked:      boolean;
}

const activeRooms = new Map<string, RoomEntry>();

/**
 * Seed the in-memory cache from MongoDB on module load.
 * This ensures conference rooms survive API restarts — rooms that were active
 * before a restart are immediately available without any re-creation step.
 */
async function restoreRoomsFromDB(): Promise<void> {
  try {
    await connectDB();
    const docs = await RoomModel.find({}).lean();
    for (const d of docs as any[]) {
      activeRooms.set(d.roomId, {
        createdAt:     d.createdAt instanceof Date ? d.createdAt.getTime() : Date.now(),
        creatorUserId: d.creatorUserId,
        callId:        d.callId ?? undefined,
        isLocked:      d.isLocked ?? false,
      });
    }
    if (docs.length > 0) {
      logger.info({ count: docs.length }, "[Conference] Rooms restored from MongoDB after restart");
    }
  } catch (err) {
    logger.warn({ err }, "[Conference] Could not restore rooms from DB — starting with empty map");
  }
}
restoreRoomsFromDB().catch(() => {});

/** Upsert a room record in MongoDB (fire-and-forget). */
function persistRoom(roomId: string, entry: RoomEntry): void {
  connectDB()
    .then(() =>
      RoomModel.findOneAndUpdate(
        { roomId },
        {
          roomId,
          creatorUserId: entry.creatorUserId,
          callId:        entry.callId ?? null,
          isLocked:      entry.isLocked,
        },
        { upsert: true, new: true },
      ),
    )
    .catch((err) => logger.warn({ err, roomId }, "[Conference] Room persistence failed"));
}

/** Remove a room from both the in-memory cache and MongoDB (fire-and-forget). */
function removeRoom(roomId: string): void {
  activeRooms.delete(roomId);
  connectDB()
    .then(() => RoomModel.deleteOne({ roomId }))
    .catch((err) => logger.warn({ err, roomId }, "[Conference] Room deletion from DB failed"));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return (req as any).user.id;
}

function generateRoomId(): string {
  const n = 1000 + Math.floor(Math.random() * 9000);
  return `conf${n}`;
}

interface ConferenceMember {
  memberId: string;
  channel:  string;
  uuid:     string;
  caller:   string;
  flags:    string;
}

/**
 * Parse `conference <roomId> list` ESL output into structured member objects.
 *
 * ESL line format: id;channel;uuid;caller;ext;flags
 * Example:  0;sofia/internal/1001@domain;uuid-xxx;1001;1001;hear|speak|floor
 */
function parseConferenceList(raw: string): ConferenceMember[] {
  const members: ConferenceMember[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("Conference ") || trimmed.startsWith("+")) continue;
    const parts = trimmed.split(";");
    if (parts.length >= 4) {
      members.push({
        memberId: parts[0].trim(),
        channel:  parts[1]?.trim() ?? "",
        uuid:     parts[2]?.trim() ?? "",
        caller:   parts[3]?.trim() ?? "",
        flags:    parts[5]?.trim() ?? "",
      });
    }
  }
  return members;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/conference
 * Create a conference room. If `callId` is provided the caller's current
 * A-leg is transferred into the conference immediately via ESL uuid_transfer.
 *
 * Body:   { callId?: string }
 * Returns { roomId, confExtension, transferred: boolean }
 */
router.post("/conference", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const { callId } = req.body as { callId?: string };

  let roomId = generateRoomId();
  while (activeRooms.has(roomId)) roomId = generateRoomId();

  const entry: RoomEntry = {
    createdAt:     Date.now(),
    creatorUserId: userId,
    callId:        callId ?? undefined,
    isLocked:      false,
  };
  activeRooms.set(roomId, entry);

  let transferred = false;

  if (callId) {
    await connectDB();
    const call = await CallModel.findOne({ _id: callId, userId })
      .select("fsCallId")
      .lean();

    if (call?.fsCallId) {
      const result = await sendEslBgapiAwait(
        `uuid_transfer ${call.fsCallId} ${roomId} XML prawwplus`,
        8_000,
      );
      transferred = result.startsWith("+OK");
      if (!transferred) {
        logger.warn(
          { roomId, fsCallId: call.fsCallId, result },
          "[Conference] uuid_transfer failed — caller may need to dial in manually",
        );
      }
    }
  }

  persistRoom(roomId, entry);
  logger.info({ roomId, userId, callId, transferred }, "[Conference] Room created");
  res.json({ roomId, confExtension: roomId, transferred });
});

/**
 * GET /api/conference/:roomId
 * Return current room info including member count, member list, and lock status.
 */
router.get("/conference/:roomId", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const roomId = String(req.params.roomId);
  const room = activeRooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: "Conference room not found" });
    return;
  }

  const listResult = await sendEslBgapiAwait(`conference ${roomId} list`, 4_000);
  const members = parseConferenceList(listResult);

  res.json({
    roomId,
    memberCount: members.length,
    members,
    isLocked:  room.isLocked,
    createdAt: room.createdAt,
  });
});

/**
 * GET /api/conference/:roomId/members
 * Detailed participant list for real-time UI display (polling or after invite).
 */
router.get("/conference/:roomId/members", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const roomId = String(req.params.roomId);
  const room = activeRooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: "Conference room not found" });
    return;
  }

  const listResult = await sendEslBgapiAwait(`conference ${roomId} list`, 4_000);
  const members = parseConferenceList(listResult);

  res.json({ roomId, members, isLocked: room.isLocked });
});

/**
 * POST /api/conference/:roomId/invite
 * Originate a call from the conference into an extension or PSTN number.
 * Blocked when room is locked.
 *
 * Body:   { extension?: number; phone?: string }
 * Returns { success: boolean }
 */
router.post("/conference/:roomId/invite", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const roomId = String(req.params.roomId);
  const { extension, phone } = req.body as { extension?: number; phone?: string };

  const room = activeRooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: "Conference room not found" });
    return;
  }

  if (room.creatorUserId !== userId) {
    res.status(403).json({ error: "Only the conference creator can invite participants" });
    return;
  }

  if (room.isLocked) {
    res.status(403).json({ error: "Conference is locked — no new participants can be invited" });
    return;
  }

  if (!extension && !phone) {
    res.status(400).json({ error: "extension or phone is required" });
    return;
  }

  const fsDomain = process.env.FREESWITCH_DOMAIN ?? "localhost";
  let endpoint: string;
  let callerIdNumber: string;

  if (extension) {
    await connectDB();
    const user = await UserModel.findOne({ extension: Number(extension) })
      .select("phone name")
      .lean();
    callerIdNumber = (user as any)?.phone ?? String(extension);
    endpoint = `{origination_caller_id_number=${callerIdNumber}}user/${extension}@${fsDomain}`;
  } else {
    callerIdNumber = phone!;
    const gateway = (process.env.PSTN_GATEWAY_NAME ?? "").trim();
    if (!gateway) {
      res.status(400).json({
        error: "PSTN gateway not configured; only internal extensions can be invited",
      });
      return;
    }
    endpoint = `{origination_caller_id_number=${callerIdNumber}}sofia/gateway/${gateway}/${phone}`;
  }

  const originateCmd = `originate ${endpoint} &conference(${roomId}@default)`;
  const result = await sendEslBgapiAwait(originateCmd, 30_000);
  const success = result.startsWith("+OK");

  logger.info({ roomId, extension, phone, success, result }, "[Conference] Invite originated");

  if (!success) {
    res.status(502).json({ error: "Failed to invite participant", detail: result });
    return;
  }

  res.json({ success: true });
});

/**
 * DELETE /api/conference/:roomId/member/:memberId
 * Kick a specific participant by their numeric conference member ID.
 * Creator only.
 */
router.delete("/conference/:roomId/member/:memberId", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const roomId   = String(req.params.roomId);
  const memberId = String(req.params.memberId);

  const room = activeRooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: "Conference room not found" });
    return;
  }

  if (room.creatorUserId !== userId) {
    res.status(403).json({ error: "Only the conference creator can kick participants" });
    return;
  }

  if (!/^\d+$/.test(memberId)) {
    res.status(400).json({ error: "memberId must be a numeric conference member ID" });
    return;
  }

  const result  = await sendEslBgapiAwait(`conference ${roomId} kick ${memberId}`, 5_000);
  const success = !result.startsWith("-ERR");

  logger.info({ roomId, memberId, result }, "[Conference] Member kicked");
  res.json({ success });
});

/**
 * POST /api/conference/:roomId/member/:memberId/mute
 * Mute a specific participant. Creator only.
 */
router.post(
  "/conference/:roomId/member/:memberId/mute",
  async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const roomId   = String(req.params.roomId);
    const memberId = String(req.params.memberId);

    const room = activeRooms.get(roomId);
    if (!room) {
      res.status(404).json({ error: "Conference room not found" });
      return;
    }

    if (room.creatorUserId !== userId) {
      res.status(403).json({ error: "Only the conference creator can mute participants" });
      return;
    }

    if (!/^\d+$/.test(memberId)) {
      res.status(400).json({ error: "memberId must be a numeric conference member ID" });
      return;
    }

    const result  = await sendEslBgapiAwait(`conference ${roomId} mute ${memberId}`, 5_000);
    const success = !result.startsWith("-ERR");

    logger.info({ roomId, memberId, result }, "[Conference] Member muted");
    res.json({ success, muted: true });
  },
);

/**
 * DELETE /api/conference/:roomId/member/:memberId/mute
 * Unmute a specific participant. Creator only.
 */
router.delete(
  "/conference/:roomId/member/:memberId/mute",
  async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const roomId   = String(req.params.roomId);
    const memberId = String(req.params.memberId);

    const room = activeRooms.get(roomId);
    if (!room) {
      res.status(404).json({ error: "Conference room not found" });
      return;
    }

    if (room.creatorUserId !== userId) {
      res.status(403).json({ error: "Only the conference creator can unmute participants" });
      return;
    }

    if (!/^\d+$/.test(memberId)) {
      res.status(400).json({ error: "memberId must be a numeric conference member ID" });
      return;
    }

    const result  = await sendEslBgapiAwait(`conference ${roomId} unmute ${memberId}`, 5_000);
    const success = !result.startsWith("-ERR");

    logger.info({ roomId, memberId, result }, "[Conference] Member unmuted");
    res.json({ success, muted: false });
  },
);

/**
 * POST /api/conference/:roomId/lock
 * Lock the conference — further originate invites are rejected. Creator only.
 */
router.post("/conference/:roomId/lock", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const roomId = String(req.params.roomId);
  const room = activeRooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: "Conference room not found" });
    return;
  }

  if (room.creatorUserId !== userId) {
    res.status(403).json({ error: "Only the conference creator can lock the conference" });
    return;
  }

  const result = await sendEslBgapiAwait(`conference ${roomId} lock`, 5_000);
  room.isLocked = true;
  persistRoom(roomId, room);

  logger.info({ roomId, result }, "[Conference] Room locked");
  res.json({ success: true, isLocked: true });
});

/**
 * DELETE /api/conference/:roomId/lock
 * Unlock the conference. Creator only.
 */
router.delete("/conference/:roomId/lock", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const roomId = String(req.params.roomId);
  const room = activeRooms.get(roomId);
  if (!room) {
    res.status(404).json({ error: "Conference room not found" });
    return;
  }

  if (room.creatorUserId !== userId) {
    res.status(403).json({ error: "Only the conference creator can unlock the conference" });
    return;
  }

  const result = await sendEslBgapiAwait(`conference ${roomId} unlock`, 5_000);
  room.isLocked = false;
  persistRoom(roomId, room);

  logger.info({ roomId, result }, "[Conference] Room unlocked");
  res.json({ success: true, isLocked: false });
});

/**
 * DELETE /api/conference/:roomId
 * Kick all members and dissolve the conference room. Creator only.
 */
router.delete("/conference/:roomId", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const roomId = String(req.params.roomId);
  const room = activeRooms.get(roomId);

  if (!room) {
    res.status(404).json({ error: "Conference room not found" });
    return;
  }

  if (room.creatorUserId !== userId) {
    res.status(403).json({ error: "Only the conference creator can end the conference" });
    return;
  }

  const result = await sendEslBgapiAwait(`conference ${roomId} kick all`, 5_000);
  removeRoom(roomId);

  logger.info({ roomId, userId, result }, "[Conference] Room ended");
  res.json({ success: true });
});

export default router;
