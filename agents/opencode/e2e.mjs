// How the e2e run points OpenCode at the scripted model and keeps it off the runner's own
// config. Loading the extension is integration.json's job, applied by e2e/agents.test.mjs.

import assert from "node:assert/strict";
import { join } from "node:path";

export function setup({ root, model, prompt }) {
  const config = {
    $schema: "https://opencode.ai/config.json", autoupdate: false, share: "disabled", model: "fake/fake-model",
    provider: { fake: { npm: "@ai-sdk/openai-compatible", name: "Fake", options: { baseURL: model.url, apiKey: "none" },
      models: { "fake-model": { name: "Fake model", limit: { context: 64000, output: 4096 } } } } },
  };
  const xdg = join(root, "xdg");
  return {
    args: ["run", prompt, "-m", "fake/fake-model"],
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_AUTOUPDATE: "1",
      XDG_CONFIG_HOME: join(xdg, "config"), XDG_DATA_HOME: join(xdg, "data"), XDG_STATE_HOME: join(xdg, "state"),
      XDG_CACHE_HOME: process.env.E2E_CACHE ?? join(xdg, "cache"),
    },
    // The window comes from the provider's config, which the plugin has to ask OpenCode for.
    check: (events) => assert.equal(events.findLast((e) => e.type === "usage").contextWindow, 64000),
  };
}
