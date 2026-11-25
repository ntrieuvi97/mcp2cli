import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ConvertOptions,
  ConvertResult,
  EmittedArtifact,
  McpServerCapabilitiesSnapshot,
  McpServerConfig,
  ScriptTarget,
  SdkTarget,
} from '../types.js';
import { buildServerCacheKey, readCachedSnapshot, writeCachedSnapshot } from '../core/cache.js';
import { introspectMcpServer } from '../core/mcp-client.js';
import { atomicWriteFile, isWindows } from '../core/platform.js';
import { assertPathInside, toSkillName } from '../core/security.js';
import { saveServerBinding } from '../core/server-registry.js';
import { computeTokenSavings, estimateMcpToolsTokens, estimateTokens } from '../core/tokens.js';
import { detectNativeCliAlternative, filterTools } from '../optimizer/analyzer.js';
import { generateCliShims } from './cli-shim.js';
import { generateScriptsForServer } from './scripts.js';
import { generateCodeModeSdk } from './sdk.js';
import {
  buildCliSpecForServer,
  renderReferenceMarkdown,
  renderSkillMarkdown,
} from './skill.js';

export interface ConvertExecutionOptions extends ConvertOptions {
  refresh?: boolean;
  trust?: boolean;
  dryRun?: boolean;
  snapshot?: McpServerCapabilitiesSnapshot;
  registerServer?: boolean;
}

export async function convertServerToArtifacts(
  server: McpServerConfig,
  opts: ConvertExecutionOptions
): Promise<ConvertResult> {
  const skillName = toSkillName(server.name);
  const outRoot = path.resolve(opts.outDir);
  const skillDir = assertPathInside(outRoot, skillName);

  const cacheKey = buildServerCacheKey(
    `${server.name}:${server.transport}:${server.url ?? ''}:${server.command ?? ''}:${(server.args ?? []).join(' ')}`
  );

  let snapshot: McpServerCapabilitiesSnapshot | null = opts.snapshot ?? null;
  if (!snapshot && !opts.refresh) {
    snapshot = await readCachedSnapshot(cacheKey, 3600);
  }
  if (!snapshot) {
    snapshot = await introspectMcpServer(server, { trustUntrusted: opts.trust });
    await writeCachedSnapshot(cacheKey, snapshot);
  }

  const filteredTools = filterTools(snapshot.tools, {
    includePatterns: opts.includePatterns,
    excludePatterns: opts.excludePatterns,
    readOnlyOnly: opts.readOnlyOnly,
    topTools: opts.topTools,
  });

  const scriptTargets: ScriptTarget[] = opts.scripts ?? ['sh', 'ps1', 'py', 'mjs'];
  const sdkTargets: SdkTarget[] = opts.sdk ?? ['ts', 'py'];
  const nativeCli =
    opts.includeNativeAlternative !== false ? detectNativeCliAlternative(server) : undefined;

  const skillMd = renderSkillMarkdown({
    server,
    snapshot,
    tools: filteredTools,
    nativeCli,
    hasScripts: scriptTargets.length > 0,
    hasSdk: sdkTargets.length > 0,
  });

  const referenceMd = renderReferenceMarkdown(server, snapshot, filteredTools);
  const clispec = JSON.stringify(buildCliSpecForServer(server, filteredTools, skillName), null, 2);

  const scripts = generateScriptsForServer(server, scriptTargets);
  const sdkFiles = generateCodeModeSdk(server, filteredTools, sdkTargets);
  const shims = generateCliShims(server);

  const plannedWrites: Array<{
    relPath: string;
    content: string;
    kind: EmittedArtifact['kind'];
    executable?: boolean;
  }> = [
    { relPath: 'SKILL.md', content: skillMd, kind: 'skill' },
    { relPath: path.join('references', 'REFERENCE.md'), content: referenceMd, kind: 'reference' },
    { relPath: 'clispec.json', content: clispec, kind: 'schema' },
    ...scripts.map((s) => ({
      relPath: path.join('scripts', s.filename),
      content: s.content,
      kind: 'script' as const,
      executable: s.executable,
    })),
    ...sdkFiles.map((f) => ({
      relPath: path.join('sdk', f.relativePath),
      content: f.content,
      kind: 'sdk' as const,
    })),
    ...shims.map((s) => ({
      relPath: path.join('bin', s.filename),
      content: s.content,
      kind: 'cli-shim' as const,
      executable: s.executable,
    })),
  ];

  const artifacts: EmittedArtifact[] = [];

  for (const item of plannedWrites) {
    const absPath = assertPathInside(skillDir, item.relPath);
    const bytes = Buffer.byteLength(item.content, 'utf8');
    if (!opts.dryRun) {
      await atomicWriteFile(absPath, item.content, item.executable ? 0o755 : 0o644);
      if (item.executable && !isWindows()) {
        await fs.chmod(absPath, 0o755).catch(() => undefined);
      }
    }
    artifacts.push({
      path: absPath,
      kind: item.kind,
      bytes,
    });
  }

  if (!opts.dryRun && opts.registerServer !== false) {
    await saveServerBinding(server);
  }

  const mcpUpfrontTokens = estimateMcpToolsTokens(snapshot.tools);
  const frontmatterMatch = /^---\n[\s\S]*?\n---/.exec(skillMd);
  const skillCatalogTokens = estimateTokens(frontmatterMatch?.[0] ?? '', 'prose');
  const { savingsPercent } = computeTokenSavings(mcpUpfrontTokens, skillCatalogTokens);

  return {
    serverName: server.name,
    skillName,
    outputDir: skillDir,
    toolCount: filteredTools.length,
    mcpUpfrontTokens,
    skillCatalogTokens,
    savingsPercent,
    ...(nativeCli ? { nativeCliAlternative: nativeCli } : {}),
    artifacts,
  };
}
