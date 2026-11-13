// Checks what an extension sent against the protocol: every POST body against the schema
// Episko owns, then the rules a schema cannot say (order, pairing, totals that only grow).
// Usage from a test: `const { errors } = check(envelopes)`; empty means Episko would show it.

import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(readFileSync(new URL("./v1.schema.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const TOTALS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];

/** @param {unknown[]} envelopes every POST body, in the order they were sent */
export function check(envelopes) {
  const errors = [];
  const events = [];
  envelopes.forEach((body, i) => {
    if (!validate(body)) {
      for (const e of validate.errors ?? []) errors.push(`POST ${i}: ${e.instancePath || "/"} ${e.message}`);
      return;
    }
    events.push(...body.events);
  });

  let inTurn = false;
  const open = new Set();
  const closed = new Set();
  let session = "";
  let cost = 0;
  let totals = {};
  events.forEach((e, i) => {
    const at = `event ${i} (${e.type})`;
    switch (e.type) {
      case "session":
        if (e.id && e.id !== session) { session = e.id; cost = 0; totals = {}; }
        break;
      case "turn-start":
        if (inTurn) errors.push(`${at}: a turn started inside a turn`);
        inTurn = true;
        break;
      case "turn-end":
        if (!inTurn) errors.push(`${at}: a turn ended that never started`);
        inTurn = false;
        break;
      case "answer":
        if (!inTurn) errors.push(`${at}: an answer outside a turn`);
        break;
      case "tool-start":
        if (open.has(e.id) || closed.has(e.id)) errors.push(`${at}: tool id ${e.id} started twice`);
        open.add(e.id);
        break;
      case "tool-end":
        if (!open.has(e.id)) errors.push(`${at}: tool id ${e.id} ended without a tool-start`);
        open.delete(e.id);
        closed.add(e.id);
        break;
      case "cost":
        if (e.totalUsd < cost) errors.push(`${at}: totalUsd fell from ${cost} to ${e.totalUsd} within one session`);
        cost = e.totalUsd;
        break;
      case "usage":
        for (const k of TOTALS) {
          const v = e.totals?.[k];
          if (v === undefined) continue;
          if (v < (totals[k] ?? 0)) errors.push(`${at}: totals.${k} fell from ${totals[k]} to ${v} within one session`);
          totals[k] = v;
        }
        break;
    }
  });
  return { errors, events };
}
