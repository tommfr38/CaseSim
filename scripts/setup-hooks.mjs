#!/usr/bin/env node
/**
 * Installs a git pre-commit hook so the market prices (and the catalogue) are
 * refreshed automatically every time you commit — which means every push you
 * make ships fresh, moving prices. Run once:  npm run setup:hooks
 */
import { writeFile, chmod, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = join(ROOT, ".git", "hooks");

if (!existsSync(join(ROOT, ".git"))) {
  console.error("Not a git repository — run `git init` first.");
  process.exit(1);
}

const hook = `#!/bin/sh
# CaseSim: refresh real catalogue + re-roll live market prices on every commit.
echo "[CaseSim] refreshing data + prices…"
npm run --silent fetch || exit 1
npm run --silent build:css || exit 1
git add public/data/cases.json public/data/meta.json public/assets/styles.css
`;

await mkdir(hooksDir, { recursive: true });
const dest = join(hooksDir, "pre-commit");
await writeFile(dest, hook);
await chmod(dest, 0o755);
console.log("✓ installed .git/hooks/pre-commit — prices now refresh on every commit.");
