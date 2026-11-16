// How the e2e run points OMP at the scripted model, in an agent dir of its own so the
// runner's OMP config stays out of it. Loading the extension is integration.json's job,
// applied by e2e/agents.test.mjs.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function setup({ root, model, prompt }) {
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
  return { args: ["-p", prompt, "--model", "fake/fake-model"], env: { PI_CODING_AGENT_DIR: agentDir } };
}
