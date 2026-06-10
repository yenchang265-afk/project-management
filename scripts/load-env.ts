/* Minimal .env.local loader for CLI scripts (Node 18 has no --env-file).
   Existing process.env values win — CI can override everything. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const file = join(process.cwd(), ".env.local");
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
