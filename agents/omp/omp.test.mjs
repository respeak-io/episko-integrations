// The OMP extension driven through a stand-in for OMP's ExtensionAPI. Event names and
// payload shapes follow OMP's docs/extensions.md and hooks.md; e2e/agents.test.mjs runs the
// real CLI where one is installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../protocol/checker.mjs";
import { ENV, load, recordFetch, types } from "../../test/helpers.mjs";

const EXT = new URL("./episko.ts", import.meta.url);

function fakePi() {
  const handlers = new Map();
  return {
    handlers,
    on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    getSessionName: () => "Fix the parser",
    fire: (name, event, ctx) => (handlers.get(name) ?? []).map((fn) => fn(event, ctx)),
  };
}

const ctx = (over = {}) => ({
  agent: { kind: "main", id: "main", name: "main", depth: 0 },
  sessionManager: { getSessionId: () => "sess-1" },
  model: { id: "fake-model" },
  getContextUsage: () => ({ tokens: 1500, contextWindow: 64000, percent: 2.3 }),
  ...over,
});

const assistant = (text, usage) => ({
  role: "assistant",
  content: [{ type: "text", text }],
  usage: { input: 1000, output: 50, cacheRead: 200, cacheWrite: 0, totalTokens: 1250, cost: { total: 0.01 }, ...usage },
  stopReason: "stop",
});

async function oneTurn(pi, c = ctx()) {
  pi.fire("session_start", { type: "session_start" }, c);
  pi.fire("before_agent_start", { prompt: "Read the README" }, c);
  pi.fire("agent_start", {}, c);
  pi.fire("tool_call", { toolCallId: "call_1", toolName: "read", input: { path: "/repo/README.md" } }, c);
  pi.fire("tool_result", { toolCallId: "call_1", toolName: "read", input: { path: "/repo/README.md" }, content: [{ type: "text", text: "# Hi" }], isError: false }, c);
  pi.fire("message_end", { message: assistant("It says hi.") }, c);
  pi.fire("agent_end", { messages: [assistant("It says hi.")], isTerminal: true }, c);
}

test("a turn arrives in order, valid, and attributed to the pane's token", async () => {
  const net = recordFetch();
  try {
    const { default: episko } = await load(EXT);
    const pi = fakePi();
    episko(pi);
    await oneTurn(pi);
    await net.settle();
    const { errors, events } = check(net.envelopes());
    assert.deepEqual(errors, []);
    assert.deepEqual(types(events), [
      "session", "usage", "prompt", "turn-start", "tool-start", "tool-end", "usage", "cost", "answer", "turn-end", "usage",
    ]);
    const [session] = events;
    assert.deepEqual(session, { type: "session", id: "sess-1", model: "fake-model", title: "Fix the parser" });
    assert.deepEqual(events.find((e) => e.type === "tool-end").files, [{ path: "/repo/README.md", kind: "read" }]);
    assert.equal(events.find((e) => e.type === "tool-start").summary, "README.md");
    assert.equal(events.find((e) => e.type === "answer").text, "It says hi.");
    assert.deepEqual(events.findLast((e) => e.type === "usage"), {
      type: "usage", totals: { input: 1000, output: 50, cacheRead: 200, cacheWrite: 0 }, contextTokens: 1500, contextWindow: 64000,
    });
    for (const p of net.posts) {
      assert.equal(p.url, ENV.EPISKO_URL);
      assert.equal(p.headers.authorization, `Bearer ${ENV.EPISKO_TOKEN}`);
    }
  } finally {
    net.restore();
  }
});

test("a subagent's turn is not the pane's", async () => {
  const net = recordFetch();
  try {
    const { default: episko } = await load(EXT);
    const pi = fakePi();
    episko(pi);
    await oneTurn(pi, ctx({ agent: { kind: "sub", id: "explore", name: "explore", depth: 1 } }));
    await net.settle();
    assert.deepEqual(net.events(), []);
  } finally {
    net.restore();
  }
});

