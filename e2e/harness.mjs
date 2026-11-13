// The two servers an end-to-end run needs, both on 127.0.0.1 and both free of tokens:
// a scripted OpenAI-compatible model, and a stand-in for Episko's `/agent` endpoint.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const listen = (server) => new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error", reject);
});

// Picks the parameter a read tool takes its path in, whatever the agent calls it.
function readArgs(tool, path) {
  const props = tool.function?.parameters?.properties ?? {};
  const key = ["path", "filePath", "file_path", "file"].find((k) => k in props) ?? "path";
  return { [key]: path };
}

/**
 * The model's whole script: asked anything with a `read` tool on offer, it reads `readPath`;
 * shown that tool's result, it answers `answer`. A request with no tools (a title, a summary)
 * gets `title`. Streams like OpenAI's chat completions, usage chunk included.
 */
export async function startFakeModel({ readPath = "README.md", answer = "Read it. All done.", title = "E2E session" } = {}) {
  const requests = [];
  let calls = 0;
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "fake-model", object: "model", owned_by: "e2e" }] }));
      return;
    }
    if (req.method !== "POST" || !req.url.includes("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(await readBody(req));
    requests.push(body);
    const messages = body.messages ?? [];
    const last = messages[messages.length - 1];
    const read = (body.tools ?? []).find((t) => /^read$/i.test(t.function?.name ?? ""));
    let delta;
    let finish;
    if (last?.role === "tool") {
      delta = { content: answer };
      finish = "stop";
    } else if (read) {
      calls += 1;
      delta = { tool_calls: [{ index: 0, id: `call_${calls}`, type: "function", function: { name: read.function.name, arguments: JSON.stringify(readArgs(read, readPath)) } }] };
      finish = "tool_calls";
    } else {
      delta = { content: title };
      finish = "stop";
    }
    const usage = { prompt_tokens: 1200, completion_tokens: 30, total_tokens: 1230 };
    const base = { id: `chatcmpl-${requests.length}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model };
    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      const message = { role: "assistant", content: delta.content ?? null, ...(delta.tool_calls ? { tool_calls: delta.tool_calls.map(({ index, ...c }) => c) } : {}) };
      res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message, finish_reason: finish }], usage }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (chunk) => res.write(`data: ${JSON.stringify({ ...base, ...chunk })}\n\n`);
    send({ choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
    send({ choices: [{ index: 0, delta, finish_reason: null }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: finish }] });
    send({ choices: [], usage });
    res.end("data: [DONE]\n\n");
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}/v1`, requests, close: () => server.close() };
}

/** Episko's side of the wire: checks the bearer token, keeps every envelope it was sent. */
export async function startEpisko({ sid = "e2e-pane" } = {}) {
  const token = randomBytes(16).toString("hex");
  const envelopes = [];
  const rejected = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const auth = req.headers.authorization ?? "";
    if (!req.url.startsWith(`/agent?sid=${sid}`) || auth !== `Bearer ${token}`) {
      rejected.push({ url: req.url, auth });
      res.writeHead(401).end();
      return;
    }
    try { envelopes.push(JSON.parse(body)); } catch { rejected.push({ url: req.url, body }); }
    res.writeHead(204).end();
  });
  const port = await listen(server);
  return {
    env: { EPISKO_URL: `http://127.0.0.1:${port}/agent?sid=${sid}`, EPISKO_TOKEN: token },
    envelopes,
    rejected,
    events: () => envelopes.flatMap((e) => e.events ?? []),
    close: () => server.close(),
  };
}
