import net from "net";
import { Client as SSHClient } from "ssh2";
import { logger } from "./logger";
import { cleanPrivateKey } from "./sshKey";

const tunnels = new Map<number, Promise<string>>();

function bareHost(raw: string): string {
  try {
    if (/^[a-z]+:\/\//i.test(raw)) return new URL(raw).hostname;
  } catch {
    return raw;
  }
  return raw.split(":")[0].replace(/\/$/, "");
}

async function createForwardServer(targetPort: number): Promise<string> {
  const sshKey = process.env.FREESWITCH_SSH_KEY;
  const sshHost = process.env.FREESWITCH_DOMAIN ?? process.env.FREESWITCH_ESL_HOST;
  if (!sshKey || !sshHost) throw new Error("FreeSWITCH SSH settings are not configured");

  const sshPort = parseInt(process.env.FREESWITCH_SSH_PORT ?? "22", 10);
  const username = process.env.FREESWITCH_SSH_USER ?? "ubuntu";
  const privateKey = cleanPrivateKey(sshKey);

  return new Promise((resolve, reject) => {
    const server = net.createServer((localSocket) => {
      const conn = new SSHClient();
      let channelAttached = false;

      const close = () => {
        localSocket.destroy();
        conn.end();
      };

      conn.on("ready", () => {
        conn.forwardOut("127.0.0.1", 0, "127.0.0.1", targetPort, (err, channel) => {
          if (err) {
            logger.warn({ err: err.message, targetPort }, "SSH forwardOut failed");
            close();
            return;
          }
          channelAttached = true;
          localSocket.pipe(channel);
          channel.pipe(localSocket);
          channel.on("close", close);
          channel.on("error", close);
        });
      });

      conn.on("error", (err) => {
        logger.warn({ err: err.message, targetPort, phase: channelAttached ? "channel" : "connect" }, "SSH forward connection error");
        localSocket.destroy();
      });

      conn.on("close", () => {
        localSocket.destroy();
      });

      localSocket.on("close", () => conn.end());
      localSocket.on("error", () => conn.end());

      conn.connect({
        host: bareHost(sshHost),
        port: sshPort,
        username,
        privateKey,
        readyTimeout: 15000,
      });
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate local SSH forward port"));
        return;
      }
      logger.info({ localPort: address.port, targetPort }, "FreeSWITCH SSH forward server ready");
      server.on("error", (err) => logger.warn({ err, targetPort }, "FreeSWITCH SSH forward server error"));
      resolve(`ws://127.0.0.1:${address.port}/`);
    });
  });
}

export async function getSshForwardUrl(targetPort: number): Promise<string | null> {
  if (!process.env.FREESWITCH_SSH_KEY) return null;
  if (!process.env.FREESWITCH_DOMAIN && !process.env.FREESWITCH_ESL_HOST) return null;
  if (!tunnels.has(targetPort)) {
    tunnels.set(targetPort, createForwardServer(targetPort));
  }
  return tunnels.get(targetPort)!;
}