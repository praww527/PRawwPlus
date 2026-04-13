import { Router, type IRouter, type Request, type Response } from "express";
import { Client as SSHClient } from "ssh2";
import { connectDB, UserModel } from "@workspace/db";

const router: IRouter = Router();

const FS_HOST        = process.env.FREESWITCH_DOMAIN    ?? "";
const FS_SSH_PORT    = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22", 10);
const FS_SSH_USER    = process.env.FREESWITCH_SSH_USER  ?? "ubuntu";
const FS_STORAGE_DIR = process.env.FREESWITCH_STORAGE_DIR ?? "/usr/local/freeswitch/storage";

function cleanKey(raw: string): string {
  let s = raw.trim();

  // Handle literal \n escape sequences stored in env vars
  if (s.includes("\\n")) {
    s = s.replace(/\\n/g, "\n");
  }

  // Handle keys stored as a single line with spaces replacing newlines.
  // Extract header/footer so their internal spaces are preserved, then
  // reformat the base64 body with real newlines.
  if (!s.includes("\n") && s.includes("-----BEGIN") && s.includes("-----END")) {
    const headerMatch = s.match(/(-----BEGIN [^-]+-----)/);
    const footerMatch = s.match(/(-----END [^-]+-----)/);
    if (headerMatch && footerMatch) {
      const header = headerMatch[1];
      const footer = footerMatch[1];
      const contentStart = s.indexOf(header) + header.length;
      const contentEnd   = s.indexOf(footer);
      const body = s.slice(contentStart, contentEnd).trim().replace(/\s+/g, "\n");
      s = `${header}\n${body}\n${footer}`;
    }
  }

  return s
    .split("\n")
    .map((l) => l.trimStart())
    .join("\n")
    .trim();
}

function requireAuth(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return (req as any).user.id as string;
}

function sshConnect(): Promise<SSHClient> {
  const rawKey = process.env.FREESWITCH_SSH_KEY;
  if (!rawKey)   throw new Error("FREESWITCH_SSH_KEY not configured");
  if (!FS_HOST)  throw new Error("FREESWITCH_DOMAIN not configured");
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

async function getUserMailbox(userId: string): Promise<{ ext: number; domain: string }> {
  await connectDB();
  const user = await UserModel.findById(userId).select("extension").lean();
  const ext = user?.extension;
  if (!ext) throw new Error("No FreeSWITCH extension assigned to this account");
  const domain = process.env.FREESWITCH_DOMAIN ?? "freeswitch.local";
  return { ext, domain };
}

/**
 * Parse FreeSWITCH voicemail XML metadata.
 * FreeSWITCH writes msg_XXXXX.xml alongside msg_XXXXX.wav with fields:
 *   caller-id-name, caller-id-number, message-len (seconds), flags/flag[@name=read]
 */
function parseVoicemailXml(xml: string): {
  from?: string; name?: string; duration?: number; read?: boolean;
} {
  const get = (tag: string) => { const m = xml.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "s")); return m?.[1]?.trim() ?? undefined; };
  const from = get("caller-id-number");
  const name = get("caller-id-name");
  const msgLen = get("message-len");
  const readFlag = xml.match(/<flag\s+name="read"\s*>(.*?)<\/flag>/s)?.[1]?.trim();
  return {
    from: from || undefined,
    name: (name && name !== "unknown" && name !== "Anonymous") ? name : undefined,
    duration: msgLen ? parseInt(msgLen, 10) : undefined,
    read: readFlag === "true",
  };
}

/* ── GET /api/voicemail ──────────────────────────────────────────────
   Returns a list of voicemail messages for the authenticated user.
   Each item includes caller-id, duration, and read-state from the
   FreeSWITCH XML metadata file stored alongside the audio.
─────────────────────────────────────────────────────────────────────── */
router.get("/voicemail", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  // If FreeSWITCH SSH is not configured, return an empty mailbox rather than 500.
  // This is the expected state when FreeSWITCH isn't set up yet on the VPS.
  if (!process.env.FREESWITCH_SSH_KEY || !FS_HOST) {
    res.json({ mailbox: null, messages: [], configured: false });
    return;
  }

  let mailbox: { ext: number; domain: string };
  try { mailbox = await getUserMailbox(userId); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }

  const baseDir = `${FS_STORAGE_DIR}/voicemail/default/${mailbox.domain}/${mailbox.ext}`;
  let conn: SSHClient | null = null;

  try {
    conn = await sshConnect();

    // List all WAV/MP3/OGG files with timestamps and sizes
    const listCmd =
      `set -e; ` +
      `if [ ! -d '${baseDir}' ]; then echo ''; exit 0; fi; ` +
      `find '${baseDir}' -type f \\( -name 'msg_*.wav' -o -name 'msg_*.mp3' -o -name 'msg_*.ogg' \\) ` +
      `-printf '%T@ %s %p\n' 2>/dev/null | sort -nr`;

    const listOut = await execCommand(conn, listCmd);
    const lines = listOut ? listOut.split("\n").filter(Boolean) : [];

    const messages = await Promise.all(lines.map(async (line) => {
      const parts = line.trim().split(" ");
      const ts       = parseFloat(parts[0] ?? "0");
      const size     = parseInt(parts[1] ?? "0", 10);
      const fullPath = parts.slice(2).join(" ");
      const relPath  = fullPath.startsWith(baseDir + "/") ? fullPath.slice(baseDir.length + 1) : fullPath;

      // Try to read the companion XML metadata file
      const xmlPath = fullPath.replace(/\.[^.]+$/, ".xml");
      let meta: ReturnType<typeof parseVoicemailXml> = {};
      try {
        const xmlContent = await execCommand(conn!, `cat '${xmlPath}' 2>/dev/null || echo ''`);
        if (xmlContent.trim()) meta = parseVoicemailXml(xmlContent);
      } catch { /* XML not found — ignore */ }

      return {
        id:        relPath,
        createdAt: new Date(Math.floor(ts * 1000)).toISOString(),
        size,
        from:      meta.from,
        name:      meta.name,
        duration:  meta.duration,
        read:      meta.read ?? false,
      };
    }));

    res.json({ mailbox: { extension: mailbox.ext, domain: mailbox.domain }, messages });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to list voicemail" });
  } finally { conn?.end(); }
});

