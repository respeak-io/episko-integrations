// Each integration inside its real agent, launched the way Episko launches it, against a
// scripted model: no account, no tokens. The agent reads README.md and answers; the test
// checks what reached "Episko". Skips an agent that is not installed unless REQUIRE_AGENTS=1.
//   OPENCODE_BIN / OMP_BIN override the binaries found on PATH.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { check } from "../protocol/checker.mjs";
import { startEpisko, startFakeModel } from "./harness.mjs";

const REQUIRED = process.env.REQUIRE_AGENTS === "1";
const ANSWER = "Read it. All done.";

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

const opencode = process.env.OPENCODE_BIN ?? which("opencode");
test("OpenCode reports a turn through the plugin Episko loads", { skip: !opencode && !REQUIRED && "opencode not installed" }, async () => {
  assert.ok(opencode, "REQUIRE_AGENTS=1 but opencode was not found");
  const { root, proj } = workspace();
  const model = await startFakeModel({ answer: ANSWER });
  const episko = await startEpisko();
  try {
    // Episko's launch, verbatim: the plugin in a folder of its own, named by OPENCODE_CONFIG_DIR.
    const dir = join(root, "ext");
    mkdirSync(join(dir, "plugins"), { recursive: true });
    copyFileSync(new URL("../opencode/episko.ts", import.meta.url), join(dir, "plugins", "episko.ts"));
    const config = {
      $schema: "https://opencode.ai/config.json", autoupdate: false, share: "disabled", model: "fake/fake-model",
      provider: { fake: { npm: "@ai-sdk/openai-compatible", name: "Fake", options: { baseURL: model.url, apiKey: "none" },
        models: { "fake-model": { name: "Fake model", limit: { context: 64000, output: 4096 } } } } },
    };
    const xdg = join(root, "xdg");
    const env = {
      ...process.env, ...episko.env, PWD: proj, OPENCODE_CONFIG_DIR: dir, OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_DISABLE_AUTOUPDATE: "1", XDG_CONFIG_HOME: join(xdg, "config"), XDG_DATA_HOME: join(xdg, "data"),
      XDG_STATE_HOME: join(xdg, "state"), XDG_CACHE_HOME: process.env.E2E_CACHE ?? join(xdg, "cache"),
    };
    const { code, out } = await run(opencode, ["run", "Please read README.md", "-m", "fake/fake-model"], { cwd: proj, env });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(code, 0, out.slice(-2000));
    assert.deepEqual(episko.rejected, []);
    const { errors, events } = check(episko.envelopes);
    assert.deepEqual(errors, []);
    assertTurn(events);
    assert.equal(events.findLast((e) => e.type === "usage").contextWindow, 64000);
  } finally {
    model.close();
    episko.close();
    rmSync(root, { recursive: true, force: true });
  }
});

const omp = process.env.OMP_BIN ?? which("omp");
test("OMP reports a turn through the extension Episko loads", { skip: !omp && !REQUIRED && "omp not installed" }, async () => {
  assert.ok(omp, "REQUIRE_AGENTS=1 but omp was not found");
  const { root, proj } = workspace();
  const model = await startFakeModel({ answer: ANSWER });
  const episko = await startEpisko();
  try {
    const dir = join(root, "ext");
    mkdirSync(dir);
    const file = join(dir, "episko.ts");
    copyFileSync(new URL("../omp/episko.ts", import.meta.url), file);
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, "models.yml"), [
      "providers:",
      "  fake:",
      `    baseUrl: ${model.url}`,
      "    api: openai-completions",
      "    apiKey: none",
      "    models:",
      "      - id: fake-model",
      "        name: Fake model",
      "        contextWindow: 64000",
      "        maxTokens: 4096",
      "",
    ].join("\n"));
    const env = { ...process.env, ...episko.env, PWD: proj, PI_CODING_AGENT_DIR: agentDir };
    const { code, out } = await run(omp, ["-p", "Please read README.md", "--model", "fake/fake-model", "--extension", file], { cwd: proj, env });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(code, 0, out.slice(-2000));
    assert.deepEqual(episko.rejected, []);
    const { errors, events } = check(episko.envelopes);
    assert.deepEqual(errors, []);
    assertTurn(events);
  } finally {
    model.close();
    episko.close();
    rmSync(root, { recursive: true, force: true });
  }
});
