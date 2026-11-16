// The client block is copied into every integration so each stays one file an agent can
// load; this keeps the copies from drifting apart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agents } from "../scripts/agents.mjs";

const block = ({ id, dir }) => {
  const src = readFileSync(new URL("episko.ts", dir), "utf8");
  const m = /\/\/ ---- episko client[^\n]*\n([\s\S]*?)\/\/ ---- end client ----/.exec(src);
  assert.ok(m, `agents/${id}/episko.ts has no client block`);
  return m[1];
};

test("every integration carries the same client", () => {
  const list = agents();
  assert.ok(list.length >= 2, `found ${list.map((a) => a.id)}`);
  const [first, ...rest] = list;
  for (const a of rest) assert.equal(block(a), block(first), `${a.id} differs from ${first.id}`);
});
