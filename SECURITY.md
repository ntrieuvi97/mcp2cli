# Security Policy

## Threat Model & Protections

1. **Untrusted Project Configurations:** Project-scoped files (such as `.mcp.json` or `.cursor/mcp.json`) checked into external repositories are treated as untrusted by default. `mcp2cli` refuses to auto-expand `${VAR}` placeholders or execute `stdio` servers referencing environment variables from untrusted project configs unless explicitly authorized with `--trust`.
2. **No Secrets in `argv`:** Passing tokens on the command line leaks credentials to `ps`, shell history, and agent logs. `mcp2cli` enforces `env:<VAR>`, `file:<PATH>`, or stdin-based vault ingestion (`--secret-stdin`) using an AES-256-GCM encrypted vault (`0600` permissions).
3. **Agent Input Hardening:** All dynamic inputs are checked for ASCII control characters (`\r`, `\n`, `\0`) and path traversal (`../`). Child processes are always spawned with `shell: false`.
4. **Non-TTY Safety Gates:** Destructive MCP tools (`destructiveHint: true`) and config-modifying commands (`migrate`, `restore`) refuse execution without a TTY unless `--yes` is explicitly supplied, and support `--dry-run`.

## Reporting a Vulnerability

Please report security issues privately via GitHub Security Advisories on `ntrieuvi97/mcp2cli` rather than opening a public issue.
