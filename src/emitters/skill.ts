import {
  McpServerCapabilitiesSnapshot,
  McpServerConfig,
  McpToolDefinition,
  NativeCliRecommendation,
} from '../types.js';
import { toSkillName } from '../core/security.js';
import {
  extractToolParams,
  isToolDestructive,
  isToolMutating,
  toKebabCase,
} from '../optimizer/analyzer.js';

function sanitizeSingleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function buildCliSpecForServer(
  server: McpServerConfig,
  tools: McpToolDefinition[],
  skillName: string
): Record<string, unknown> {
  return {
    clispec: '0.2',
    name: skillName,
    version: server.clientId ? `0.1.0-${server.clientId}` : '0.1.0',
    output: { tty: 'text', piped: 'json' },
    command_layout: 'flat',
    global_args: [
      {
        name: '--output',
        type: 'string',
        enum: ['auto', 'text', 'json', 'ndjson', 'toon', 'yaml'],
        default: 'auto',
        description: 'Output format (use toon for compact arrays, json for scripting)',
      },
      { name: '--fields', type: 'string', required: false, description: 'Comma-separated fields to return' },
      { name: '--limit', type: 'integer', required: false, description: 'Limit number of returned items' },
      { name: '--dry-run', type: 'boolean', default: false, description: 'Preview mutating calls without executing' },
      { name: '--yes', type: 'boolean', default: false, description: 'Confirm destructive operations non-interactively' },
    ],
    commands: tools.map((t) => {
      const cmdName = toKebabCase(t.name);
      const params = extractToolParams(t);
      const mutating = isToolMutating(t);
      const exampleArgs = params
        .filter((p) => p.required)
        .slice(0, 2)
        .map((p) => `--${p.flagName} <${p.type}>`)
        .join(' ');
      return {
        name: cmdName,
        wire_name: t.name,
        description: sanitizeSingleLine(t.description ?? `Invoke ${t.name}`),
        mutating,
        destructive: isToolDestructive(t),
        example: `${skillName} ${cmdName}${exampleArgs ? ` ${exampleArgs}` : ''} --output json`,
        args: params.map((p) => ({
          name: `--${p.flagName}`,
          wire_name: p.wireName,
          type: p.type,
          required: p.required,
          ...(p.defaultValue !== undefined ? { default: p.defaultValue } : {}),
          ...(p.enumValues ? { enum: p.enumValues } : {}),
          ...(p.description ? { description: sanitizeSingleLine(p.description) } : {}),
        })),
      };
    }),
    errors: [
      { kind: 'validation', exit_code: 2, retryable: false, description: 'Invalid arguments or input' },
      { kind: 'confirmation_required', exit_code: 2, retryable: false, description: 'Destructive call requires --yes' },
      { kind: 'auth', exit_code: 3, retryable: false, description: 'Authentication missing or expired' },
      { kind: 'not_found', exit_code: 4, retryable: false, description: 'Command or resource not found' },
      { kind: 'timeout', exit_code: 5, retryable: true, description: 'Request timed out' },
      { kind: 'transport', exit_code: 8, retryable: true, description: 'MCP transport error' },
      { kind: 'tool_error', exit_code: 9, retryable: false, description: 'Tool returned isError=true' },
    ],
  };
}

