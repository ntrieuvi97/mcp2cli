import {
  AuditReport,
  McpServerCapabilitiesSnapshot,
  McpServerConfig,
  ServerTokenAudit,
} from '../types.js';
import { buildServerCacheKey, readCachedSnapshot, writeCachedSnapshot } from '../core/cache.js';
import { introspectMcpServer } from '../core/mcp-client.js';
import { Mcp2CliError, toSkillName } from '../core/security.js';
import { computeTokenSavings, estimateMcpToolsTokens, estimateTokens } from '../core/tokens.js';
import { detectNativeCliAlternative } from './analyzer.js';

export interface AuditOptions {
  refresh?: boolean;
  cacheTtlSeconds?: number;
  trust?: boolean;
  timeoutMs?: number;
  /** Optional offline fixture snapshots keyed by server name (great for testing/CI) */
  snapshots?: Record<string, McpServerCapabilitiesSnapshot>;
}

export function buildSkillFrontmatterText(serverName: string, description: string): string {
  const skillName = toSkillName(serverName);
  return `---\nname: ${skillName}\ndescription: ${description}\n---`;
}

export async function auditServer(
  server: McpServerConfig,
  opts: AuditOptions = {}
): Promise<ServerTokenAudit> {
  const nativeCliAlternative = detectNativeCliAlternative(server);
  const cacheKey = buildServerCacheKey(
    `${server.name}:${server.transport}:${server.url ?? ''}:${server.command ?? ''}:${(server.args ?? []).join(' ')}`
  );

  try {
    let snapshot: McpServerCapabilitiesSnapshot | null = opts.snapshots?.[server.name] ?? null;

    if (!snapshot && !opts.refresh) {
      snapshot = await readCachedSnapshot(cacheKey, opts.cacheTtlSeconds ?? 3600);
    }

    if (!snapshot) {
      snapshot = await introspectMcpServer(server, {
        trustUntrusted: opts.trust,
        timeoutMs: opts.timeoutMs ?? 20_000,
      });
      await writeCachedSnapshot(cacheKey, snapshot);
    }

    const mcpUpfrontTokens = estimateMcpToolsTokens(snapshot.tools);
    const toolPreviewNames = snapshot.tools
      .slice(0, 8)
      .map((t) => t.name)
      .join(', ');
    const frontmatter = buildSkillFrontmatterText(
      server.name,
      `Use the ${server.name} MCP capabilities via lightweight CLI/scripts (${snapshot.tools.length} tools${toolPreviewNames ? `: ${toolPreviewNames}` : ''}). Activate when tasks require ${server.name} operations.`
    );
    const skillCatalogTokens = estimateTokens(frontmatter, 'prose');
    // Estimated compact on-demand SKILL.md body (~12 tokens per tool summary + ~140 framing)
    const skillOnDemandTokens = Math.min(2800, 140 + snapshot.tools.length * 14);

    const { savingsPercent, estimatedUsdSavedPer1kTurns } = computeTokenSavings(
      mcpUpfrontTokens,
      skillCatalogTokens
    );

    return {
      serverName: server.name,
      clientId: server.clientId,
      configPath: server.configPath,
      transport: server.transport,
      toolCount: snapshot.tools.length,
      resourceCount: snapshot.resources.length,
      promptCount: snapshot.prompts.length,
      mcpUpfrontTokens,
      skillCatalogTokens,
      skillOnDemandTokens,
      savingsPercent,
      estimatedUsdSavedPer1kTurns,
      ...(nativeCliAlternative ? { nativeCliAlternative } : {}),
      status: 'ok',
    };
  } catch (err) {
    if (err instanceof Mcp2CliError && err.kind === 'untrusted_config') {
      return {
        serverName: server.name,
        clientId: server.clientId,
        configPath: server.configPath,
        transport: server.transport,
        toolCount: 0,
        resourceCount: 0,
        promptCount: 0,
        mcpUpfrontTokens: 0,
        skillCatalogTokens: 0,
        skillOnDemandTokens: 0,
        savingsPercent: 0,
        estimatedUsdSavedPer1kTurns: 0,
        ...(nativeCliAlternative ? { nativeCliAlternative } : {}),
        status: 'skipped-untrusted',
        error: err.message,
      };
    }

    return {
      serverName: server.name,
      clientId: server.clientId,
      configPath: server.configPath,
      transport: server.transport,
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
      mcpUpfrontTokens: 0,
      skillCatalogTokens: 0,
      skillOnDemandTokens: 0,
      savingsPercent: 0,
      estimatedUsdSavedPer1kTurns: 0,
      ...(nativeCliAlternative ? { nativeCliAlternative } : {}),
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function auditServers(
  servers: McpServerConfig[],
  opts: AuditOptions = {}
): Promise<AuditReport> {
  const results = await Promise.all(servers.map((s) => auditServer(s, opts)));

  const okServers = results.filter((r) => r.status === 'ok');
  const totalMcpUpfrontTokens = okServers.reduce((acc, s) => acc + s.mcpUpfrontTokens, 0);
  const totalSkillCatalogTokens = okServers.reduce((acc, s) => acc + s.skillCatalogTokens, 0);
  const { savingsPercent, estimatedUsdSavedPer1kTurns } = computeTokenSavings(
    totalMcpUpfrontTokens,
    totalSkillCatalogTokens
  );

  return {
    generatedAt: new Date().toISOString(),
    totalServers: servers.length,
    auditedServers: okServers.length,
    totalMcpUpfrontTokens,
    totalSkillCatalogTokens,
    totalSavingsPercent: savingsPercent,
    estimatedUsdSavedPer1kTurns,
    servers: results,
  };
}
