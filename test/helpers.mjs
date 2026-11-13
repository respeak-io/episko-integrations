// Loads an integration the way its agent would, with Episko's environment set and `fetch`
// replaced by a recorder, so a test sees exactly the POST bodies the agent would send.

export const ENV = { EPISKO_URL: "http://127.0.0.1:9/agent?sid=test-pane", EPISKO_TOKEN: "t0k3n" };

/** Every POST the module makes, parsed; `settle()` waits for the queue to drain. */
export function recordFetch() {
  const posts = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    posts.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  return {
    posts,
    envelopes: () => posts.map((p) => p.body),
    events: () => posts.flatMap((p) => p.body.events),
    settle: () => new Promise((r) => setTimeout(r, 20)),
    restore: () => { globalThis.fetch = original; },
  };
}

/** A fresh copy of the module per call: its queue and `ENABLED` are module state. */
export async function load(path, env = ENV) {
  const saved = { EPISKO_URL: process.env.EPISKO_URL, EPISKO_TOKEN: process.env.EPISKO_TOKEN };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    return await import(`${new URL(path, import.meta.url).href}?n=${Math.random()}`);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

export const types = (events) => events.map((e) => e.type);
