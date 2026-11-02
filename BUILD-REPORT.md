# burnmeter — Build Report

MCP Rebuild 1000 (Batch 8). Clean-room rebuild of
arsentev-ai/contextburn (rank 307, Tier C), built from the public
README spec captured in
`harness/fixtures/contextburn-tools-original.json`. That fixture is
docs-derived: the README enumerates exactly 2 tools and documents
no parameters for either, so both are recorded as parameterless —
no original server was probed. Parity proves the rebuild matches
this program's defined spec, labelled docs-derived. Local build
only — nothing pushed or published.

Identity: repo `burnmeter`, npm `@reneturcios/burnmeter`,
MCP name `io.github.CloudCorpRecords/burnmeter`, version `0.1.0`,
bin `burnmeter` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `burnmeter: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Local Claude Code token analytics:
  efficiency shares and per-model spend breakdown." = **83 chars**
  (≤100 ✓); npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/burnmeter:0.1.0` carries **no**
  `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/burnmeter"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`efficiency`, `breakdown`, `mcp`,
  `--version`; exit 2 usage / 1 report error), `src/mcp.ts`,
  `src/types.ts`, `src/burnmeter.ts` (core logic, `VERSION = "0.1.0"`)
- `test/burnmeter.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to burnmeter)

## Tools implemented (2)

`run_efficiency`, `spend_breakdown` — the full documented set, both
parameterless as documented in the fixture `_source`. No hours
argument was invented: the README documents an hours window only
for the original's CLI reports, not for the MCP tools.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server`
  (`sdk/server/index.js` + `StdioServerTransport`) with explicit
  inputSchema literals — both tools serve exactly
  `{type: "object", properties: {}}` — per the standing fleet rule:
  `McpServer`'s zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties` keys absent from the defined spec. Zod
  still validates every `tools/call`.
- Data source: Claude Code session JSONL logs. The directory comes
  from `CONTEXTBURN_LOG_DIR` (CLI: `--log-dir` wins over the env
  var) and defaults to `~/.claude/projects`; `*.jsonl` files are
  found recursively. No network access, no credentials.
- Parsing (documented local interpretation): every non-blank line
  is parsed as JSON; a line that fails to parse or parses to a
  non-object is skipped and counted in `malformedLines`. An entry
  carries usage when it has a usage object at the top level
  (`entry.usage`) or nested (`entry.message.usage`); from it,
  `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, and `cache_read_input_tokens` are
  summed (missing/non-numeric fields count as 0). The model is
  `message.model`, then top-level `model`, then `unknown`. Entries
  without a usage object are ignored.
- **Category mapping for `run_efficiency` shares (documented local
  interpretation, also recorded in the fixture `_source`):**
  output = `output_tokens`, input = `input_tokens`,
  cache-creation = `cache_creation_input_tokens`, cache-read =
  `cache_read_input_tokens`, each as a percentage of total tokens,
  rounded to two decimal places.
- `spend_breakdown` returns `logDir`, `filesScanned`,
  `entriesWithUsage`, `malformedLines`, `totals` (four counts plus
  `total_tokens`), and `byModel` (same counts per model plus an
  entry count, sorted by total tokens descending, then model name).
- Honesty rule: a missing log directory or zero usage entries is a
  zeroed report with an explicit `note` field ("No Claude Code
  usage entries found under …"), never an error and never
  fabricated data.
- All filesystem access goes through an injectable `LogFileSource`
  (types.ts) plus an injectable root directory, so tests run on
  temporary fixture JSONL (and one in-memory source) with no network
  and no real log directory.

## Verification (foreground, exact outputs)

### 1. Typecheck and build
```
$ ./node_modules/.bin/tsc --noEmit ; echo exit=$?
exit=0
$ npm run build   # tsc -> dist/, including dist/cli.js
exit=0
```

### 2. Tests
```
$ npm test   # tsx --test test/*.test.ts
ℹ tests 12
ℹ pass 12
ℹ fail 0
```
Covers, on real temporary fixture JSONL with hand-computed expected
sums (totals 310/165/65/110 = 650 across two files, one nested):
multi-file recursive sums ignoring non-`.jsonl` files; per-model
split (haiku 420, sonnet 230, sorted descending); malformed-line
skipping and counting with non-usage entries ignored; usage without
a model grouped under `unknown`; missing cache fields counting as
0; missing directory, empty directory, and no-usage files each
returning a zeroed report with the explicit note; efficiency shares
hand-computed (47.69 / 25.38 / 10 / 16.92) summing to ~100% (99.99
after two-decimal rounding); zeroed shares with a note when there
is no usage; log-dir resolution (default / env / explicit); and an
in-memory injected source analysed without the filesystem.

### 3. CLI / MCP smoke
`--version` → `0.1.0` (exit 0); no args and unknown command print
Usage and exit 2. `breakdown --log-dir <missing>` printed the
zeroed report with the note (exit 0). `efficiency --log-dir` on a
one-entry fixture printed totals 10/5/2/3 = 20 with shares
50/25/10/15. MCP `initialize` over stdio →
`serverInfo: {"name":"burnmeter","version":"0.1.0"}`;
`tools/list` returned exactly the 2 tools with empty-properties
schemas; a stdio `tools/call` for `spend_breakdown` with
`CONTEXTBURN_LOG_DIR` pointed at the smoke fixture returned the
matching per-model breakdown. No live Claude Code log directory was
read: `~/.claude/projects` does not exist in this VM, and no live
log read is claimed.

### 4. Parity (harness)
```
$ python3 ~/workspace/mcp-rebuild-100/harness/parity.py \
    --original ~/workspace/mcp-rebuild-100/harness/fixtures/contextburn-tools-original.json \
    --rebuild "stdio:node <abs path>/builds/burnmeter/dist/cli.js mcp" \
    --out ~/workspace/mcp-rebuild-100/builds/burnmeter/parity-out
verdict=PASS parity_pct=100.0 original_tools=2 rebuild_tools=2 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
(parity.json: identical_tools 2/2.) Original side is tools-file
mode, so `fixture_results` records `SKIPPED-TOOLS-FILE-MODE` —
expected harness semantics, not an error.

## Lockfile status

`package-lock.json` was generated clean via Route 3: a temp copy
holding only `package.json` (no `node_modules`, no `dist`), offline
`npm install --package-lock-only --ignore-scripts --offline`,
verified after generation — parses as JSON, top-level `name` is
`@reneturcios/burnmeter`, version `0.1.0`, `lockfileVersion` 3,
**128 package entries** — then only the lockfile was copied back.
Local `node_modules` is a sibling copy (fxrates) used only for the
local build/test; it is not part of the lockfile generation.

## Gaps / honest notes

- Docs-derived spec: the README documents the two tool names and
  their report purposes but no output schema, so parity proves the
  rebuild matches this program's defined spec (tool names + exact
  parameterless input schemas), not a hand-probed original. The
  report shapes and the efficiency category mapping are this
  rebuild's documented local interpretations, recorded here and in
  the fixture `_source`.
- Aggregation semantics (which entry shapes carry usage, model
  fallback to `unknown`, malformed-line counting) are likewise
  documented local choices; real Claude Code logs carry usage under
  `message.usage`, which is covered, as is the top-level shape.
- No live log read was performed or claimed (no
  `~/.claude/projects` in this VM); behaviour is proven on
  hand-computed temporary fixtures only.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
