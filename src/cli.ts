import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { AgentClientId, OutputFormat } from './types.js';
import { OutputOptions, emitCliError } from './core/output.js';
import { UsageSortMode } from './core/cache.js';
import { runAuditCommand } from './commands/audit.js';
import { runConvertCommand } from './commands/convert.js';
import { runMigrateCommand, runRestoreCommand } from './commands/migrate.js';
import { runRuntimeCommand } from './commands/run.js';
import { runScanCommand } from './commands/scan.js';
import { runSchemaCommand } from './commands/schema.js';
import {
  runSessionList,
  runSessionServeInternal,
  runSessionStart,
  runSessionStop,
} from './commands/session.js';
import { runVaultDelete, runVaultList, runVaultSet } from './commands/vault.js';

function extractOutputOpts(cmd: Command): OutputOptions {
  const g = cmd.optsWithGlobals() as Record<string, unknown>;
  const fieldsRaw = typeof g['fields'] === 'string' ? g['fields'] : undefined;
  return {
    format: (g['output'] as OutputFormat | undefined) ?? 'auto',
    pretty: Boolean(g['pretty']),
    fields: fieldsRaw ? fieldsRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    limit: g['limit'] !== undefined ? Number(g['limit']) : undefined,
    offset: g['offset'] !== undefined ? Number(g['offset']) : 0,
    head: g['head'] !== undefined ? Number(g['head']) : undefined,
  };
}

function addGlobalOutputFlags(cmd: Command): Command {
  return cmd
    .option('-o, --output <format>', 'Output format: auto|text|json|ndjson|toon|yaml', 'auto')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--fields <cols>', 'Comma-separated fields to project')
    .option('--limit <n>', 'Limit output items')
    .option('--offset <n>', 'Offset for output items')
    .option('--head <n>', 'Truncate output arrays to first N items');
}