test("a continuation stays inside the turn it continues", async () => {
  const net = recordFetch();
  try {
    const { default: episko } = await load(EXT);
    const pi = fakePi();
    episko(pi);
    const c = ctx();
    pi.fire("agent_start", {}, c);
    pi.fire("agent_end", { messages: [], isTerminal: false }, c);
    pi.fire("agent_start", {}, c);
    pi.fire("agent_end", { messages: [assistant("done")], isTerminal: true }, c);
    await net.settle();
    assert.deepEqual(types(net.events()).filter((t) => t.startsWith("turn")), ["turn-start", "turn-end"]);
    assert.deepEqual(check(net.envelopes()).errors, []);
  } finally {
    net.restore();
  }
});

test("a failed model call ends the turn as failed, with OMP's reason", async () => {
  const net = recordFetch();
  try {
    const { default: episko } = await load(EXT);
    const pi = fakePi();
    episko(pi);
    const c = ctx();
    pi.fire("agent_start", {}, c);
    pi.fire("agent_end", { messages: [{ role: "assistant", content: [], stopReason: "error", errorMessage: "529 overloaded" }] }, c);
    await net.settle();
    const end = net.events().find((e) => e.type === "turn-end");
    assert.equal(end.failed, true);
    assert.equal(end.error, "529 overloaded");
  } finally {
    net.restore();
  }
});

test("switching OMP sessions restarts the totals, as the protocol asks", async () => {
  const net = recordFetch();
  try {
    const { default: episko } = await load(EXT);
    const pi = fakePi();
    episko(pi);
    let id = "sess-1";
    const c = ctx({ sessionManager: { getSessionId: () => id } });
    pi.fire("session_start", {}, c);
    pi.fire("message_end", { message: assistant("a") }, c);
    id = "sess-2";
    pi.fire("message_end", { message: assistant("b") }, c);
    await net.settle();
    const { errors, events } = check(net.envelopes());
    assert.deepEqual(errors, []);
    const costs = events.filter((e) => e.type === "cost").map((e) => e.totalUsd);
    assert.deepEqual(costs, [0.01, 0.01]);
    assert.deepEqual(events.filter((e) => e.type === "session").map((e) => e.id), ["sess-1", "sess-2"]);
  } finally {
    net.restore();
  }
});

test("a todo result becomes the plan", async () => {
  const net = recordFetch();
  try {
    const { default: episko } = await load(EXT);
    const pi = fakePi();
    episko(pi);
    const c = ctx();
    pi.fire("tool_call", { toolCallId: "t1", toolName: "todo", input: {} }, c);
    pi.fire("tool_result", {
      toolCallId: "t1", toolName: "todo", input: {}, content: [], isError: false,
      details: { phases: [{ name: "Todos", tasks: [{ content: "Map it", status: "in_progress" }, { content: "Ship it", status: "weird" }] }] },
    }, c);
    await net.settle();
    assert.deepEqual(net.events().find((e) => e.type === "plan").items, [
      { text: "Map it", status: "in_progress" }, { text: "Ship it", status: "pending" },
    ]);
  } finally {
    net.restore();
  }
});

test("a hostile payload never reaches OMP as a throw, and never blocks a tool", async () => {
  const net = recordFetch();
  try {
    const { default: episko } = await load(EXT);
    const pi = fakePi();
    episko(pi);
    const cyclic = {}; cyclic.self = cyclic;
    const bad = { get agent() { throw new Error("boom"); } };
    assert.doesNotThrow(() => pi.fire("session_start", {}, bad));
    const results = pi.fire("tool_call", { toolCallId: "x", toolName: "bash", input: cyclic }, ctx());
    assert.deepEqual(results, [undefined]);
    assert.doesNotThrow(() => pi.fire("message_end", null, ctx()));
    assert.doesNotThrow(() => pi.fire("agent_end", undefined, ctx()));
    await net.settle();
    assert.deepEqual(check(net.envelopes()).errors, []);
  } finally {
    net.restore();
  }
});

test("without Episko's environment it registers nothing", async () => {
  const { default: episko } = await load(EXT, { EPISKO_URL: undefined, EPISKO_TOKEN: undefined });
  const pi = fakePi();
  episko(pi);
  assert.equal(pi.handlers.size, 0);
});

test("a URL that is not this machine's loopback is never posted to", async () => {
  const { default: episko } = await load(EXT, { EPISKO_URL: "https://example.com/agent", EPISKO_TOKEN: "x" });
  const pi = fakePi();
  episko(pi);
  assert.equal(pi.handlers.size, 0);
});
