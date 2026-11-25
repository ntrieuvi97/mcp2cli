import { OutputOptions, formatOutput, writeStdout } from '../core/output.js';
import { Mcp2CliError } from '../core/security.js';

export const MCP2CLI_CLISPEC_V02 = {
  clispec: '0.2',
  name: 'mcp2cli',
  version: '0.1.0',
  output: { tty: 'text', piped: 'json' },
  command_layout: 'flat',
  global_args: [
    {
      name: '--output',
      type: 'string',
      enum: ['auto', 'text', 'json', 'ndjson', 'toon', 'yaml'],
      default: 'auto',
      description: 'Output format; auto emits text on TTY and JSON when piped',
    },
    { name: '--pretty', type: 'boolean', default: false, description: 'Pretty-print JSON output' },
    { name: '--fields', type: 'string', required: false, description: 'Comma-separated fields to project' },
    { name: '--limit', type: 'integer', required: false, description: 'Max items to return' },
    { name: '--offset', type: 'integer', default: 0, description: 'Offset for paginated lists' },
    { name: '--head', type: 'integer', required: false, description: 'Alias for --limit' },
  ],
  commands: [
    {
      name: 'scan',
      description: 'Discover MCP servers configured across agent client apps (Claude, Cursor, VS Code, Codex, Gemini, OpenCode, etc.)',
      mutating: false,
      example: 'mcp2cli scan --output json',
      args: [
        { name: '--client', type: 'string', required: false, description: 'Filter by client ID' },
        { name: '--config', type: 'string', required: false, description: 'Explicit config file path' },
        { name: '--include-missing', type: 'boolean', default: false, description: 'Include non-existent default client paths' },
      ],
    },
    {
      name: 'audit',
      description: 'Measure per-turn MCP Token Tax vs Skill+CLI savings and detect native CLI alternatives',
      mutating: false,
      example: 'mcp2cli audit --output json',
      args: [
        { name: '--client', type: 'string', required: false, description: 'Audit a specific agent client' },
        { name: '--config', type: 'string', required: false, description: 'Audit an explicit config file' },
        { name: '--server', type: 'string', required: false, description: 'Filter to one server name' },
        { name: '--trust', type: 'boolean', default: false, description: 'Trust project-local configs with ${VAR} refs' },
        { name: '--refresh', type: 'boolean', default: false, description: 'Bypass schema cache' },
      ],
    },
    {
      name: 'convert',
      description: 'Convert MCP servers into SKILL.md bundles, cross-platform scripts (.sh/.ps1/.py/.mjs), Code-Mode SDKs, and CLI shims',
      mutating: true,
      example: 'mcp2cli convert --server github --out ./skills --output json',
      args: [
        { name: '--server', type: 'string', required: false, description: 'Server name from discovered configs' },
        { name: '--mcp', type: 'string', required: false, description: 'Ad-hoc remote MCP URL (HTTP/SSE)' },
        { name: '--mcp-stdio', type: 'string', required: false, description: 'Ad-hoc stdio MCP command' },
        { name: '--out', type: 'string', default: './skills', description: 'Output directory for Skill bundles' },
        { name: '--scripts', type: 'string', default: 'sh,ps1,py,mjs', description: 'Comma-separated script targets' },
        { name: '--sdk', type: 'string', default: 'ts,py', description: 'Comma-separated Code-Mode SDK targets (or "none")' },
        { name: '--include', type: 'string', required: false, description: 'Glob allowlist for tools' },
        { name: '--exclude', type: 'string', required: false, description: 'Glob denylist for tools' },
        { name: '--read-only', type: 'boolean', default: false, description: 'Only emit non-mutating tools' },
        { name: '--dry-run', type: 'boolean', default: false, description: 'Preview artifacts without writing files' },
        { name: '--trust', type: 'boolean', default: false, description: 'Trust project-local configs' },
      ],
    },
    {
      name: 'migrate',
      description: 'Convert client MCPs, install Skills into client skills directories, and safely back up + park raw MCP entries',
      mutating: true,
      example: 'mcp2cli migrate --client cursor --dry-run',
      args: [
        { name: '--client', type: 'string', required: false, description: 'Target agent client ID' },
        { name: '--config', type: 'string', required: false, description: 'Target explicit config file' },
        { name: '--server', type: 'string', required: false, description: 'Migrate only the named server' },
        { name: '--park', type: 'boolean', default: true, description: 'Park migrated servers out of active MCP config (backup preserved)' },
        { name: '--dry-run', type: 'boolean', default: false, description: 'Preview migration without mutating files' },
        { name: '--yes', type: 'boolean', default: false, description: 'Confirm config modification non-interactively' },
        { name: '--trust', type: 'boolean', default: false, description: 'Trust project-local configs' },
      ],
    },
    {
      name: 'restore',
      description: 'Restore original client MCP configuration from .mcp2cli.backup',
      mutating: true,
      example: 'mcp2cli restore --config ./.cursor/mcp.json --yes',
      args: [
        { name: '--client', type: 'string', required: false, description: 'Client ID to restore' },
        { name: '--config', type: 'string', required: false, description: 'Explicit config path to restore' },
        { name: '--yes', type: 'boolean', default: false, description: 'Confirm restore non-interactively' },
      ],
    },
    {
      name: 'run',
      description: 'Discover or execute MCP tools at runtime with progressive disclosure, TOON/JSON output, and --dry-run safety',
      mutating: true,
      example: 'mcp2cli run my-server --list --compact',
      args: [
        { name: '--list', type: 'boolean', default: false, description: 'List tools (usage-ranked by default)' },
        { name: '--search', type: 'string', required: false, description: 'Search tools by name or description' },
        { name: '--schema', type: 'string', required: false, description: 'Print raw wire schema for one tool' },
        { name: '--compact', type: 'boolean', default: false, description: 'Compact tool names list' },
        { name: '--req-json', type: 'string', required: false, description: 'Tool arguments as JSON string' },
        { name: '--stdin', type: 'boolean', default: false, description: 'Read tool arguments JSON from stdin' },
        { name: '--session', type: 'string', required: false, description: 'Route call through a warm named session' },
        { name: '--dry-run', type: 'boolean', default: false, description: 'Validate without invoking mutating tools' },
        { name: '--yes', type: 'boolean', default: false, description: 'Confirm destructive tool invocation without TTY' },
      ],
    },
    {
      name: 'session start',
      description: 'Start a persistent warm MCP bridge daemon (Unix socket on POSIX, Named Pipe on Windows)',
      mutating: true,
      example: 'mcp2cli session start work --server filesystem',
      args: [
        { name: '--server', type: 'string', required: false, description: 'Saved or discovered server name' },
        { name: '--mcp', type: 'string', required: false, description: 'Remote MCP URL' },
        { name: '--mcp-stdio', type: 'string', required: false, description: 'Local stdio command' },
        { name: '--idle-timeout', type: 'integer', default: 300, description: 'Idle timeout in seconds' },
      ],
    },
    {
      name: 'session list',
      description: 'List active warm MCP sessions',
      mutating: false,
      example: 'mcp2cli session list --output json',
      args: [],
    },
    {
      name: 'session stop',
      description: 'Stop a warm MCP session cleanly',
      mutating: true,
      example: 'mcp2cli session stop work',
      args: [],
    },
    {
      name: 'vault set',
      description: 'Store an encrypted secret in the cross-platform AES-256-GCM vault (reads from --secret-stdin)',
      mutating: true,
      example: 'printf "%s" "$TOKEN" | mcp2cli vault set GITHUB_TOKEN --secret-stdin',
      args: [
        { name: '--secret-stdin', type: 'boolean', default: false, description: 'Read secret value from stdin' },
      ],
    },
    {
      name: 'vault list',
      description: 'List stored secret key names (never prints secret values)',
      mutating: false,
      example: 'mcp2cli vault list --output json',
      args: [],
    },
    {
      name: 'schema',
      description: 'Print machine-readable clispec v0.2 schema offline without auth or network',
      mutating: false,
      example: 'mcp2cli schema audit',
      args: [],
    },
  ],
  errors: [
    { kind: 'validation', exit_code: 2, retryable: false, description: 'Invalid arguments or input' },
    { kind: 'confirmation_required', exit_code: 2, retryable: false, description: 'Mutating/destructive action requires --yes without TTY' },
    { kind: 'auth', exit_code: 3, retryable: false, description: 'Missing or invalid credentials' },
    { kind: 'not_found', exit_code: 4, retryable: false, description: 'Server, config, tool, or session not found' },
    { kind: 'timeout', exit_code: 5, retryable: true, description: 'Connection or RPC timed out' },
    { kind: 'conflict', exit_code: 6, retryable: false, description: 'State conflict on target resource' },
    { kind: 'untrusted_config', exit_code: 7, retryable: false, description: 'Project config references env vars without --trust' },
    { kind: 'transport', exit_code: 8, retryable: true, description: 'MCP transport connection failed' },
    { kind: 'tool_error', exit_code: 9, retryable: false, description: 'MCP tool returned isError=true' },
    { kind: 'internal', exit_code: 1, retryable: false, description: 'Unexpected internal error' },
  ],
};

export function runSchemaCommand(commandPath: string | undefined, outOpts: OutputOptions): void {
  let doc: Record<string, unknown> = MCP2CLI_CLISPEC_V02;
  if (commandPath) {
    const normalized = commandPath.trim().toLowerCase();
    const filtered = MCP2CLI_CLISPEC_V02.commands.filter(
      (c) => c.name === normalized || c.name.startsWith(`${normalized} `)
    );
    if (filtered.length === 0) {
      throw new Mcp2CliError({
        kind: 'not_found',
        message: `No command matching '${commandPath}' in clispec schema.`,
        hint: 'Run `mcp2cli schema` to see all commands.',
        retryable: false,
      });
    }
    doc = { ...MCP2CLI_CLISPEC_V02, commands: filtered };
  }

  const effectiveOpts: OutputOptions = {
    ...outOpts,
    format: outOpts.format && outOpts.format !== 'auto' ? outOpts.format : 'json',
    pretty: outOpts.pretty ?? true,
  };
  writeStdout(formatOutput(doc, effectiveOpts));
}
