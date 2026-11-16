// Every folder under agents/ with its integration.json parsed: the one list the tests, the
// e2e run and the CI install read, so adding an agent is adding a folder.

import { readFileSync, readdirSync } from "node:fs";

export const AGENTS_DIR = new URL("../agents/", import.meta.url);

/** @returns {{ id: string, dir: URL, spec: any }[]} sorted by id */
export function agents() {
  return readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((id) => {
      const dir = new URL(`${id}/`, AGENTS_DIR);
      let spec;
      try {
        spec = JSON.parse(readFileSync(new URL("integration.json", dir), "utf8"));
      } catch (err) {
        throw new Error(`agents/${id}/integration.json: ${err.message}`);
      }
      return { id, dir, spec };
    });
}
