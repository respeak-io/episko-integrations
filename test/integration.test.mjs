// Every agents/<id>/ is a whole integration: a valid integration.json, the extension, a
// replay test and an e2e recipe. Episko vendors integration.json, so it is held here first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { AGENTS_DIR, agents } from "../scripts/agents.mjs";

const schema = JSON.parse(readFileSync(new URL("integration.schema.json", AGENTS_DIR), "utf8"));
const validate = new Ajv2020({ allErrors: true }).compile(schema);

for (const { id, dir, spec } of agents()) {
  test(`${id}: a complete integration Episko can launch`, () => {
    assert.match(id, /^[a-z][a-z0-9-]*$/, "the folder name is the id Episko files the agent under");
    assert.ok(validate(spec), `integration.json: ${new Ajv2020().errorsText(validate.errors)}`);
    for (const file of ["episko.ts", "e2e.mjs", `${id}.test.mjs`]) {
      assert.ok(existsSync(new URL(file, dir)), `agents/${id}/${file} is missing`);
    }
    const { launch } = spec;
    const told = [...(launch.args ?? []), ...Object.values(launch.env ?? {})].some((v) => /\{(file|dir)\}/.test(v));
    assert.ok(told, "launch never tells the agent where its extension is ({file} or {dir})");
    const modes = launch.permissionModes ?? [];
    assert.equal(new Set(modes.map((m) => m.id)).size, modes.length, "permission mode ids repeat");
    assert.equal(spec.capabilities.includes("launch-permissions"), modes.length > 0,
      "claim launch-permissions exactly when there are permissionModes to offer");
  });
}

test("the schema refuses what Episko must never launch", () => {
  const ok = JSON.parse(readFileSync(new URL("opencode/integration.json", AGENTS_DIR), "utf8"));
  const bad = [
    { ...ok, launch: { ...ok.launch, extension: "../escape.ts" } },
    { ...ok, launch: { ...ok.launch, extension: "/etc/x.ts" } },
    { ...ok, launch: { ...ok.launch, env: { EPISKO_TOKEN: "{dir}" } } },
    { ...ok, capabilities: ["activity"] },
    { ...ok, capabilities: [...ok.capabilities, "permissions"] },
    { ...ok, package: { manager: "npm", name: "x; rm -rf /" } },
  ];
  for (const spec of bad) assert.equal(validate(spec), false, JSON.stringify(spec));
});
