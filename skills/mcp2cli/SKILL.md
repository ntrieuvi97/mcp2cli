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

## Client-App Cost-Optimization Workflow

1. **Scan** configured MCP servers across client apps: `mcp2cli scan --output json`
2. **Audit** upfront Token Tax and native CLI alternatives: `mcp2cli audit --output json`
3. **Convert** to Skills + scripts + SDKs: `mcp2cli convert --client <id> --out <skills-dir>`
4. **Preview & Migrate** safely (creates `.mcp2cli.backup` before parking raw entries):
   ```bash
   mcp2cli migrate --client <id> --dry-run
   mcp2cli migrate --client <id> --yes
   ```
5. **Restore** anytime if rollback is needed: `mcp2cli restore --client <id> --yes`

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
