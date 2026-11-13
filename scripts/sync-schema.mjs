// Copies the protocol schema from an Episko checkout, which owns it. Usage:
//   node scripts/sync-schema.mjs [path/to/episko]   (default: ../episko)
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const episko = resolve(process.argv[2] ?? "../episko");
const from = resolve(episko, "src/providers/protocol-v1.schema.json");
copyFileSync(from, new URL("../protocol/v1.schema.json", import.meta.url));
console.log(`protocol/v1.schema.json <- ${from}`);
