// Installs every agent CI runs, at the version its integration.json pins or at the newest
// release, then prints what it got. Usage: node scripts/install-agents.mjs [pinned|latest]

import { execSync } from "node:child_process";
import { agents } from "./agents.mjs";

const which = process.argv[2] ?? "pinned";
if (!["pinned", "latest"].includes(which)) {
  console.error(`usage: install-agents.mjs [pinned|latest], not ${which}`);
  process.exit(1);
}
const list = agents();
for (const { id, spec } of list) {
  const { manager, name } = spec.package;
  const version = which === "latest" ? "latest" : spec.testedWith;
  // These reach a shell; the schema says the same, but nothing has checked it yet in this job.
  if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || !/^(latest|\d+\.\d+\.\d+)$/.test(version)) {
    throw new Error(`${id}: refusing to install ${name}@${version}`);
  }
  const cmd = manager === "bun" ? `bun install -g ${name}@${version}` : `npm i -g ${name}@${version}`;
  console.log(`${id}: ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}
for (const { id, spec } of list) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(spec.bin)) throw new Error(`${id}: odd bin ${spec.bin}`);
  process.stdout.write(`${id}: `);
  execSync(`${spec.bin} --version`, { stdio: "inherit" });
}