export function renderSkillMarkdown(opts: {
  server: McpServerConfig;
  snapshot: McpServerCapabilitiesSnapshot;
  tools: McpToolDefinition[];
  nativeCli?: NativeCliRecommendation;
  hasScripts: boolean;
  hasSdk: boolean;
}): string {
  const skillName = toSkillName(opts.server.name);
  const topNames = opts.tools
    .slice(0, 8)
    .map((t) => toKebabCase(t.name))
    .join(', ');

  const rawDesc = `Operate ${opts.server.name} via token-efficient CLI & scripts (${opts.tools.length} tools${topNames ? `: ${topNames}` : ''}). Use instead of attaching the ${opts.server.name} MCP server directly.`;
  const description = rawDesc.slice(0, 1020);

  const lines: string[] = [
    '---',
    `name: ${skillName}`,
    `description: ${JSON.stringify(description)}`,
    'license: MIT',
    'compatibility: Works on Linux, macOS, Windows (PowerShell), and Termux via mcp2cli or bundled scripts.',
    'metadata:',
    '  generated_by: mcp2cli',
    `  source_server: ${JSON.stringify(opts.server.name)}`,
    `  transport: ${opts.server.transport}`,
    '---',
    '',
    `# ${opts.server.name} (Token-Optimized CLI Skill)`,
    '',
    'This skill replaces direct MCP tool schema injection with progressive CLI/script execution.',
    '',
  ];

  if (opts.nativeCli) {
    lines.push(
      '## Native CLI Cost Tip',
      '',
      `> **Recommended:** \`${opts.nativeCli.cli}\` (${opts.nativeCli.packageHint}) — ${opts.nativeCli.reason}`,
      `> Install: \`${opts.nativeCli.installCommand}\``,
      ''
    );
  }

  lines.push(
    '## Quick Workflow',
    '',
    '1. **List or search commands** (low token cost):',
    '   ```bash',
    `   mcp2cli run ${opts.server.name} --list --compact`,
    `   mcp2cli run ${opts.server.name} --search "<keyword>"`,
    '   ```',
    '2. **Inspect one tool schema before calling** (only when arguments are unclear):',
    '   ```bash',
    `   mcp2cli run ${opts.server.name} --schema <tool-name>`,
    '   ```',
    '3. **Execute with bounded, token-saving output**:',
    '   ```bash',
    `   mcp2cli run ${opts.server.name} <tool-name> --arg value --output toon --limit 20`,
    '   ```',
    '   Or pass complex JSON via stdin (avoids cross-shell quoting bugs on Windows/POSIX):',
    '   ```bash',
    `   echo '{"key":"value"}' | mcp2cli run ${opts.server.name} <tool-name> --stdin --output json`,
    '   ```',
    ''
  );

  if (opts.hasScripts) {
    lines.push(
      '## Cross-Platform Standalone Scripts (`scripts/`)',
      '',
      '- POSIX (`sh` / Linux / macOS / Termux): `scripts/call.sh <tool> [json_args]`',
      '- Windows PowerShell: `pwsh -File scripts/call.ps1 <tool> [json_args]`',
      '- Python 3 (zero dependencies): `python3 scripts/call.py <tool> [json_args]`',
      '- Node.js 22+ (zero dependencies): `node scripts/call.mjs <tool> [json_args]`',
      ''
    );
  }

  if (opts.hasSdk) {
    lines.push(
      '## Code-Mode SDK (`sdk/`)',
      '',
      'For loops, joins, or filtering large payloads before returning to context, use `sdk/ts/index.ts` or `sdk/py/client.py`.',
      ''
    );
  }

  lines.push(
    '## Available Commands',
    '',
    '| Command | Mutating | Summary |',
    '| :--- | :---: | :--- |'
  );

  const displayTools = opts.tools.slice(0, 60);
  for (const t of displayTools) {
    const cmd = toKebabCase(t.name);
    const mut = isToolMutating(t) ? (isToolDestructive(t) ? 'destructive' : 'yes') : 'read-only';
    const desc = sanitizeSingleLine(t.description ?? '').slice(0, 100);
    lines.push(`| \`${cmd}\` | ${mut} | ${desc} |`);
  }

  if (opts.tools.length > displayTools.length) {
    lines.push('', `_Showing ${displayTools.length} of ${opts.tools.length} tools. See [references/REFERENCE.md](references/REFERENCE.md) for the complete catalog._`);
  }

  lines.push(
    '',
    '## Safety & Context Rules',
    '',
    '- Always pass `--dry-run` before running destructive or unfamiliar mutating commands.',
    '- Use `--fields` and `--limit` on list/search tools to avoid flooding your context window.',
    '- Never pass raw secrets in CLI flags; rely on `env:VAR` or `mcp2cli vault`.',
    '- Full parameter schemas and examples are in [references/REFERENCE.md](references/REFERENCE.md) and [clispec.json](clispec.json).',
    ''
  );

  return lines.join('\n');
}

export function renderReferenceMarkdown(
  server: McpServerConfig,
  snapshot: McpServerCapabilitiesSnapshot,
  tools: McpToolDefinition[]
): string {
  const lines: string[] = [
    `# ${server.name} — Reference Guide`,
    '',
    `- **Transport:** \`${server.transport}\``,
    `- **Protocol Version:** \`${snapshot.protocolVersion ?? 'unknown'}\``,
    `- **Tools:** ${tools.length}`,
    `- **Resources:** ${snapshot.resources.length}`,
    `- **Prompts:** ${snapshot.prompts.length}`,
    '',
  ];

  if (snapshot.instructions) {
    lines.push('## Server Instructions', '', snapshot.instructions.trim(), '');
  }

  lines.push('## Tools', '');

  for (const t of tools) {
    const kebab = toKebabCase(t.name);
    const params = extractToolParams(t);
    lines.push(`### \`${kebab}\` (wire: \`${t.name}\`)`, '');
    if (t.description) lines.push(t.description.trim(), '');
    lines.push(`- **Mutating:** ${isToolMutating(t) ? 'yes' : 'no (read-only)'}`);
    if (isToolDestructive(t)) lines.push('- **Destructive:** yes (supports `--dry-run`, requires `--yes` without TTY)');

    if (params.length > 0) {
      lines.push('', '| Flag | Wire Key | Type | Required | Description |', '| :--- | :--- | :--- | :---: | :--- |');
      for (const p of params) {
        const desc = sanitizeSingleLine(p.description ?? '');
        lines.push(`| \`--${p.flagName}\` | \`${p.wireName}\` | \`${p.type}\` | ${p.required ? 'yes' : 'no'} | ${desc} |`);
      }
    } else {
      lines.push('- **Parameters:** none');
    }
    lines.push('');
  }

  if (snapshot.resources.length > 0) {
    lines.push('## Resources', '');
    for (const r of snapshot.resources) {
      lines.push(`- \`${r.uri}\` (${r.name})${r.description ? `: ${sanitizeSingleLine(r.description)}` : ''}`);
    }
    lines.push('');
  }

  if (snapshot.prompts.length > 0) {
    lines.push('## Prompts', '');
    for (const p of snapshot.prompts) {
      lines.push(`- \`${p.name}\`${p.description ? `: ${sanitizeSingleLine(p.description)}` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
