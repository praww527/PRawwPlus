/**
 * Conference (group call) routes.
 *
 * Conference rooms use FreeSWITCH mod_conference.  The dialplan routes
 * destinations matching /^(conf\d{4})$/ into the conference application.
 *
 * Workflow:
 *   1. Caller POSTs /api/conference with their active callId.
 *      The backend looks up fsCallId → ESL uuid_transfer moves the A-leg
 *      into the conference room.
 *   2. Caller POSTs /api/conference/:roomId/invite with an extension or phone.
 *      The backend issues an ESL originate into the same room.
 *   3. Any participant (or the creator) DELETEs /api/conference/:roomId to
 *      kick all members and dissolve the room.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { connectDB, CallModel, UserModel } from "@workspace/db";
import { sendEslBgapiAwait } from "../lib/freeswitchESL";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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

interface RoomEntry {
  createdAt:     number;
  creatorUserId: string;
  callId?:       string;
}

const activeRooms = new Map<string, RoomEntry>();

/**
 * POST /api/conference
 * Create a conference room.  If `callId` is provided the caller's current
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

  activeRooms.set(roomId, { createdAt: Date.now(), creatorUserId: userId, callId });

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

  logger.info({ roomId, userId, callId, transferred }, "[Conference] Room created");
  res.json({ roomId, confExtension: roomId, transferred });
});

/**
 * GET /api/conference/:roomId
 * Return current room info (exists / member count via ESL).
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
  const memberCount = (listResult.match(/^Member/gm) ?? []).length;

  res.json({ roomId, memberCount, createdAt: room.createdAt });
});

/**
 * POST /api/conference/:roomId/invite
 * Originate a call from the conference into an extension or PSTN number.
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
      res.status(400).json({ error: "PSTN gateway not configured; only internal extensions can be invited" });
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
 * DELETE /api/conference/:roomId
 * Kick all members and dissolve the conference room.
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
  activeRooms.delete(roomId);

  logger.info({ roomId, userId, result }, "[Conference] Room ended");
  res.json({ success: true });
});

export default router;
