// The client block is copied into every integration so each stays one file an agent can
// load; this keeps the copies from drifting apart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

const root = new URL("../", import.meta.url);
const integrations = readdirSync(root).filter((d) => {
  try { return statSync(new URL(`${d}/episko.ts`, root)).isFile(); } catch { return false; }
});

const block = (dir) => {
  const src = readFileSync(new URL(`${dir}/episko.ts`, root), "utf8");
  const m = /\/\/ ---- episko client[^\n]*\n([\s\S]*?)\/\/ ---- end client ----/.exec(src);
  assert.ok(m, `${dir}/episko.ts has no client block`);
  return m[1];
};

test("every integration carries the same client", () => {
  assert.ok(integrations.length >= 2, `found ${integrations}`);
  const [first, ...rest] = integrations;
  for (const dir of rest) assert.equal(block(dir), block(first), `${dir} differs from ${first}`);
});
