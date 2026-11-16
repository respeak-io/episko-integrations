// Each integration inside its real agent, launched the way Episko launches it (its
// integration.json), against a scripted model: no account, no tokens. The agent reads
// README.md and answers; the test checks what reached "Episko". Skips an agent that is not
// installed unless REQUIRE_AGENTS=1. <ID>_BIN (OPENCODE_BIN, OMP_BIN) overrides PATH.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { check } from "../protocol/checker.mjs";
import { agents } from "../scripts/agents.mjs";
import { startEpisko, startFakeModel } from "./harness.mjs";

const REQUIRED = process.env.REQUIRE_AGENTS === "1";
const ANSWER = "Read it. All done.";
const PROMPT = "Please read README.md";

function which(name) {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (dir && existsSync(p)) return p;
    }
  }
  return null;
}

function run(bin, args, { cwd, env, timeoutMs = 180_000 }) {
  // An npm .cmd shim cannot be spawned directly on Windows.
  const viaCmd = /\.(cmd|bat)$/i.test(bin);
  // stdin closed: a CLI that sees a pipe there reads the prompt from it and waits for EOF.
  const opts = { cwd, env, stdio: ["ignore", "pipe", "pipe"] };
  const child = viaCmd
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", bin, ...args], opts)
    : spawn(bin, args, opts);
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "episko-e2e-"));
  const proj = join(root, "proj");
  mkdirSync(proj);
  writeFileSync(join(proj, "README.md"), "# Hello from the e2e project\n");
  return { root, proj };
}

// The order a read-and-answer turn must reach Episko in, whatever else is around it.
function assertTurn(events) {
  const all = events.map((e) => e.type);
  // The prompt may open the turn from either side of turn-start (docs/agent-protocol.md).
  const order = all.filter((t) => !["usage", "session", "cost", "prompt"].includes(t));
  assert.deepEqual(order, ["turn-start", "tool-start", "tool-end", "answer", "turn-end"]);
  assert.ok(all.indexOf("prompt") >= 0 && all.indexOf("prompt") < all.indexOf("tool-start"), `prompt out of place: ${all}`);
  const end = events.find((e) => e.type === "tool-end");
  assert.equal(end.failed, false, `the read failed: ${end.output}`);
  assert.equal(end.files?.[0]?.kind, "read");
  assert.match(end.files[0].path, /README\.md$/);
  assert.equal(events.find((e) => e.type === "answer").text, ANSWER);
  assert.equal(events.find((e) => e.type === "turn-end").failed, false);
  const usage = events.findLast((e) => e.type === "usage");
  assert.ok(usage.totals.input >= 1200, `totals: ${JSON.stringify(usage.totals)}`);
}

// What protocol.rs does at launch: the extension at its path in a folder of its own, and
// {file}/{dir} filled into the args and env the integration declares.
function episkoLaunch(dir, launch, folder) {
  const file = join(folder, ...launch.extension.split("/"));
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(new URL("episko.ts", dir), file);
  const fill = (v) => v.replaceAll("{file}", file).replaceAll("{dir}", folder);
  return {
    args: (launch.args ?? []).map(fill),
    env: Object.fromEntries(Object.entries(launch.env ?? {}).map(([k, v]) => [k, fill(v)])),
  };
}

for (const { id, dir, spec } of agents()) {
  const bin = process.env[`${id.toUpperCase().replaceAll("-", "_")}_BIN`] ?? which(spec.bin);
  test(`${spec.name} reports a turn through the extension Episko loads`, { skip: !bin && !REQUIRED && `${spec.bin} not installed` }, async () => {
    assert.ok(bin, `REQUIRE_AGENTS=1 but ${spec.bin} was not found`);
    const { setup } = await import(new URL("e2e.mjs", dir).href);
    const { root, proj } = workspace();
    const model = await startFakeModel({ answer: ANSWER });
    const episko = await startEpisko();
    try {
      const launch = episkoLaunch(dir, spec.launch, join(root, "ext"));
      const agent = await setup({ root, proj, model, prompt: PROMPT });
      const env = { ...process.env, ...agent.env, ...launch.env, ...episko.env, PWD: proj };
      const { code, out } = await run(bin, [...agent.args, ...launch.args], { cwd: proj, env });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(code, 0, out.slice(-2000));
      assert.deepEqual(episko.rejected, []);
      const { errors, events } = check(episko.envelopes);
      assert.deepEqual(errors, []);
      assertTurn(events);
      agent.check?.(events);
    } finally {
      model.close();
      episko.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
