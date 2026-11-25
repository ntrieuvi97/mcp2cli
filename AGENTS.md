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
5. **Toolchain Notes:**
   - `@modelcontextprotocol/client` v2.4+ splits subpaths: import `StdioClientTransport` from `@modelcontextprotocol/client/stdio` and `SkillsClient` from `@modelcontextprotocol/client/ext/skills`.
   - `pnpm` v12+ uses `allowBuilds` in `pnpm-workspace.yaml` (e.g., `esbuild: true`).
