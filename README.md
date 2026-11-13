# episko-integrations

Extensions that let a coding agent report to [Episko](https://github.com/respeak-io/episko)
over its agent protocol. Each one runs inside its agent, translates that agent's own events
into the protocol, and posts them to the Episko instance that started the agent. Episko then
shows the session's phase, tool calls, files, plan, tokens and cost, the way it does for
Claude Code and Codex.

| Agent | Extension | Loaded by Episko as | Status |
| --- | --- | --- | --- |
| [OMP (oh-my-pi)](https://github.com/can1357/oh-my-pi) | [`omp/episko.ts`](omp/episko.ts) | `omp --extension <file>` | observe-only |
| [OpenCode](https://opencode.ai) | [`opencode/episko.ts`](opencode/episko.ts) | `OPENCODE_CONFIG_DIR=<dir>` with `plugins/episko.ts` | observe-only |

Nothing to install: Episko ships these files and loads them for each launch. Outside
Episko they do nothing, because they only act when Episko's `EPISKO_URL` and `EPISKO_TOKEN`
are in their environment.

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
Set `OPENCODE_BIN` or `OMP_BIN` to test a specific binary. CI runs the pinned versions
on every change and the newest releases every night.

## Adding an agent

An agent qualifies when it has a public, per-launch way to load code into its own process
(a flag, an environment variable, a config directory). Reading its screen does not count.
An integration is accepted here when CI can run the real CLI against the scripted model;
otherwise nobody would notice when the agent's next release breaks it.

1. Add `<agent>/episko.ts`. Copy the client block from an existing extension unchanged
   (`test/client.test.mjs` checks the copies match).
2. Record a real run (see `test/fixtures`), anonymise the paths, and replay it in
   `test/<agent>.test.mjs`.
3. Add the agent to `e2e/agents.test.mjs` and to the CI matrix.
4. In Episko, add a manifest row with a `protocol` block and vendor the file
   (`docs/agent-protocol.md` § Adding an agent).

## Credits

The OMP extension started from Jason Perez's OMP adapter in
[jasonmarkperez/episko](https://github.com/jasonmarkperez/episko).

## License

MIT, as Episko.
