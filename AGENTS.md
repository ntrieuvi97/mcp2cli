# `mcp2cli` — Instructions for AI Agents (`AGENTS.md`)

This repository implements `@ntrieuvi97/mcp2cli`, a cross-platform TypeScript framework for converting MCP servers into token-efficient CLIs, scripts, SDKs, and Agent Skills (`SKILL.md`).

## Quick Commands

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
```

## Design Invariants

1. **Zero Native Addons:** Never introduce native C++/Rust `.node` dependencies in core runtime paths. Keep compatibility across Linux (`glibc`/`musl`), macOS, Windows (PowerShell/`cmd.exe`), BSD, and Android Termux.
   - Detect CLI entrypoint via `fs.realpathSync(process.argv[1])` + `import.meta.url` (never `.endsWith('cli.js')`) so global `npm`/`npx` symlinks execute cleanly.
   - In generated JS/TS/Python wrappers spawning `mcp2cli` with `shell: false`, resolve Windows `.cmd` shims (`process.platform === 'win32' ? 'mcp2cli.cmd' : 'mcp2cli'` in JS/TS; `shutil.which("mcp2cli")` in Python) and forward `process.execArgv` for detached daemons.
2. **clispec v0.2 Compliance:**
   - `mcp2cli schema` MUST work offline without auth or network.
   - `stdout` carries data only; `stderr` carries diagnostics and a single-line JSON error envelope (`{"error":{"kind","message","hint","retryable"}}`) as the last line on failure.
   - Never hang waiting for interactive input when `!process.stdin.isTTY`.
   - For dynamic-flag subcommands (e.g., `run`), use `.argument('[extra...]')` with `.allowUnknownOption(true)` instead of `.passThroughOptions()` so known CLI options still parse anywhere.
3. **Zero-Trust Security:**
   - Never accept secrets on CLI `argv`. Use `env:VAR`, `file:/path`, or `mcp2cli vault set KEY --secret-stdin`.
   - Never auto-expand `${VAR}` from untrusted project-local configs without explicit `--trust`.
   - Always spawn subprocesses with `shell: false`.
4. **English-First, Vietnamese Secondary:** Keep code, comments, CLI messages, and primary docs in English; mirror major user guides in `README.vi.md` and `docs/vi/`.
5. **Client Discovery & Migration:**
   - Claude Code `claude mcp add` defaults to `local` scope, storing entries under `projects[<path>].mcpServers` (and `disabledMcpServers`) inside `~/.claude.json` — scan and park/restore per-project containers in addition to top-level `mcpServers`.
   - Claude Code plugins (`~/.claude/plugins/installed_plugins.json` + `enabledPlugins` in `settings*.json`) often use flat `.mcp.json` maps without a `mcpServers` wrapper and must be marked `readonlyConfig: true` so `migrate` never mutates plugin cache directories.
   - Account-synced `claude.ai` Cloud Connectors (e.g., Atlassian Rovo MCP) live on Anthropic's cloud with OAuth; handle HTTP 401/OAuth endpoints with an actionable `npx -y mcp-remote <url>` hint (note: `connectToMcpServer` defaults to a 30s timeout, so users should pre-authenticate once with `npx -y mcp-remote <url>` before `convert`, and optionally use `mcp2cli session start` to amortize `npx` startup).
6. **Toolchain & Packaging Notes:**
   - `@modelcontextprotocol/client` v2.4+ splits subpaths: import `StdioClientTransport` from `@modelcontextprotocol/client/stdio` and `SkillsClient` from `@modelcontextprotocol/client/ext/skills`.
   - Keep `packages: ['.']` alongside `allowBuilds` in `pnpm-workspace.yaml` so both `pnpm` v9/v10 (CI) and `pnpm` v12+ install cleanly without `packages field missing or empty`.
   - Keep `"prepare": "tsup"` in `package.json` `scripts` so `npm install -g github:ntrieuvi97/mcp2cli` and `npx --yes github:ntrieuvi97/mcp2cli` build `dist/` automatically when `dist/` is gitignored.
