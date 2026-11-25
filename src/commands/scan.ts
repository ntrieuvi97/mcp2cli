import { AgentClientId } from '../types.js';
import { scanAgentClients } from '../clients/registry.js';
import { OutputOptions, formatOutput, writeStdout } from '../core/output.js';
import { redactServerSecrets } from '../core/security.js';

export interface ScanCommandOptions extends OutputOptions {
  client?: AgentClientId;
  config?: string;
  trust?: boolean;
  includeMissing?: boolean;
}

export async function runScanCommand(opts: ScanCommandOptions): Promise<void> {
  const discovered = await scanAgentClients({
    client: opts.client,
    configPath: opts.config,
    trust: opts.trust,
    includeMissing: opts.includeMissing,
  });

  const items = discovered.map((d) => ({
    clientId: d.clientId,
    clientName: d.clientName,
    scope: d.scope,
    configPath: d.configPath,
    ...(d.projectPath ? { projectPath: d.projectPath } : {}),
    skillsDir: d.skillsDir,
    exists: d.exists,
    serverCount: d.servers.length,
    servers: d.servers.map(redactServerSecrets),
    ...(d.parseError ? { parseError: d.parseError } : {}),
  }));

  const payload = {
    items,
    totalClients: items.length,
    totalServers: items.reduce((sum, c) => sum + c.serverCount, 0),
  };

  writeStdout(
    formatOutput(payload, opts, (bounded) => {
      const data = bounded as typeof payload;
      if (data.items.length === 0) {
        return 'No agent client MCP configurations found in the current workspace or user home.';
      }
      const lines: string[] = [
        `Discovered ${data.totalServers} MCP server(s) across ${data.items.length} config(s):`,
        '',
      ];
      for (const client of data.items) {
        lines.push(`• ${client.clientName} [${client.scope}] — ${client.configPath}`);
        if (client.parseError) {
          lines.push(`  ! parse error: ${client.parseError}`);
          continue;
        }
        if (client.servers.length === 0) {
          lines.push('  (no MCP servers configured)');
          continue;
        }
        for (const s of client.servers) {
          const target = s.url ?? `${s.command ?? ''} ${(s.args ?? []).join(' ')}`.trim();
          const warn =
            s.scope === 'project' && !s.trusted && (s.referencedEnvVars?.length ?? 0) > 0
              ? ` [untrusted env: ${s.referencedEnvVars!.join(', ')}]`
              : '';
          const state = s.disabled ? ' (disabled)' : '';
          lines.push(`  - ${s.name} (${s.transport}): ${target}${state}${warn}`);
        }
      }
      return lines.join('\n');
    })
  );
}
