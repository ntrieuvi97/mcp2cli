# Architecture & Design

`mcp2cli` eliminates the **MCP Token Tax** by decoupling *protocol/credential management* from *agent-facing tool invocation*.

## Layers

1. **Client Discovery & Safe Migration (`src/clients/registry.ts`)**
   - Declaratively scans JSON, JSONC, and Codex TOML configurations across 13+ agent clients on Linux, macOS, Windows, BSD, and Android Termux.
   - Enforces a zero-trust boundary on project-scoped configs referencing `${VAR}` placeholders unless `--trust` is passed.
   - Backs up configs to `<config>.mcp2cli.backup` before parking migrated entries under `_mcp2cliParked` so `mcp2cli restore` is 100% lossless.

2. **Token Tax Auditor (`src/optimizer/audit.ts`, `src/core/tokens.ts`)**
   - Calculates exact per-turn JSON schema token consumption vs `SKILL.md` frontmatter catalog tokens.
   - Advises when a well-known native CLI (`gh`, `glab`, `kubectl`, `playwright-cli`, `aws`, `docker`, `stripe`, `supabase`) exists.

3. **Multi-Target Emitters (`src/emitters/`)**
   - `skill.ts`: Generates `agentskills.io`-compliant `SKILL.md`, `references/REFERENCE.md`, and `clispec.json` (`clispec v0.2`).
   - `scripts.ts`: Emits zero-dependency `.sh` (POSIX), `.ps1` (Windows PowerShell), `.py` (Python 3 stdlib), and `.mjs` (Node 22+ stdlib) wrappers.
   - `sdk.ts`: Emits Anthropic Code-Mode typed TypeScript (`sdk/ts/index.ts`) and Python (`sdk/py/client.py`) modules for local loops, joins, and filtering.
   - `cli-shim.ts`: Emits cross-platform branded shims (`bin/<name>`, `.cmd`, `.ps1`).

4. **Cross-Platform Runtime & Warm Daemon (`src/core/`)**
   - `mcp-client.ts`: Speaks MCP `2025-11-25` and `2026-07-28` over `stdio`, `Streamable HTTP`, and legacy `SSE`.
   - `session-daemon.ts`: Maintains warm connections via POSIX Unix Domain Sockets (`0700`) or Windows Named Pipes (`\\.\pipe\...`) with per-session bearer tokens.
   - `vault.ts`: Pure-Node AES-256-GCM encrypted credential vault (`0600`) with zero native C++ addons.
   - `output.ts`: `clispec v0.2` formatting (`auto`, `text`, `json`, `ndjson`, `toon`, `yaml`), `--fields`, `--limit`/`--offset`, and structured single-line JSON error envelopes on `stderr`.
