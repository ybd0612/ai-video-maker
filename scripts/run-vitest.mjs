import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = realpathSync.native(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
);
const vitestCli = path.join(projectRoot, "node_modules", "vitest", "vitest.mjs");

const result = spawnSync(
  process.execPath,
  [vitestCli, ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
