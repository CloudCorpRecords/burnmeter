# burnmeter

burnmeter analyses Claude Code token spend from the session logs
already on your machine. It reads the JSONL session files, adds up
the token counts in every usage record, and reports two views: how
the total splits across output, input, cache-creation, and
cache-read (the efficiency view), and the full totals with a
per-model split (the breakdown view). One binary serves a
command-line interface and a stdio MCP server.

Everything is local. There is no network access, no API key, and no
account. The log directory is taken from `CONTEXTBURN_LOG_DIR` when
set and defaults to `~/.claude/projects`; every `*.jsonl` file
under it is read recursively.

## Install

```bash
npx @reneturcios/burnmeter breakdown
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/burnmeter
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead. Note the container reads logs
from inside the container, so mount your log directory and point
`CONTEXTBURN_LOG_DIR` at the mount if you use it for real logs.

## CLI

```bash
burnmeter efficiency
burnmeter breakdown
burnmeter breakdown --log-dir ~/somewhere/else

burnmeter --version
```

Both reports print JSON. `--log-dir` wins over `CONTEXTBURN_LOG_DIR`,
which wins over the `~/.claude/projects` default. Exit codes: `0` on
success, `1` when a report fails, `2` for usage errors.

A breakdown contains `logDir`, `filesScanned`, `entriesWithUsage`,
`malformedLines`, `totals` (the four token counts plus
`total_tokens`), and `byModel` (the same counts per model, with an
entry count, sorted by total tokens descending). An efficiency
report contains the same scan fields and totals, plus `shares`:
each category as a percentage of total tokens, rounded to two
decimal places.

How entries are counted: a log line that is not valid JSON (or not
a JSON object) is skipped and counted in `malformedLines`. An entry
counts when it carries a usage object, either at the top level or
under its `message`; the four counts `input_tokens`,
`output_tokens`, `cache_creation_input_tokens`, and
`cache_read_input_tokens` are summed, with a missing or non-numeric
field counting as 0. The model is `message.model`, falling back to a
top-level `model`, falling back to `unknown`. Entries without a
usage object are ignored.

When the directory is missing or no usage entries are found, the
report is not an error and no numbers are invented: totals and
shares are zero, and the report carries a `note` field saying no
usage entries were found and where it looked.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/burnmeter mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "burnmeter": {
      "command": "npx",
      "args": ["-y", "@reneturcios/burnmeter", "mcp"]
    }
  }
}
```

To read logs from a non-default directory, add `CONTEXTBURN_LOG_DIR`
to the client's `env` for this server.

### Tools

Both tools are parameterless, as documented in the original tool's
public spec.

| Tool | Input | What it returns |
| --- | --- | --- |
| `run_efficiency` | (none) | The efficiency report: totals plus each category's share of total tokens. |
| `spend_breakdown` | (none) | The full breakdown report: totals plus the per-model split. |

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (temporary fixture logs only)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
