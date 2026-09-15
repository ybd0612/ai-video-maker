// ────────────────────────────────────────────────────────────────────────────
// vite-plugins/debugDumpPlugin.ts
// DEV-ONLY Vite plugin: receives sanitized store snapshots from the app
// (src/lib/devDump.ts) and writes them to debug-dump/state.json so the AI
// assistant can read real browser data during local debugging.
//
// 落盘产物（均在 <项目根>/debug-dump/，已 gitignore）：
//   state.json     —— 最近一次 store 快照（项目 + 设置，apiKey 已脱敏）
//   runtime.log    —— 运行日志 NDJSON 追加流（每行一条日志，可 tail/grep）
//   extract-logs/  —— 资产提取原始响应留痕（LLM 间歇性异常输出的事后取证）
//
// apply:"serve" — never runs in production builds.
// Endpoints:
//   POST /__debug/dump         store 快照
//   POST /__debug/log          运行日志增量（NDJSON 追加，超限自动轮转）
//   POST /__debug/extract-log  提取原始响应
// ────────────────────────────────────────────────────────────────────────────

import path from "node:path";
import fs from "node:fs";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 20 * 1024 * 1024;
const OUT_RELATIVE_DIR = "debug-dump";
const EXTRACT_LOGS_RELATIVE_DIR = "debug-dump/extract-logs";
/** 运行日志 NDJSON 文件；超过该大小则轮转为 runtime.log.1 */
const RUNTIME_LOG_MAX_BYTES = 8 * 1024 * 1024;

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
  let runtimeLogFile = "";

  return {
    name: "wxhb-debug-dump",
    apply: "serve",
    configureServer(server) {
      // 以 Vite 项目根为基准（而非插件文件所在目录），保证落盘到 <项目根>/debug-dump/
      outDir = path.resolve(server.config.root, OUT_RELATIVE_DIR);
      fs.mkdirSync(outDir, { recursive: true });
      extractLogsDir = path.resolve(server.config.root, EXTRACT_LOGS_RELATIVE_DIR);
      fs.mkdirSync(extractLogsDir, { recursive: true });
      runtimeLogFile = path.join(outDir, "runtime.log");

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

      // 运行日志：NDJSON 追加（每行一条，便于 tail/grep 与 AI 直接读取）
      server.middlewares.use(
        "/__debug/log",
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method !== "POST") {
            respondJson(res, 405, { ok: false, error: "method not allowed" });
            return;
          }

          readJsonBody(req)
            .then((raw) => {
              const parsed = JSON.parse(raw) as {
                session?: string;
                entries?: unknown[];
              };
              const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
              if (entries.length === 0) {
                respondJson(res, 200, { ok: true, appended: 0 });
                return;
              }
              // 轮转：超过上限时保留一份 runtime.log.1，避免无限增长
              try {
                const size = fs.statSync(runtimeLogFile).size;
                if (size > RUNTIME_LOG_MAX_BYTES) {
                  fs.rmSync(`${runtimeLogFile}.1`, { force: true });
                  fs.renameSync(runtimeLogFile, `${runtimeLogFile}.1`);
                }
              } catch {
                // 文件尚不存在 → 直接追加
              }
              const lines = entries
                .map((entry) => JSON.stringify({ session: parsed.session, ...(entry as object) }))
                .join("\n");
              fs.appendFileSync(runtimeLogFile, `${lines}\n`, "utf8");
              respondJson(res, 200, { ok: true, appended: entries.length });
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
          `  ➜  debug-dump: state.json · runtime.log · ${EXTRACT_LOGS_RELATIVE_DIR}/`,
          { timestamp: true },
        );
      });
    },
  };
}
