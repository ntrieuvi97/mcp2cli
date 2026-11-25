import { AgentClientId, ConvertResult, McpServerConfig, ScriptTarget, SdkTarget } from '../types.js';
import { scanAgentClients } from '../clients/registry.js';
import { OutputOptions, formatOutput, writeStderrInfo, writeStdout } from '../core/output.js';
import { Mcp2CliError } from '../core/security.js';
import { convertServerToArtifacts } from '../emitters/convert.js';

export interface ConvertCommandOptions extends OutputOptions {
  client?: AgentClientId;
  config?: string;
  server?: string;
  mcp?: string;
  mcpStdio?: string;
  out?: string;
  scripts?: string;
  sdk?: string;
  include?: string;
  exclude?: string;
  readOnly?: boolean;
  top?: number;
  refresh?: boolean;
  trust?: boolean;
  dryRun?: boolean;
}

function splitCmdLine(cmdLine: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmdLine.length; i++) {
    const ch = cmdLine[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  if (tokens.length === 0) {
    throw new Mcp2CliError({
      kind: 'validation',
      message: 'Empty --mcp-stdio command string.',
      retryable: false,
    });
  }
  return { command: tokens[0]!, args: tokens.slice(1) };
}

export async function runConvertCommand(opts: ConvertCommandOptions): Promise<void> {
  const servers: McpServerConfig[] = [];

  if (opts.mcp) {
    const u = new URL(opts.mcp);
    const derivedName = opts.server ?? u.hostname.replace(/\./g, '-');
    servers.push({
      name: derivedName,
      transport: opts.mcp.endsWith('/sse') ? 'sse' : 'http',
      url: opts.mcp,
      trusted: true,
    });
  } else if (opts.mcpStdio) {
    const parsed = splitCmdLine(opts.mcpStdio);
    servers.push({
      name: opts.server ?? parsed.command.replace(/[^a-zA-Z0-9_-]/g, '-'),
      transport: 'stdio',
      command: parsed.command,
      args: parsed.args,
      trusted: true,
    });
  } else {
    const clients = await scanAgentClients({
      client: opts.client,
      configPath: opts.config,
      trust: opts.trust,
    });
    const all = clients.flatMap((c) => c.servers).filter((s) => !s.disabled);
    const filtered = opts.server ? all.filter((s) => s.name === opts.server) : all;
    servers.push(...filtered);
  }

  if (servers.length === 0) {
    throw new Mcp2CliError({
      kind: 'not_found',
      message: opts.server
        ? `No MCP server named '${opts.server}' found.`
        : 'No MCP servers discovered to convert.',
      hint: 'Pass --mcp <url>, --mcp-stdio "<cmd>", or --config <path>.',
      retryable: false,
    });
  }

  const scripts: ScriptTarget[] =
    opts.scripts === 'none'
      ? []
      : ((opts.scripts ?? 'sh,ps1,py,mjs')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as ScriptTarget[]);

  const sdk: SdkTarget[] =
    opts.sdk === 'none'
      ? []
      : ((opts.sdk ?? 'ts,py')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as SdkTarget[]);

  const results: ConvertResult[] = [];
  for (const srv of servers) {
    writeStderrInfo(`Converting '${srv.name}' (${srv.transport})...`);
    const res = await convertServerToArtifacts(srv, {
      outDir: opts.out ?? './skills',
      scripts,
      sdk,
      includePatterns: opts.include?.split(',').map((s) => s.trim()).filter(Boolean),
      excludePatterns: opts.exclude?.split(',').map((s) => s.trim()).filter(Boolean),
      readOnlyOnly: opts.readOnly,
      topTools: opts.top,
      refresh: opts.refresh,
      trust: opts.trust,
      dryRun: opts.dryRun,
    });
    results.push(res);
  }

  writeStdout(
    formatOutput({ items: results, dryRun: Boolean(opts.dryRun) }, opts, (bounded) => {
      const data = bounded as { items: typeof results; dryRun: boolean };
      const lines: string[] = [
        `${data.dryRun ? '[DRY-RUN] ' : ''}Converted ${data.items.length} MCP server(s):`,
        '',
      ];
      for (const r of data.items) {
        lines.push(
          `• ${r.serverName} -> ${r.outputDir} (${r.toolCount} tools, ${r.mcpUpfrontTokens} -> ${r.skillCatalogTokens} tokens, ${r.savingsPercent}% saved, ${r.artifacts.length} files)`
        );
        if (r.nativeCliAlternative) {
          lines.push(`  ↳ Native CLI tip: \`${r.nativeCliAlternative.cli}\` — ${r.nativeCliAlternative.reason}`);
        }
      }
      return lines.join('\n');
    })
  );
}
