import { Router, type IRouter, type Request, type Response } from "express";
import { Client as SSHClient } from "ssh2";
import { connectDB, UserModel } from "@workspace/db";

const router: IRouter = Router();

const FS_HOST = process.env.FREESWITCH_DOMAIN ?? "";
const FS_SSH_PORT = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22", 10);
const FS_SSH_USER = process.env.FREESWITCH_SSH_USER ?? "root";
const FS_STORAGE_DIR = process.env.FREESWITCH_STORAGE_DIR ?? "/usr/local/freeswitch/storage";

function cleanKey(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.trimStart())
    .join("\n")
    .trim();
}

function requireAuth(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return (req as any).user.id as string;
}

function sshConnect(): Promise<SSHClient> {
  const rawKey = process.env.FREESWITCH_SSH_KEY;
  if (!rawKey) {
    throw new Error("FREESWITCH_SSH_KEY not set");
  }
  if (!FS_HOST) {
    throw new Error("FREESWITCH_DOMAIN not set");
  }

  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    conn.on("ready", () => resolve(conn));
    conn.on("error", reject);
    conn.connect({
      host: FS_HOST,
      port: FS_SSH_PORT,
      username: FS_SSH_USER,
      privateKey: cleanKey(rawKey),
      readyTimeout: 10_000,
    });
  });
}

function execCommand(conn: SSHClient, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let out = "";
      let errOut = "";
      stream.on("data", (d: Buffer) => {
        out += d.toString();
      });
      stream.stderr.on("data", (d: Buffer) => {
        errOut += d.toString();
      });
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
  if (s.includes("..") || s.startsWith("/") || s.startsWith("\\")) {
    throw new Error("Invalid path");
  }
  if (!/^[a-zA-Z0-9_\-/.]+$/.test(s)) {
    throw new Error("Invalid path");
  }
  return s;
}

async function getUserMailbox(userId: string): Promise<{ ext: number; domain: string }> {
  await connectDB();
  const user = await UserModel.findById(userId).select("extension").lean();
  const ext = user?.extension;
  if (!ext) throw new Error("User has no extension");
  const domain = process.env.FREESWITCH_DOMAIN ?? "freeswitch.local";
  return { ext, domain };
}

router.get("/voicemail", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  let mailbox: { ext: number; domain: string };
  try {
    mailbox = await getUserMailbox(userId);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const baseDir = `${FS_STORAGE_DIR}/voicemail/default/${mailbox.domain}/${mailbox.ext}`;

  let conn: SSHClient | null = null;
  try {
    conn = await sshConnect();

    const cmd =
      `set -e; ` +
      `if [ ! -d '${baseDir}' ]; then echo ''; exit 0; fi; ` +
      `find '${baseDir}' -type f \\(` +
      ` -name 'msg_*.wav' -o -name 'msg_*.mp3' -o -name 'msg_*.ogg' \\)` +
      ` -printf '%T@ %s %p\n' 2>/dev/null | sort -nr`;

    const out = await execCommand(conn, cmd);
    const lines = out ? out.split("\n").filter(Boolean) : [];

    const messages = lines.map((line) => {
      const parts = line.trim().split(" ");
      const ts = parseFloat(parts[0] ?? "0");
      const size = parseInt(parts[1] ?? "0", 10);
      const fullPath = parts.slice(2).join(" ");
      const relPath = fullPath.startsWith(baseDir + "/") ? fullPath.slice(baseDir.length + 1) : fullPath;
      return {
        id: relPath,
        createdAt: new Date(Math.floor(ts * 1000)).toISOString(),
        size,
      };
    });

    res.json({ mailbox: { extension: mailbox.ext, domain: mailbox.domain }, messages });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to list voicemail" });
  } finally {
    conn?.end();
  }
});

router.get("/voicemail/message", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  let mailbox: { ext: number; domain: string };
  try {
    mailbox = await getUserMailbox(userId);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  let relPath: string;
  try {
    relPath = safeRelPath(req.query.path);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const baseDir = `${FS_STORAGE_DIR}/voicemail/default/${mailbox.domain}/${mailbox.ext}`;
  const fullPath = `${baseDir}/${relPath}`;

  let conn: SSHClient | null = null;
  try {
    conn = await sshConnect();

    const b64 = await execCommand(conn, `set -e; test -f '${fullPath}' && base64 -w0 '${fullPath}'`);
    const buf = Buffer.from(b64, "base64");

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(buf.length));
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to fetch voicemail" });
  } finally {
    conn?.end();
  }
});

router.delete("/voicemail/message", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  let mailbox: { ext: number; domain: string };
  try {
    mailbox = await getUserMailbox(userId);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  let relPath: string;
  try {
    relPath = safeRelPath((req.body as any)?.path);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const baseDir = `${FS_STORAGE_DIR}/voicemail/default/${mailbox.domain}/${mailbox.ext}`;
  const fullPath = `${baseDir}/${relPath}`;

  let conn: SSHClient | null = null;
  try {
    conn = await sshConnect();

    const dir = fullPath.replace(/\/[^/]+$/, "");
    const filename = fullPath.split("/").pop() ?? "";
    const base = filename.replace(/\.[^.]+$/, "");

    const cmd =
      `set -e; ` +
      `test -d '${dir}'; ` +
      `rm -f '${dir}/${base}.wav' '${dir}/${base}.mp3' '${dir}/${base}.ogg' '${dir}/${base}.xml' '${dir}/${base}.json' 2>/dev/null || true`;

    await execCommand(conn, cmd);
    res.json({ message: "Voicemail deleted" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? "Failed to delete voicemail" });
  } finally {
    conn?.end();
  }
});

export default router;
