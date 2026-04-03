#!/usr/bin/env tsx
/**
 * ESL connectivity test — run this on your Oracle VPS to verify FreeSWITCH
 * Event Socket Layer is reachable and responding.
 *
 * Usage (on the VPS, inside ~/PRawwPlus):
 *   npx tsx artifacts/api-server/scripts/test-esl.ts
 *
 * Override defaults with env vars:
 *   FREESWITCH_ESL_HOST=127.0.0.1 \
 *   FREESWITCH_ESL_PORT=8021 \
 *   FREESWITCH_ESL_PASSWORD=your_password \
 *   npx tsx artifacts/api-server/scripts/test-esl.ts
 *
 * Or with a .env file already in place:
 *   node -r dotenv/config -e "require('./artifacts/api-server/scripts/test-esl.ts')"
 */

import net from "net";

const HOST     = process.env.FREESWITCH_ESL_HOST ?? "127.0.0.1";
const PORT     = parseInt(process.env.FREESWITCH_ESL_PORT ?? "8021", 10);
const PASSWORD = process.env.FREESWITCH_ESL_PASSWORD ?? "ClueCon";
const TIMEOUT  = 10_000;

const COMMANDS = [
  "api status",
  "api sofia status",
  "api show codec",
  "api module_exists mod_opus",
  "api module_exists mod_verto",
];

interface EslMessage {
  headers: Record<string, string>;
  body: string;
}

function parseMessage(raw: string): EslMessage {
  const blankLine = raw.indexOf("\n\n");
  const headerSection = blankLine >= 0 ? raw.slice(0, blankLine) : raw;
  const body = blankLine >= 0 ? raw.slice(blankLine + 2) : "";

  const headers: Record<string, string> = {};
  for (const line of headerSection.split("\n")) {
    const colon = line.indexOf(":");
    if (colon >= 0) {
      headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
  }
  return { headers, body };
}

async function runEslTest(): Promise<void> {
  console.log("\n═══════════════════════════════════════════════");
  console.log("  PRaww+ — FreeSWITCH ESL Connectivity Test");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Host:     ${HOST}`);
  console.log(`  Port:     ${PORT}`);
  console.log(`  Password: ${"*".repeat(PASSWORD.length)}`);
  console.log("═══════════════════════════════════════════════\n");

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: HOST, port: PORT });
    socket.setTimeout(TIMEOUT);

    let buffer = "";
    let authenticated = false;
    let cmdIndex = 0;
    let passed = 0;
    let failed = 0;

    const send = (line: string) => {
      socket.write(line + "\n\n");
    };

    const printResult = (cmd: string, reply: string) => {
      const trimmed = reply.trim();
      const ok = trimmed && !trimmed.startsWith("-ERR");
      ok ? passed++ : failed++;
      const icon = ok ? "✓" : "✗";
      console.log(`${icon}  ${cmd}`);
      if (trimmed) {
        const lines = trimmed.split("\n").slice(0, 6);
        for (const l of lines) console.log(`     ${l}`);
        if (trimmed.split("\n").length > 6) console.log("     ...(truncated)");
      }
      console.log();
    };

    const sendNext = () => {
      if (cmdIndex >= COMMANDS.length) {
        console.log("═══════════════════════════════════════════════");
        console.log(`  Results: ${passed} passed, ${failed} failed`);
        if (failed === 0) {
          console.log("  ESL connection is healthy ✓");
        } else {
          console.log("  Some commands failed — see output above.");
        }
        console.log("═══════════════════════════════════════════════\n");
        socket.destroy();
        resolve();
        return;
      }

      const cmd = COMMANDS[cmdIndex++];
      console.log(`→ ${cmd}`);
      send(cmd);
    };

    socket.on("connect", () => {
      console.log(`Connected to ${HOST}:${PORT}\n`);
    });

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();

      while (true) {
        const msg = parseMessage(buffer);
        const contentLength = parseInt(msg.headers["Content-Length"] ?? "0", 10);
        const blankLine = buffer.indexOf("\n\n");

        if (blankLine < 0) break;

        const headerEnd = blankLine + 2;
        const totalLength = headerEnd + contentLength;

        if (buffer.length < totalLength) break;

        const fullMessage = buffer.slice(0, totalLength);
        buffer = buffer.slice(totalLength);

        const parsed = parseMessage(fullMessage);
        const contentType = parsed.headers["Content-Type"] ?? "";
        const replyText   = parsed.headers["Reply-Text"] ?? "";

        if (contentType === "auth/request") {
          console.log("← auth/request received — authenticating...\n");
          send(`auth ${PASSWORD}`);
          continue;
        }

        if (!authenticated) {
          if (replyText === "+OK accepted") {
            authenticated = true;
            console.log("← Authenticated successfully ✓\n");
            sendNext();
          } else {
            console.error(`✗ Authentication failed: ${replyText || parsed.body}`);
            console.error("  Check FREESWITCH_ESL_PASSWORD in your .env\n");
            socket.destroy();
            reject(new Error("ESL authentication failed"));
          }
          continue;
        }

        if (contentType === "api/response") {
          const cmd = COMMANDS[cmdIndex - 1];
          printResult(cmd, parsed.body);
          sendNext();
        }
      }
    });

    socket.on("timeout", () => {
      console.error(`✗ Connection timed out after ${TIMEOUT / 1000}s`);
      console.error(`  Is FreeSWITCH running? Try: sudo systemctl status freeswitch\n`);
      socket.destroy();
      reject(new Error("ESL connection timeout"));
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED") {
        console.error(`✗ Connection refused on ${HOST}:${PORT}`);
        console.error("  FreeSWITCH may not be running or ESL is not bound to this address.");
        console.error("  Try: sudo systemctl start freeswitch\n");
      } else {
        console.error(`✗ Socket error: ${err.message}\n`);
      }
      reject(err);
    });

    socket.on("close", () => {
      if (!authenticated) {
        reject(new Error("Connection closed before authentication"));
      }
    });
  });
}

runEslTest().catch((err) => {
  process.exitCode = 1;
});
