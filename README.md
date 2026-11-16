# episko-integrations

Extensions that let a coding agent report to [Episko](https://github.com/respeak-io/episko)
over its agent protocol. Each one runs inside its agent, translates that agent's own events
into the protocol, and posts them to the Episko instance that started the agent. Episko then
shows the session's phase, tool calls, files, plan, tokens and cost, the way it does for
Claude Code and Codex.

| Agent | Extension | Loaded by Episko as | Status |
| --- | --- | --- | --- |
| [OMP (oh-my-pi)](https://github.com/can1357/oh-my-pi) | [`agents/omp/`](agents/omp) | `omp --extension <file>` | observe-only |
| [OpenCode](https://opencode.ai) | [`agents/opencode/`](agents/opencode) | `OPENCODE_CONFIG_DIR=<dir>` with `plugins/episko.ts` | observe-only |

Nothing to install: Episko ships these files and loads them for each launch. Outside
Episko they do nothing, because they only act when Episko's `EPISKO_URL` and `EPISKO_TOKEN`
are in their environment.

## Layout

One folder per agent, so adding one never touches the rest:

```text
agents/<id>/
  integration.json   name, how CI installs it, the version it is tested with, what it
                     reports, and how Episko loads it (agents/integration.schema.json)
  episko.ts          the extension
  <id>.test.mjs      recorded payloads replayed through it
  e2e.mjs            how the e2e run points this agent at the scripted model
  fixtures/          the recordings
```

`protocol/` holds the schema copy and the checker, `test/` the cross-agent rules, `e2e/` the
runner and its two fake servers, `scripts/agents.mjs` the one list everything iterates.

## How Episko picks a change up

Episko never builds from this repository at runtime. Once a day a workflow in Episko
copies `main` (each `episko.ts` and the Episko-facing half of each `integration.json`) and
opens a pull request there if anything changed; it refuses a commit whose CI here did not
pass. So `main` only takes changes through a pull request with green checks, and what
merges here reaches users with Episko's next release, after someone merged that PR.

## The protocol

The contract lives in the Episko repository:
[`docs/agent-protocol.md`](https://github.com/respeak-io/episko/blob/dev/docs/agent-protocol.md)
for the prose and `src/providers/protocol-v1.schema.json` for the schema.
[`protocol/v1.schema.json`](protocol/v1.schema.json) here is a copy; refresh it with
`npm run schema -- ../episko`.

Four rules hold for every extension, because it runs inside someone else's process:

1. It never throws into the agent and never waits on Episko.
2. It ends when the agent ends; it starts nothing of its own.
3. It has exactly the agent's rights and asks for none.
4. It posts only to `http://127.0.0.1:…` and only the events the protocol defines.

## Tests

```sh
npm ci
npm test       # replays recorded agent payloads through each extension
npm run e2e    # runs each extension inside the real CLI, if installed
```

`npm run e2e` starts a scripted OpenAI-compatible model and a stand-in for Episko, both on
loopback, then has the agent read `README.md` and answer. No account and no tokens are
involved. `protocol/checker.mjs` validates every POST against the schema and checks the
rules a schema cannot express: tool calls pair up, turns don't nest, totals only grow.
Set `<ID>_BIN` (`OPENCODE_BIN`, `OMP_BIN`) to test a specific binary. CI installs each
agent at its `testedWith` on every change and at its newest release every night
(`scripts/install-agents.mjs`).

## Adding an agent

An agent qualifies when it has a public, per-launch way to load code into its own process
(a flag, an environment variable, a config directory). Reading its screen does not count.
An integration is accepted here when CI can run the real CLI against the scripted model;
otherwise nobody would notice when the agent's next release breaks it.

1. Add `agents/<id>/` with the four files above. `<id>` is the id Episko files the agent
   under, so it must match the agent's row in Episko's catalogue. Copy the client block
   from an existing extension unchanged (`test/client.test.mjs` checks the copies match).
2. Record a real run, anonymise the paths, and replay it in `<id>.test.mjs`.
3. Claim only the capabilities the extension sends; `npm test` checks `integration.json`
   against the schema, and CI installs and runs the agent from it with no other change.
4. Once it is on `main`, Episko's next vendoring pull request carries it
   (`docs/agent-protocol.md` § Adding an agent).

## Credits

The OMP extension started from Jason Perez's OMP adapter in
[jasonmarkperez/episko](https://github.com/jasonmarkperez/episko).

## License

MIT, as Episko.
