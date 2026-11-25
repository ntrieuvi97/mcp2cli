import { AgentClientId, McpServerConfig } from '../types.js';
import { scanAgentClients } from '../clients/registry.js';
import { OutputOptions, formatOutput, writeStdout } from '../core/output.js';
import { auditServers } from '../optimizer/audit.js';

export interface AuditCommandOptions extends OutputOptions {
  client?: AgentClientId;
  config?: string;
  server?: string;
  trust?: boolean;
  refresh?: boolean;
}

export async function runAuditCommand(opts: AuditCommandOptions): Promise<void> {
  const clients = await scanAgentClients({
    client: opts.client,
    configPath: opts.config,
    trust: opts.trust,
  });

  let servers: McpServerConfig[] = clients.flatMap((c) => c.servers).filter((s) => !s.disabled);
  if (opts.server) {
    servers = servers.filter((s) => s.name === opts.server);
  }

  const report = await auditServers(servers, {
    refresh: opts.refresh,
    trust: opts.trust,
  });

  writeStdout(
    formatOutput(
      {
        ...report,
        items: report.servers,
      },
      opts,
      (bounded) => {
        const rep = bounded as typeof report;
        if (rep.servers.length === 0) {
          return 'No active MCP servers found to audit.';
        }
        const lines: string[] = [
          `MCP Token Tax Audit (${rep.auditedServers}/${rep.totalServers} servers inspected)`,
          `Upfront MCP Cost: ~${rep.totalMcpUpfrontTokens.toLocaleString()} tokens/turn -> Skill Catalog: ~${rep.totalSkillCatalogTokens.toLocaleString()} tokens (${rep.totalSavingsPercent}% saved, ~$${rep.estimatedUsdSavedPer1kTurns}/1k turns)`,
          '',
        ];
        for (const s of rep.servers) {
          if (s.status !== 'ok') {
            lines.push(`• ${s.serverName} [${s.status}]: ${s.error ?? 'failed'}`);
            continue;
          }
          lines.push(
            `• ${s.serverName} (${s.toolCount} tools): ${s.mcpUpfrontTokens} -> ${s.skillCatalogTokens} tokens/turn (${s.savingsPercent}% saved)`
          );
          if (s.nativeCliAlternative) {
            lines.push(
              `  ↳ Native CLI tip: use \`${s.nativeCliAlternative.cli}\` (${s.nativeCliAlternative.reason})`
            );
          }
        }
        return lines.join('\n');
      }
    )
  );
}
