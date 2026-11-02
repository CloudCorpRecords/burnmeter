# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `burnmeter efficiency`, `burnmeter breakdown`, and
  `burnmeter mcp` (both reports accept `--log-dir <path>`).
- MCP server (`burnmeter mcp`, stdio) with two parameterless tools:
  `run_efficiency` and `spend_breakdown`.
- Reads Claude Code session JSONL logs from the directory named by
  `CONTEXTBURN_LOG_DIR`, defaulting to `~/.claude/projects`, found
  recursively as `*.jsonl` files. No network access, no credentials.
- Sums `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, and `cache_read_input_tokens`
  wherever a log entry carries a usage object. Malformed lines are
  skipped and counted.
- `run_efficiency` reports each category as a percentage share of
  total tokens; `spend_breakdown` reports totals plus a per-model
  split. When no usage entries are found, both return a zeroed
  report with an explicit `note` instead of failing.
- All filesystem access goes through an injectable log source, so
  the test suite runs entirely on temporary fixture logs.
