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
const EXTRACT_LOGS_RELATIVE_DIR = "debug-dump/extract-logs";

/** 读取并解析 JSON 请求体（超限抛错） */
function readJsonBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(Buffer.concat(chunks).toString("utf8"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** 统一的 JSON 响应 */
function respondJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export function debugDumpPlugin(): Plugin {
  let outDir = "";
  let extractLogsDir = "";

  return {
    name: "wxhb-debug-dump",
    apply: "serve",
    configureServer(server) {
      // 以 Vite 项目根为基准（而非插件文件所在目录），保证落盘到 <项目根>/debug-dump/
      outDir = path.resolve(server.config.root, OUT_RELATIVE_DIR);
      fs.mkdirSync(outDir, { recursive: true });
      extractLogsDir = path.resolve(server.config.root, EXTRACT_LOGS_RELATIVE_DIR);
      fs.mkdirSync(extractLogsDir, { recursive: true });

      server.middlewares.use(
        "/__debug/dump",
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method !== "POST") {
            respondJson(res, 405, { ok: false, error: "method not allowed" });
            return;
          }

          readJsonBody(req)
            .then((raw) => {
              const parsed: unknown = JSON.parse(raw);
              const file = path.join(outDir, "state.json");
              fs.writeFileSync(file, JSON.stringify(parsed, null, 2), "utf8");
              respondJson(res, 200, { ok: true, file });
            })
            .catch((err) => {
              respondJson(res, 400, { ok: false, error: String(err) });
            });
          void next;
        },
      );

      // 提取原始响应留痕（LLM 间歇性异常输出的事后取证现场）
      server.middlewares.use(
        "/__debug/extract-log",
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method !== "POST") {
            respondJson(res, 405, { ok: false, error: "method not allowed" });
            return;
          }

          readJsonBody(req)
            .then((raw) => {
              const parsed: unknown = JSON.parse(raw);
              const file = path.join(extractLogsDir, `extract-${Date.now()}.json`);
              fs.writeFileSync(file, JSON.stringify(parsed, null, 2), "utf8");
              respondJson(res, 200, { ok: true, file });
            })
            .catch((err) => {
              respondJson(res, 400, { ok: false, error: String(err) });
            });
          void next;
        },
      );

      server.httpServer?.once("listening", () => {
        server.config.logger.info(
          `  ➜  debug-dump: POST /__debug/dump → ${OUT_RELATIVE_DIR}/state.json · POST /__debug/extract-log → ${EXTRACT_LOGS_RELATIVE_DIR}/`,
          { timestamp: true },
        );
      });
    },
  };
}
