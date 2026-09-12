// ────────────────────────────────────────────────────────────────────────────
// vite-plugins/debugDumpPlugin.ts
// DEV-ONLY Vite plugin: receives sanitized store snapshots from the app
// (src/lib/devDump.ts) and writes them to debug-dump/state.json so the AI
// assistant can read real browser data during local debugging.
//
// apply:"serve" — never runs in production builds.
// Endpoint: POST /__debug/dump  (body: application/json, ≤ 20MB)
// ────────────────────────────────────────────────────────────────────────────

import path from "node:path";
import fs from "node:fs";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const OUT_RELATIVE_DIR = "debug-dump";

export function debugDumpPlugin(): Plugin {
  let outDir = "";

  return {
    name: "wxhb-debug-dump",
    apply: "serve",
    configureServer(server) {
      outDir = path.resolve(__dirname, OUT_RELATIVE_DIR);
      fs.mkdirSync(outDir, { recursive: true });

      server.middlewares.use(
        "/__debug/dump",
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
            return;
          }

          const chunks: Buffer[] = [];
          let size = 0;
          let aborted = false;

          req.on("data", (chunk: Buffer) => {
            if (aborted) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
              aborted = true;
              res.statusCode = 413;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "payload too large" }));
              return;
            }
            chunks.push(chunk);
          });

          req.on("end", () => {
            if (aborted) return;
            try {
              const parsed: unknown = JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
              );
              const file = path.join(outDir, "state.json");
              fs.writeFileSync(file, JSON.stringify(parsed, null, 2), "utf8");
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, file }));
            } catch (err) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: String(err) }));
            }
          });

          req.on("error", () => {
            /* client aborted — nothing to do */
          });
          void next;
        },
      );

      server.httpServer?.once("listening", () => {
        server.config.logger.info(
          `  ➜  debug-dump: POST /__debug/dump → ${OUT_RELATIVE_DIR}/state.json`,
          { timestamp: true },
        );
      });
    },
  };
}
