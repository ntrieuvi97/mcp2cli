---
name: mcp2cli
description: "Scan, audit, convert, and execute MCP servers from any agent client app as token-efficient CLIs, scripts, and Agent Skills (SKILL.md). Use to cut MCP schema token overhead by 90-99% or invoke MCP tools via CLI."
license: MIT
compatibility: Requires Node.js >= 22. Works on Linux, macOS, Windows (PowerShell), and Android Termux.
---

# mcp2cli — Universal MCP-to-CLI & Skill Optimizer

Use `mcp2cli` whenever you need to:
- Discover MCP servers in agent client configs (`mcp2cli scan --output json`)
- Measure MCP schema token overhead (`mcp2cli audit --output json`)
- Convert MCP servers into `SKILL.md` + cross-platform scripts + typed SDKs (`mcp2cli convert`)
- Safely migrate client MCP configs to Skills + parked backups (`mcp2cli migrate` / `restore`)
- Execute MCP tools on demand without loading all schemas into context (`mcp2cli run`)

## Auto-Bootstrap (If `mcp2cli` Is Not Installed)

Check `mcp2cli --version` and `node -v` (requires Node.js >= 22). If `mcp2cli` is missing, install or invoke it automatically on the user's behalf:

1. Prefer installing from GitHub (works immediately) or npm (when published):
   ```bash
   npm install -g github:ntrieuvi97/mcp2cli
   ```
   *(Or if published on npm: `npm install -g @ntrieuvi97/mcp2cli`)*
2. If global install fails due to permissions or restricted git fetch, run from a local user directory without `sudo`:
   ```bash
   git clone https://github.com/ntrieuvi97/mcp2cli.git ~/.mcp2cli && cd ~/.mcp2cli && npm install && npm run build
   ```
   Then invoke `node ~/.mcp2cli/dist/cli.js ...` directly (or `npm link` if writable).

## Client-App Cost-Optimization Workflow

1. **Scan** configured MCP servers across client apps: `mcp2cli scan --output json`
2. **Audit** upfront Token Tax and native CLI alternatives: `mcp2cli audit --output json`
3. **Convert** to Skills + scripts + SDKs: `mcp2cli convert --client <id> --out <skills-dir>`
4. **Preview & Migrate** safely (creates `.mcp2cli.backup` before parking raw entries). Always run `--dry-run` first and confirm with the user before `--yes`:
   ```bash
   mcp2cli migrate --client <id> --dry-run
   mcp2cli migrate --client <id> --yes
   ```
5. **Restore** anytime if rollback is needed: `mcp2cli restore --client <id> --yes`

> **Cloud Connectors / OAuth MCPs (e.g., `claude.ai` Atlassian):** Account-synced cloud connectors live on the provider's cloud rather than local JSON configs. Convert them directly with `--mcp <url>`, or bridge OAuth endpoints via `mcp-remote`:
> `mcp2cli convert --mcp-stdio "npx -y mcp-remote https://mcp.atlassian.com/v1/mcp" --server atlassian --out <skills-dir>`

## Progressive Tool Discovery Workflow

1. List tools compactly (usage-ranked):
   ```bash
   mcp2cli run <server> --list --compact
   ```
2. Search tools by keyword:
   ```bash
   mcp2cli run <server> --search "<keyword>"
   ```
3. Inspect a single tool's exact JSON schema:
   ```bash
   mcp2cli run <server> --schema <tool>
   ```
4. Execute with bounded, token-efficient output:
   ```bash
   mcp2cli run <server> <tool> --flag value --fields id,name --limit 20 --output toon
   ```
5. Preview mutating/destructive operations safely before running:
   ```bash
   mcp2cli run <server> <tool> --flag value --dry-run
   ```
