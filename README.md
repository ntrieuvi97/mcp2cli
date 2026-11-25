# `mcp2cli` — Turn Agent Client MCPs into Token-Efficient CLIs, Scripts & Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![clispec v0.2](https://img.shields.io/badge/clispec-0.2-3b82f6)](https://clispec.dev)
[![Agent Skills](https://img.shields.io/badge/Agent_Skills-SKILL.md-10b981)](https://agentskills.io)

> **Language:** **English** | [Tiếng Việt](README.vi.md)

**Stop paying the "MCP Token Tax."**  
Every MCP server attached directly to an AI agent client (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Cline, Roo Code, Codex, Gemini CLI, OpenCode, OpenClaw, Antigravity) injects thousands of tokens of JSON schemas into your prompt **on every single turn**—often 30,000–80,000+ tokens before you even ask a question.

`mcp2cli` is a universal, cross-platform open-source TypeScript framework that:
1. **Scans** all MCP servers configured across your agent client apps.
2. **Audits** exact per-turn MCP Token Tax vs progressive `SKILL.md` + CLI savings (typically **90–99% token reduction**), and recommends native CLIs (`gh`, `glab`, `kubectl`, `playwright-cli`, etc.) when available.
3. **Converts** any MCP server (`stdio`, `Streamable HTTP`, `SSE`) into:
   - **`agentskills.io` Skill bundles** (`SKILL.md` + `references/REFERENCE.md` + `clispec.json`)
   - **Zero-dependency cross-platform scripts** (`scripts/call.sh`, `call.ps1`, `call.py`, `call.mjs`)
   - **Anthropic Code-Mode typed SDKs** (`sdk/ts/index.ts`, `sdk/py/client.py`)
   - **Branded CLI shims** (`bin/<name>`, `.cmd`, `.ps1`)
4. **Safely Migrates & Restores** client configs (`migrate` parks raw MCP entries after creating a verified backup; `restore` reverts in 1 command).
5. **Executes at Runtime** with warm persistent sessions (Unix Domain Sockets on POSIX, Named Pipes on Windows), `--output toon|json|ndjson|yaml|text`, `--fields`, `--limit`, `--dry-run`, and `clispec v0.2` offline `schema` introspection.

---

## Install

Requires **Node.js ≥ 22.0.0** (works on Linux `glibc`/`musl`, macOS, Windows PowerShell/`cmd.exe`, BSD, Android Termux, Docker, and CI — **zero native C++ addons**).

### Option 1: Directly Inside Your AI Agent Client (Recommended — No Terminal Needed)

If you use **Claude Code, Cursor, Antigravity, Windsurf, Cline, Roo Code, Codex, Gemini CLI, or OpenCode**, just paste this prompt into your agent:

> *"Install and set up https://github.com/ntrieuvi97/mcp2cli (`skills/mcp2cli/SKILL.md`), scan my MCP servers, audit how many tokens they cost per turn, and preview a safe migration before making changes."*

Or install the `mcp2cli` Agent Skill in one command (your agent will auto-bootstrap the CLI on demand):

```bash
npx skills add ntrieuvi97/mcp2cli
```

### Option 2: Install CLI via Terminal

```bash
# Install directly from GitHub
npm install -g github:ntrieuvi97/mcp2cli

# Or run once without installing globally
npx --yes github:ntrieuvi97/mcp2cli --help
```

<details>
<summary>Install from npm registry (when published) or local source</summary>

```bash
# From npm registry
npm install -g @ntrieuvi97/mcp2cli

# From local source (for contributors)
git clone https://github.com/ntrieuvi97/mcp2cli.git
cd mcp2cli
pnpm install
pnpm run build
pnpm link --global
```

</details>

---

## Quick Start (60 Seconds)

### 1. Discover all MCPs across your agent apps
```bash
mcp2cli scan
```

### 2. Audit your Token Tax & cost savings
```bash
mcp2cli audit
```

### 3. Convert MCPs into Skills + Cross-Platform Scripts + Typed SDKs
```bash
# Convert all discovered MCP servers into ./skills/<server-name>/
mcp2cli convert --out ./skills

# Or convert an ad-hoc remote or stdio MCP server
mcp2cli convert --mcp https://mcp.context7.com/mcp --server context7 --out ./skills
mcp2cli convert --mcp-stdio "npx -y @modelcontextprotocol/server-filesystem ." --server fs --out ./skills
```

### 4. Safely migrate a client app (install Skills + park heavy MCP entries)
```bash
# Preview first without touching any files
mcp2cli migrate --client cursor --dry-run

# Execute migration (writes .mcp2cli.backup before parking entries)
mcp2cli migrate --client cursor --yes

# Need to roll back? One command restores everything
mcp2cli restore --client cursor --yes
```

### 5. Run tools directly with maximum token discipline
```bash
# Progressive discovery (usage-ranked)
mcp2cli run my-server --list --compact
mcp2cli run my-server --search "issue"
mcp2cli run my-server --schema search-issues

# Call with TOON output (30–60% fewer tokens than JSON) + field mask + limit
mcp2cli run my-server search-issues --query "latency" --fields id,title --limit 10 --output toon

# Safe preview before mutating
mcp2cli run my-server delete-issue --issue-id ISS-1 --dry-run
```

---

## Built for AI Agents & Cross-Platform Humans

- **`clispec v0.2` Compliant:** `mcp2cli schema` works **100% offline** with no auth or network; `--output auto` emits human tables on TTY and JSON when piped; structured single-line JSON error envelopes on `stderr`; strict `stdout`/`stderr` separation; non-TTY destructive refusal (`confirmation_required`).
- **Zero-Trust Security:**
  - Never accepts secrets via `argv` — supports `env:VAR`, `file:/path`, and AES-256-GCM encrypted portable vault (`mcp2cli vault set KEY --secret-stdin`).
  - Refuses to auto-expand `${SECRET}` from untrusted project-local `.mcp.json` files unless `--trust` is passed.
  - Validates inputs against control characters (`\r`, `\n`, `\0`) and path traversal (`../`).
- **Cross-Platform Sessions:** Warm bridge daemons (`mcp2cli session start <name> --server ...`) use POSIX Unix Domain Sockets on Linux/macOS/Termux and Named Pipes (`\\.\pipe\...`) on Windows.

---

## Supported Agent Client Apps

`claude-code` · `claude-desktop` · `cursor` · `vscode` · `windsurf` · `cline` · `roo-code` · `codex` · `gemini-cli` · `opencode` · `openclaw` · `antigravity` · `generic`

---

## Documentation

- **English:** [Architecture & Design](docs/en/architecture.md) · [Agent Guide (`AGENTS.md`)](AGENTS.md) · [Security Policy](SECURITY.md) · [Contributing](CONTRIBUTING.md)
- **Tiếng Việt:** [README Tiếng Việt](README.vi.md) · [Hướng dẫn chi tiết](docs/vi/guide.md)

## License

[MIT](LICENSE)