/* ── GET /api/voicemail/message?path=... ─────────────────────────────
   Streams the raw audio file for a voicemail message.
─────────────────────────────────────────────────────────────────────── */
router.get("/voicemail/message", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  let mailbox: { ext: number; domain: string };
  try { mailbox = await getUserMailbox(userId); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }

  let relPath: string;
  try { relPath = safeRelPath(req.query.path); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }

  const baseDir  = `${FS_STORAGE_DIR}/voicemail/default/${mailbox.domain}/${mailbox.ext}`;
  const fullPath = `${baseDir}/${relPath}`;
  const ext      = relPath.split(".").pop()?.toLowerCase() ?? "wav";
  const mimeMap: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg" };
  const mimeType = mimeMap[ext] ?? "application/octet-stream";

  let conn: SSHClient | null = null;
  try {
    conn = await sshConnect();
    const b64 = await execCommand(conn, `set -e; test -f '${fullPath}' && base64 -w0 '${fullPath}'`);
    const buf  = Buffer.from(b64, "base64");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Accept-Ranges", "bytes");
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to fetch voicemail audio" });
  } finally { conn?.end(); }
});

/* ── PATCH /api/voicemail/message/read ───────────────────────────────
   Marks a voicemail message as read by updating the FreeSWITCH XML.
─────────────────────────────────────────────────────────────────────── */
router.patch("/voicemail/message/read", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  let mailbox: { ext: number; domain: string };
  try { mailbox = await getUserMailbox(userId); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }

  let relPath: string;
  try { relPath = safeRelPath((req.body as any)?.path); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }

  const baseDir  = `${FS_STORAGE_DIR}/voicemail/default/${mailbox.domain}/${mailbox.ext}`;
  const audioPath = `${baseDir}/${relPath}`;
  const xmlPath   = audioPath.replace(/\.[^.]+$/, ".xml");

  let conn: SSHClient | null = null;
  try {
    conn = await sshConnect();
    // Update the read flag in the XML file (sed in-place)
    const cmd =
      `set -e; ` +
      `test -f '${xmlPath}' && ` +
      `sed -i 's|<flag name="read">false</flag>|<flag name="read">true</flag>|g' '${xmlPath}' || true`;
    await execCommand(conn, cmd);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to mark voicemail as read" });
  } finally { conn?.end(); }
});

/* ── DELETE /api/voicemail/message ───────────────────────────────────
   Permanently deletes a voicemail message (audio + XML + any sidecar).
─────────────────────────────────────────────────────────────────────── */
router.delete("/voicemail/message", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  let mailbox: { ext: number; domain: string };
  try { mailbox = await getUserMailbox(userId); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }

  let relPath: string;
  try { relPath = safeRelPath((req.body as any)?.path); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }

  const baseDir  = `${FS_STORAGE_DIR}/voicemail/default/${mailbox.domain}/${mailbox.ext}`;
  const fullPath = `${baseDir}/${relPath}`;
  const dir      = fullPath.replace(/\/[^/]+$/, "");
  const base     = (fullPath.split("/").pop() ?? "").replace(/\.[^.]+$/, "");

  let conn: SSHClient | null = null;
  try {
    conn = await sshConnect();
    const cmd =
      `set -e; ` +
      `test -d '${dir}'; ` +
      `rm -f '${dir}/${base}.wav' '${dir}/${base}.mp3' '${dir}/${base}.ogg' ` +
      `'${dir}/${base}.xml' '${dir}/${base}.json' 2>/dev/null || true`;
    await execCommand(conn, cmd);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to delete voicemail" });
  } finally { conn?.end(); }
});

export default router;
