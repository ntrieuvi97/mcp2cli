import { AgentClientId } from '../types.js';
import {
  parkServersInConfig,
  restoreConfigFromBackup,
  scanAgentClients,
} from '../clients/registry.js';
import { OutputOptions, formatOutput, writeStderrInfo, writeStdout } from '../core/output.js';
import { isStdinTty } from '../core/platform.js';
import { Mcp2CliError } from '../core/security.js';
import { convertServerToArtifacts } from '../emitters/convert.js';

export interface MigrateCommandOptions extends OutputOptions {
  client?: AgentClientId;
  config?: string;
  server?: string;
  skillsDir?: string;
  park?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  trust?: boolean;
}

export async function runMigrateCommand(opts: MigrateCommandOptions): Promise<void> {
  if (!opts.dryRun && !opts.yes && !isStdinTty()) {
    throw new Mcp2CliError({
      kind: 'confirmation_required',
      message: 'Migrating client MCP configs modifies config files and requires confirmation.',
      hint: 'Re-run with --yes to confirm, or pass --dry-run to preview changes first.',
      retryable: false,
    });
  }

  const clients = await scanAgentClients({
    client: opts.client,
    configPath: opts.config,
    trust: opts.trust,
  });

  if (clients.length === 0) {
    throw new Mcp2CliError({
      kind: 'not_found',
      message: 'No agent client MCP configurations found to migrate.',
      hint: 'Run `mcp2cli scan --include-missing` to inspect expected config locations.',
      retryable: false,
    });
  }

  const migrationSummaries: Array<{
    clientId: string;
    configPath: string;
    skillsDir: string;
    converted: string[];
    parked: string[];
    backupPath?: string;
    tokensSavedPerTurn: number;
  }> = [];

  for (const client of clients) {
    const targets = client.servers.filter(
      (s) => !s.disabled && (!opts.server || s.name === opts.server)
    );
    if (targets.length === 0) continue;

    const targetSkillsDir = opts.skillsDir ?? client.skillsDir;
    const convertedNames: string[] = [];
    let savedTokens = 0;

    for (const srv of targets) {
      writeStderrInfo(
        `${opts.dryRun ? '[DRY-RUN] ' : ''}Migrating '${srv.name}' from ${client.clientName} -> ${targetSkillsDir}`
      );
      const res = await convertServerToArtifacts(srv, {
        outDir: targetSkillsDir,
        dryRun: opts.dryRun,
        trust: opts.trust,
      });
      convertedNames.push(srv.name);
      savedTokens += Math.max(0, res.mcpUpfrontTokens - res.skillCatalogTokens);
    }

    let parked: string[] = [];
    let backupPath: string | undefined;

    if (opts.park !== false && convertedNames.length > 0) {
      if (opts.dryRun) {
        parked = convertedNames;
        backupPath = `${client.configPath}.mcp2cli.backup`;
      } else if (client.format === 'json' || client.format === 'jsonc') {
        const parkRes = await parkServersInConfig(client.configPath, convertedNames, client.format);
        parked = parkRes.parked;
        backupPath = parkRes.backupPath;
      } else {
        writeStderrInfo(
          `Note: ${client.configPath} uses ${client.format.toUpperCase()}; Skills installed, please comment out migrated entries manually.`
        );
      }
    }

    migrationSummaries.push({
      clientId: client.clientId,
      configPath: client.configPath,
      skillsDir: targetSkillsDir,
      converted: convertedNames,
      parked,
      ...(backupPath ? { backupPath } : {}),
      tokensSavedPerTurn: savedTokens,
    });
  }

  if (migrationSummaries.length === 0) {
    throw new Mcp2CliError({
      kind: 'not_found',
      message: 'No matching active MCP servers found to migrate.',
      retryable: false,
    });
  }

  writeStdout(
    formatOutput(
      { items: migrationSummaries, dryRun: Boolean(opts.dryRun), changed: !opts.dryRun },
      opts,
      (bounded) => {
        const data = bounded as { items: typeof migrationSummaries; dryRun: boolean };
        const lines: string[] = [
          `${data.dryRun ? '[DRY-RUN] ' : ''}Migration complete:`,
          '',
        ];
        for (const m of data.items) {
          lines.push(`• ${m.clientId} (${m.configPath})`);
          lines.push(`  Skills installed: ${m.skillsDir}`);
          lines.push(`  Converted: ${m.converted.join(', ')}`);
          if (m.parked.length > 0) {
            lines.push(`  Parked from raw MCP: ${m.parked.join(', ')} (backup: ${m.backupPath})`);
          }
          lines.push(`  Estimated context reclaimed: ~${m.tokensSavedPerTurn.toLocaleString()} tokens/turn`);
        }
        return lines.join('\n');
      }
    )
  );
}

export interface RestoreCommandOptions extends OutputOptions {
  client?: AgentClientId;
  config?: string;
  yes?: boolean;
}

export async function runRestoreCommand(opts: RestoreCommandOptions): Promise<void> {
  if (!opts.yes && !isStdinTty()) {
    throw new Mcp2CliError({
      kind: 'confirmation_required',
      message: 'Restoring client MCP config overwrites the active config file from backup.',
      hint: 'Re-run with --yes to confirm.',
      retryable: false,
    });
  }

  const clients = await scanAgentClients({
    client: opts.client,
    configPath: opts.config,
  });

  const restored: string[] = [];
  for (const client of clients) {
    const ok = await restoreConfigFromBackup(client.configPath);
    if (ok) restored.push(client.configPath);
  }

  if (restored.length === 0) {
    throw new Mcp2CliError({
      kind: 'not_found',
      message: 'No .mcp2cli.backup files found for matching configs.',
      retryable: false,
    });
  }

  writeStdout(
    formatOutput({ restored, changed: true }, opts, () =>
      `Restored ${restored.length} config(s) from backup:\n${restored.map((p) => `- ${p}`).join('\n')}`
    )
  );
}
