import { Router, type IRouter, type Request, type Response } from "express";
import { Client as SSHClient } from "ssh2";
import { connectDB, UserModel } from "@workspace/db";

const router: IRouter = Router();

const FS_HOST         = process.env.FREESWITCH_DOMAIN      ?? "";
const FS_SSH_PORT     = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22", 10);
const FS_SSH_USER     = process.env.FREESWITCH_SSH_USER    ?? "ubuntu";
const FS_STORAGE_DIR  = process.env.FREESWITCH_STORAGE_DIR ?? "/usr/local/freeswitch/storage";

// Recordings are stored under <storage_dir>/recordings/calls/
// (matching the dialplan's $${recordings_dir}/calls/ path where
//  $${recordings_dir} = <storage_dir>/recordings by FreeSWITCH convention).
const RECORDINGS_DIR = process.env.FREESWITCH_RECORDINGS_DIR
  ?? `${FS_STORAGE_DIR}/recordings/calls`;

function cleanKey(raw: string): string {
  const normalized = raw.replace(/\\n/g, "\n");
  return normalized.split("\n").map((l) => l.trimStart()).join("\n").trim();
}

function requireAuth(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return (req as any).user.id as string;
}

function sshConnect(): Promise<SSHClient> {
  const rawKey = process.env.FREESWITCH_SSH_KEY;
  if (!rawKey)  throw new Error("FREESWITCH_SSH_KEY not configured");
  if (!FS_HOST) throw new Error("FREESWITCH_DOMAIN not configured");
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    conn.on("ready", () => resolve(conn));
    conn.on("error", reject);
    conn.connect({
      host: FS_HOST, port: FS_SSH_PORT, username: FS_SSH_USER,
      privateKey: cleanKey(rawKey), readyTimeout: 10_000,
    });
  });
}

function execCommand(conn: SSHClient, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) { reject(err); return; }
      let out = ""; let errOut = "";
      stream.on("data", (d: Buffer) => { out += d.toString(); });
      stream.stderr.on("data", (d: Buffer) => { errOut += d.toString(); });
      stream.on("close", (code: number) => {
        if (code === 0) resolve(out.trim());
        else reject(new Error(errOut.trim() || `Exit code ${code}`));
      });
    });
  });
}

function safeRelPath(p: unknown): string {
  if (typeof p !== "string") throw new Error("path must be a string");
  const s = p.trim();
  if (!s) throw new Error("path is required");
  if (s.includes("..") || s.startsWith("/") || s.startsWith("\\")) throw new Error("Invalid path");
  if (!/^[a-zA-Z0-9_\-/.]+$/.test(s)) throw new Error("Invalid path");
  return s;
}

async function getUserExtension(userId: string): Promise<number> {
  await connectDB();
  const user = await UserModel.findById(userId).select("extension").lean();
  const ext = user?.extension;
  if (!ext) throw new Error("No FreeSWITCH extension assigned to this account");
  return ext;
}

/* ── GET /api/recordings ─────────────────────────────────────────────────────
   Returns call recordings where the authenticated user's extension appears
   as either the caller or the callee.
   Filename format (set in the dialplan):
     call_<from>_<to>_<uuid>.wav
   Results are limited to the 100 most recent recordings.
──────────────────────────────────────────────────────────────────────────── */
router.get("/recordings", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  let ext: number;
  try { ext = await getUserExtension(userId); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }

  let conn: SSHClient | null = null;
  try {
    conn = await sshConnect();

    // Find WAV files where this extension is either the caller (call_EXT_*)
    // or the callee (call_*_EXT_*).  The -printf outputs: <epoch> <size> <path>
    const listCmd =
      `set -e; ` +
      `if [ ! -d '${RECORDINGS_DIR}' ]; then echo ''; exit 0; fi; ` +
      `find '${RECORDINGS_DIR}' -maxdepth 1 -type f -name 'call_*.wav' ` +
      `\\( -name 'call_${ext}_*' -o -name 'call_*_${ext}_*' \\) ` +
      `-printf '%T@ %s %f\n' 2>/dev/null | sort -nr | head -100`;

    const listOut = await execCommand(conn, listCmd);
    const lines = listOut ? listOut.split("\n").filter(Boolean) : [];

    const recordings = lines.map((line) => {
      const parts = line.trim().split(" ");
      const ts       = parseFloat(parts[0] ?? "0");
      const size     = parseInt(parts[1] ?? "0", 10);
      const filename = parts.slice(2).join(" ");

      // Parse call_<from>_<to>_<uuid>.wav
      const match = filename.match(/^call_(\d+)_(\d+)_(.+)\.wav$/);
      const from  = match?.[1] ?? "unknown";
      const to    = match?.[2] ?? "unknown";
      const uuid  = match?.[3] ?? "";

      return {
        id:        filename,
        path:      filename,
        createdAt: new Date(Math.floor(ts * 1000)).toISOString(),
        size,
        from,
        to,
        uuid,
        direction: String(ext) === from ? "outbound" : "inbound",
      };
    });

    res.json({ extension: ext, recordings });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to list recordings" });
  } finally { conn?.end(); }
});

/* ── GET /api/recordings/file?path=<filename> ────────────────────────────────
   Streams the raw WAV audio for a call recording.
   The caller must own the recording (their extension must appear as from or to
   in the filename) to prevent information disclosure.
──────────────────────────────────────────────────────────────────────────── */
router.get("/recordings/file", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  let ext: number;
  try { ext = await getUserExtension(userId); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }

  let relPath: string;
  try { relPath = safeRelPath(req.query.path); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }

  // Validate ownership: extension must appear as caller or callee in filename
  const match = relPath.match(/^call_(\d+)_(\d+)_/);
  if (!match || (match[1] !== String(ext) && match[2] !== String(ext))) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const fullPath = `${RECORDINGS_DIR}/${relPath}`;
  let conn: SSHClient | null = null;
  try {
    conn = await sshConnect();
    const b64 = await execCommand(conn, `set -e; test -f '${fullPath}' && base64 -w0 '${fullPath}'`);
    const buf  = Buffer.from(b64, "base64");
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Content-Disposition", `attachment; filename="${relPath}"`);
    res.setHeader("Accept-Ranges", "bytes");
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to fetch recording" });
  } finally { conn?.end(); }
});

export default router;
