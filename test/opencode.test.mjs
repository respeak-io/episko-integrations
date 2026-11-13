// The OpenCode plugin replayed against payloads recorded from a real OpenCode 1.19.5 run
// (test/fixtures, paths anonymised): the same calls, in the same order, OpenCode made.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check } from "../protocol/checker.mjs";
import { load, recordFetch, types } from "./helpers.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

const client = { config: { providers: async () => ({ data: { providers: [{ id: "fake", models: { "fake-model": { limit: { context: 64000 } } } }] } }) } };

async function replay(rows, ctx = { client }) {
  const mod = await load("../opencode/episko.ts");
  assert.deepEqual(Object.keys(mod), ["EpiskoPlugin"], "OpenCode calls every export as a plugin");
  const hooks = await mod.EpiskoPlugin(ctx);
  for (const { kind, data } of rows) {
    if (kind === "event") await hooks.event({ event: data });
    else if (kind === "chat.message") await hooks["chat.message"](data.input, data.output);
  }
  return hooks;
}

test("a recorded OpenCode turn arrives valid and in order", async () => {
  const net = recordFetch();
  try {
    await replay(fixture("opencode-1.19.5-read.jsonl"));
    await net.settle();
    const { errors, events } = check(net.envelopes());
    assert.deepEqual(errors, []);
    const order = types(events).filter((t) => t !== "usage" && t !== "session");
    assert.deepEqual(order, ["turn-start", "prompt", "tool-start", "tool-end", "answer", "turn-end"]);
    // The recording's argv reached OpenCode quoted (Windows), and the plugin passes it on as typed.
    assert.match(events.find((e) => e.type === "prompt").text, /^"?Please read README\.md"?$/);
    const start = events.find((e) => e.type === "tool-start");
    assert.deepEqual([start.id, start.name, start.summary], ["call_1", "read", "README.md"]);
    const end = events.find((e) => e.type === "tool-end");
    assert.equal(end.failed, false);
    assert.deepEqual(end.files, [{ path: "README.md", kind: "read" }]);
    assert.equal(events.find((e) => e.type === "answer").text, "Read it. All done.");
    assert.equal(events.find((e) => e.type === "turn-end").failed, false);
    const session = events.find((e) => e.type === "session" && e.id);
    assert.match(session.id, /^ses_/);
    const usage = events.findLast((e) => e.type === "usage");
    assert.deepEqual(usage.totals, { input: 2400, output: 60, cacheRead: 0, cacheWrite: 0, reasoning: 0 });
    assert.equal(usage.contextTokens, 1200);
    assert.equal(usage.contextWindow, 64000);
    assert.ok(!events.some((e) => e.type === "session" && /^New session/.test(e.title ?? "")), "placeholder title leaked");
  } finally {
    net.restore();
  }
});

test("a subagent's session is not the pane's", async () => {
  const net = recordFetch();
  try {
    const child = "ses_child";
    await replay([
      { kind: "event", data: { type: "session.created", properties: { sessionID: child, info: { id: child, parentID: "ses_parent", title: "explore" } } } },
      { kind: "chat.message", data: { input: { sessionID: child }, output: { message: { id: "m1" }, parts: [{ type: "text", text: "look around" }] } } },
      { kind: "event", data: { type: "session.status", properties: { sessionID: child, status: { type: "busy" } } } },
      { kind: "event", data: { type: "message.part.updated", properties: { sessionID: child, part: { type: "tool", sessionID: child, callID: "c1", tool: "read", state: { status: "completed", input: { filePath: "a" }, output: "x" } } } } },
      { kind: "event", data: { type: "session.status", properties: { sessionID: child, status: { type: "idle" } } } },
    ]);
    await net.settle();
    assert.deepEqual(net.events(), []);
  } finally {
    net.restore();
  }
});

test("a session error fails the turn and says why", async () => {
  const net = recordFetch();
  try {
    const s = "ses_main";
    await replay([
      { kind: "event", data: { type: "session.created", properties: { sessionID: s, info: { id: s, title: "New session - 2026-11-13T00:00:00.000Z" } } } },
      { kind: "event", data: { type: "session.status", properties: { sessionID: s, status: { type: "busy" } } } },
      { kind: "event", data: { type: "session.error", properties: { sessionID: s, error: { name: "ProviderAuthError", data: { message: "No API key for fake" } } } } },
      { kind: "event", data: { type: "session.status", properties: { sessionID: s, status: { type: "idle" } } } },
    ]);
    await net.settle();
    const { errors, events } = check(net.envelopes());
    assert.deepEqual(errors, []);
    assert.deepEqual(events.find((e) => e.type === "error"), { type: "error", message: "No API key for fake" });
    assert.deepEqual(events.find((e) => e.type === "turn-end"), { type: "turn-end", failed: true, error: "No API key for fake", durationMs: events.find((e) => e.type === "turn-end").durationMs });
  } finally {
    net.restore();
  }
});

test("a write says whether it made the file", async () => {
  const net = recordFetch();
  try {
    const s = "ses_w";
    const tool = (callID, exists) => ({ kind: "event", data: { type: "message.part.updated", properties: { sessionID: s, part: {
      type: "tool", sessionID: s, callID, tool: "write", state: { status: "completed", input: { filePath: `src/${callID}.ts` }, output: "", metadata: { exists } },
    } } } });
    await replay([tool("new", false), tool("old", true)]);
    await net.settle();
    const ends = net.events().filter((e) => e.type === "tool-end").map((e) => e.files[0]);
    assert.deepEqual(ends, [{ path: "src/new.ts", kind: "created" }, { path: "src/old.ts", kind: "edited" }]);
  } finally {
    net.restore();
  }
});

test("todo.updated becomes the plan", async () => {
  const net = recordFetch();
  try {
    await replay([{ kind: "event", data: { type: "todo.updated", properties: { sessionID: "ses_t", todos: [
      { content: "Write it", status: "completed", priority: "high", id: "1" },
      { content: "Test it", status: "in_progress", priority: "high", id: "2" },
    ] } } }]);
    await net.settle();
    assert.deepEqual(net.events().find((e) => e.type === "plan").items, [
      { text: "Write it", status: "completed" }, { text: "Test it", status: "in_progress" },
    ]);
  } finally {
    net.restore();
  }
});

test("garbage from OpenCode never comes back as a throw", async () => {
  const net = recordFetch();
  try {
    const hooks = await replay([], { client: { config: { providers: () => { throw new Error("no server"); } } } });
    for (const event of [null, 42, "x", { type: "message.updated" }, { type: "message.updated", properties: { info: { role: "assistant", modelID: "m", providerID: "p", tokens: "lots" } } }]) {
      await assert.doesNotReject(hooks.event({ event }));
    }
    await assert.doesNotReject(hooks["chat.message"](null, null));
    await net.settle();
    assert.deepEqual(check(net.envelopes()).errors, []);
  } finally {
    net.restore();
  }
});

test("without Episko's environment the plugin adds no hooks", async () => {
  const mod = await load("../opencode/episko.ts", { EPISKO_URL: undefined, EPISKO_TOKEN: undefined });
  assert.deepEqual(await mod.EpiskoPlugin({ client }), {});
});