export function buildCliProgram(): Command {
  const program = new Command();

  program
    .name('mcp2cli')
    .description(
      'Convert MCP servers from any agent client app into token-efficient CLIs, scripts, SDKs, and Agent Skills (SKILL.md).\nRun `mcp2cli schema` for the machine-readable clispec v0.2 contract.'
    )
    .version('0.1.0')
    .enablePositionalOptions()
    .option('-o, --output <format>', 'Output format: auto|text|json|ndjson|toon|yaml', 'auto')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--fields <cols>', 'Comma-separated fields to project')
    .option('--limit <n>', 'Limit output items')
    .option('--offset <n>', 'Offset for output items')
    .option('--head <n>', 'Truncate output arrays to first N items');

  addGlobalOutputFlags(
    program
      .command('scan')
      .description('Discover MCP configs across Claude, Cursor, VS Code, Windsurf, Codex, Gemini, OpenCode, etc.')
      .option('--client <id>', 'Filter by agent client ID')
      .option('--config <path>', 'Scan an explicit config file')
      .option('--trust', 'Trust project-local configs')
      .option('--include-missing', 'Include non-existent default config paths')
  ).action(async (localOpts, cmd: Command) => {
    const out = extractOutputOpts(cmd);
    await runScanCommand({
      ...out,
      client: localOpts.client as AgentClientId | undefined,
      config: localOpts.config,
      trust: Boolean(localOpts.trust),
      includeMissing: Boolean(localOpts.includeMissing),
    });
  });

  addGlobalOutputFlags(
    program
      .command('audit')
      .description('Measure MCP upfront Token Tax vs Skill+CLI savings and detect native CLI alternatives')
      .option('--client <id>', 'Filter by agent client ID')
      .option('--config <path>', 'Audit an explicit config file')
      .option('--server <name>', 'Audit only one server by name')
      .option('--trust', 'Trust project-local configs referencing ${VAR}')
      .option('--refresh', 'Bypass schema cache and introspect live')
  ).action(async (localOpts, cmd: Command) => {
    const out = extractOutputOpts(cmd);
    await runAuditCommand({
      ...out,
      client: localOpts.client as AgentClientId | undefined,
      config: localOpts.config,
      server: localOpts.server,
      trust: Boolean(localOpts.trust),
      refresh: Boolean(localOpts.refresh),
    });
  });

  addGlobalOutputFlags(
    program
      .command('convert')
      .description('Convert MCP servers into SKILL.md, cross-platform scripts (.sh/.ps1/.py/.mjs), Code-Mode SDKs, and CLI shims')
      .option('--client <id>', 'Convert servers from a specific client')
      .option('--config <path>', 'Convert servers from an explicit config file')
      .option('--server <name>', 'Convert only the named server')
      .option('--mcp <url>', 'Convert an ad-hoc remote MCP URL (Streamable HTTP / SSE)')
      .option('--mcp-stdio <cmd>', 'Convert an ad-hoc stdio MCP server command')
      .option('--out <dir>', 'Output directory for Skill bundles', './skills')
      .option('--scripts <targets>', 'Script targets: sh,ps1,py,mjs or none', 'sh,ps1,py,mjs')
      .option('--sdk <targets>', 'Code-Mode SDK targets: ts,py or none', 'ts,py')
      .option('--include <globs>', 'Comma-separated tool allowlist globs')
      .option('--exclude <globs>', 'Comma-separated tool denylist globs')
      .option('--read-only', 'Only include non-mutating tools')
      .option('--top <n>', 'Keep only top N tools')
      .option('--refresh', 'Bypass schema cache')
      .option('--trust', 'Trust project-local configs')
      .option('--dry-run', 'Preview generated artifacts without writing files')
  ).action(async (localOpts, cmd: Command) => {
    const out = extractOutputOpts(cmd);
    await runConvertCommand({
      ...out,
      client: localOpts.client as AgentClientId | undefined,
      config: localOpts.config,
      server: localOpts.server,
      mcp: localOpts.mcp,
      mcpStdio: localOpts.mcpStdio,
      out: localOpts.out,
      scripts: localOpts.scripts,
      sdk: localOpts.sdk,
      include: localOpts.include,
      exclude: localOpts.exclude,
      readOnly: Boolean(localOpts.readOnly),
      top: localOpts.top !== undefined ? Number(localOpts.top) : undefined,
      refresh: Boolean(localOpts.refresh),
      trust: Boolean(localOpts.trust),
      dryRun: Boolean(localOpts.dryRun),
    });
  });

  addGlobalOutputFlags(
    program
      .command('migrate')
      .description('Convert client MCPs, install Skills into client skills dirs, and safely back up + park raw MCP entries')
      .option('--client <id>', 'Target agent client ID')
      .option('--config <path>', 'Target explicit config file')
      .option('--server <name>', 'Migrate only one server')
      .option('--skills-dir <dir>', 'Override target skills directory')
      .option('--no-park', 'Do not park original entries in client config')
      .option('--dry-run', 'Preview migration without changing files')
      .option('--yes', 'Confirm non-interactive config modification')
      .option('--trust', 'Trust project-local configs')
  ).action(async (localOpts, cmd: Command) => {
    const out = extractOutputOpts(cmd);
    await runMigrateCommand({
      ...out,
      client: localOpts.client as AgentClientId | undefined,
      config: localOpts.config,
      server: localOpts.server,
      skillsDir: localOpts.skillsDir,
      park: localOpts.park !== false,
      dryRun: Boolean(localOpts.dryRun),
      yes: Boolean(localOpts.yes),
      trust: Boolean(localOpts.trust),
    });
  });

  addGlobalOutputFlags(
    program
      .command('restore')
      .description('Restore original client MCP configuration from .mcp2cli.backup')
      .option('--client <id>', 'Target agent client ID')
      .option('--config <path>', 'Explicit config path to restore')
      .option('--yes', 'Confirm non-interactive restore')
  ).action(async (localOpts, cmd: Command) => {
    const out = extractOutputOpts(cmd);
    await runRestoreCommand({
      ...out,
      client: localOpts.client as AgentClientId | undefined,
      config: localOpts.config,
      yes: Boolean(localOpts.yes),
    });
  });

  addGlobalOutputFlags(
    program
      .command('run')
      .description('Discover or invoke MCP tools at runtime (supports --list, --search, --schema, --output toon, --dry-run)')
      .argument('[server]', 'Saved or discovered server name')
      .argument('[tool]', 'Tool name (kebab-case or wire name)')
      .argument('[extra...]', 'Dynamic tool flags (--flag value)')
      .allowUnknownOption(true)
      .option('--list', 'List tools (usage-ranked)')
      .option('--search <pattern>', 'Filter tools by name or description')
      .option('--schema <tool>', 'Print raw wire schema of a single tool')
      .option('--compact', 'Print space-separated tool names only')
      .option('--sort <mode>', 'Sort mode: usage|recent|alpha|default', 'usage')
      .option('--top <n>', 'Show only top N tools')
      .option('--req-json <json>', 'Pass tool arguments as JSON object')
      .option('--stdin', 'Read tool arguments JSON from stdin')
      .option('--session <name>', 'Execute via persistent warm session')
      .option('--mcp <url>', 'Ad-hoc remote MCP URL')
      .option('--mcp-stdio <cmd>', 'Ad-hoc stdio MCP command')
      .option('--dry-run', 'Validate invocation without calling tool')
      .option('--yes', 'Confirm destructive tool invocation without TTY')
      .option('--refresh', 'Bypass schema cache')
      .option('--trust', 'Trust project-local configs')
  ).action(
    async (
      server: string | undefined,
      tool: string | undefined,
      extraArgs: string[],
      localOpts,
      cmd: Command
    ) => {
      const out = extractOutputOpts(cmd);

      await runRuntimeCommand(server, tool, extraArgs ?? [], {
      ...out,
      list: Boolean(localOpts.list),
      search: localOpts.search,
      schema: localOpts.schema,
      compact: Boolean(localOpts.compact),
      sort: (localOpts.sort as UsageSortMode | undefined) ?? 'usage',
      top: localOpts.top !== undefined ? Number(localOpts.top) : undefined,
      reqJson: localOpts.reqJson,
      stdin: Boolean(localOpts.stdin),
      session: localOpts.session,
      mcp: localOpts.mcp,
      mcpStdio: localOpts.mcpStdio,
      dryRun: Boolean(localOpts.dryRun),
      yes: Boolean(localOpts.yes),
      refresh: Boolean(localOpts.refresh),
      trust: Boolean(localOpts.trust),
    });
  });

  const sessionCmd = program
    .command('session')
    .description('Manage persistent warm MCP sessions (UDS on POSIX, Named Pipes on Windows)');

  addGlobalOutputFlags(
    sessionCmd
      .command('start')
      .description('Start a named warm session daemon')
      .argument('<name>', 'Session name')
      .option('--server <name>', 'Saved or discovered server name')
      .option('--mcp <url>', 'Remote MCP URL')
      .option('--mcp-stdio <cmd>', 'Local stdio command')
      .option('--idle-timeout <sec>', 'Idle timeout seconds', '300')
      .option('--trust', 'Trust project-local configs')
  ).action(async (name: string, localOpts, cmd: Command) => {
    const out = extractOutputOpts(cmd);
    await runSessionStart(name, {
      ...out,
      server: localOpts.server,
      mcp: localOpts.mcp,
      mcpStdio: localOpts.mcpStdio,
      idleTimeout: Number(localOpts.idleTimeout ?? 300),
      trust: Boolean(localOpts.trust),
    });
  });

  addGlobalOutputFlags(
    sessionCmd.command('list').description('List active sessions')
  ).action(async (_localOpts, cmd: Command) => {
    await runSessionList(extractOutputOpts(cmd));
  });

  addGlobalOutputFlags(
    sessionCmd
      .command('stop')
      .description('Stop a warm session')
      .argument('<name>', 'Session name')
  ).action(async (name: string, _localOpts, cmd: Command) => {
    await runSessionStop(name, extractOutputOpts(cmd));
  });

  sessionCmd
    .command('_serve', { hidden: true })
    .argument('<payload>', 'Internal daemon payload')
    .action(async (payload: string) => {
      await runSessionServeInternal(payload);
    });

  const vaultCmd = program
    .command('vault')
    .description('Manage encrypted cross-platform AES-256-GCM credentials');

  addGlobalOutputFlags(
    vaultCmd
      .command('set')
      .description('Store a secret via --secret-stdin')
      .argument('<key>', 'Secret key name')
      .option('--secret-stdin', 'Read secret value from stdin')
  ).action(async (key: string, localOpts, cmd: Command) => {
    await runVaultSet(key, {
      ...extractOutputOpts(cmd),
      secretStdin: Boolean(localOpts.secretStdin),
    });
  });

  addGlobalOutputFlags(
    vaultCmd.command('list').description('List stored secret key names')
  ).action(async (_localOpts, cmd: Command) => {
    await runVaultList(extractOutputOpts(cmd));
  });

  addGlobalOutputFlags(
    vaultCmd
      .command('delete')
      .description('Delete a stored secret')
      .argument('<key>', 'Secret key name')
  ).action(async (key: string, _localOpts, cmd: Command) => {
    await runVaultDelete(key, extractOutputOpts(cmd));
  });

  addGlobalOutputFlags(
    program
      .command('schema')
      .description('Print machine-readable clispec v0.2 contract (works offline without auth)')
      .argument('[command...]', 'Optional command path to filter')
  ).action((commandParts: string[], _localOpts, cmd: Command) => {
    const joined = commandParts && commandParts.length > 0 ? commandParts.join(' ') : undefined;
    runSchemaCommand(joined, extractOutputOpts(cmd));
  });

  return program;
}

async function main(): Promise<void> {
  const program = buildCliProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const code = emitCliError(err);
    process.exitCode = code;
  }
}

function isCliEntrypoint(): boolean {
  const arg1 = process.argv[1];
  if (!arg1) return false;
  try {
    return pathToFileURL(fs.realpathSync(arg1)).href === import.meta.url;
  } catch {
    return arg1.endsWith('cli.js') || arg1.endsWith('cli.ts');
  }
}

if (isCliEntrypoint()) {
  void main();
}
