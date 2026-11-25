import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AgentClientId,
  DiscoveredClientConfig,
  McpServerConfig,
  TransportKind,
} from '../types.js';
import { atomicWriteFile, fileExists, getHomeDir, isWindows } from '../core/platform.js';
import { Mcp2CliError, findReferencedEnvVars } from '../core/security.js';

export interface ClientDescriptor {
  id: AgentClientId;
  name: string;
  configCandidates: Array<{
    path: string;
    scope: 'project' | 'user';
    format: 'json' | 'jsonc' | 'toml';
  }>;
  skillsDir: string;
}

/**
 * Strip JSONC single-line `//` and block comments + trailing commas safely
 * without mangling URLs inside string literals (e.g. "https://...").
 */
export function parseJsonc(raw: string): unknown {
  let out = '';
  let inStr = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const next = raw[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inStr) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }

    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    out += ch;
  }

  // Remove trailing commas outside strings
  const cleaned = out.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(cleaned);
}

/**
 * Lightweight parser for OpenAI Codex `~/.codex/config.toml` `[mcp_servers.<name>]` sections.
 */
export function parseCodexToml(raw: string): Record<string, Record<string, unknown>> {
  const servers: Record<string, Record<string, unknown>> = {};
  let currentServer: string | null = null;
  let currentSubTable: 'env' | 'headers' | null = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      const sec = sectionMatch[1]!.trim();
      const subMatch = /^mcp_servers\.([^.]+)\.(env|http_headers|headers)$/.exec(sec);
      if (subMatch) {
        currentServer = subMatch[1]!.replace(/^["']|["']$/g, '');
        currentSubTable = subMatch[2] === 'env' ? 'env' : 'headers';
        servers[currentServer] ??= {};
      } else {
        const mainMatch = /^mcp_servers\.([^.]+)$/.exec(sec);
        if (mainMatch) {
          currentServer = mainMatch[1]!.replace(/^["']|["']$/g, '');
          currentSubTable = null;
          servers[currentServer] ??= {};
        } else {
          currentServer = null;
          currentSubTable = null;
        }
      }
      continue;
    }

    if (!currentServer) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim().replace(/^["']|["']$/g, '');
    let valRaw = line.slice(eqIdx + 1).trim();
    // Strip inline comment outside quotes
    if (!valRaw.startsWith('"') && !valRaw.startsWith("'")) {
      const hashIdx = valRaw.indexOf('#');
      if (hashIdx !== -1 && !valRaw.startsWith('[')) {
        valRaw = valRaw.slice(0, hashIdx).trim();
      }
    }

    let parsedVal: unknown = valRaw;
    if (valRaw === 'true') parsedVal = true;
    else if (valRaw === 'false') parsedVal = false;
    else if (/^\[.*\]$/.test(valRaw)) {
      try {
        parsedVal = JSON.parse(valRaw.replace(/'/g, '"'));
      } catch {
        parsedVal = [];
      }
    } else if (/^["'].*["']$/.test(valRaw)) {
      parsedVal = valRaw.slice(1, -1);
    }

    if (currentSubTable) {
      const existing = (servers[currentServer]![currentSubTable] as Record<string, string> | undefined) ?? {};
      existing[key] = String(parsedVal);
      servers[currentServer]![currentSubTable] = existing;
    } else {
      servers[currentServer]![key] = parsedVal;
    }
  }
  return servers;
}

export function getClientDescriptors(cwd = process.cwd(), home = getHomeDir()): ClientDescriptor[] {
  const appData = process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming');
  const xdgConfig = process.env['XDG_CONFIG_HOME'] || path.join(home, '.config');

  const claudeDesktopConfig = isWindows()
    ? path.join(appData, 'Claude', 'claude_desktop_config.json')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : path.join(xdgConfig, 'Claude', 'claude_desktop_config.json');

  const vscodeUserMcp = isWindows()
    ? path.join(appData, 'Code', 'User', 'mcp.json')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
      : path.join(xdgConfig, 'Code', 'User', 'mcp.json');

  const clineMcp = isWindows()
    ? path.join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')
      : path.join(xdgConfig, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');

  const rooMcp = isWindows()
    ? path.join(appData, 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json')
      : path.join(xdgConfig, 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json');

  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      configCandidates: [
        { path: path.join(cwd, '.mcp.json'), scope: 'project', format: 'json' },
        { path: path.join(home, '.claude.json'), scope: 'user', format: 'json' },
      ],
      skillsDir: path.join(home, '.claude', 'skills'),
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      configCandidates: [{ path: claudeDesktopConfig, scope: 'user', format: 'json' }],
      skillsDir: path.join(home, '.claude', 'skills'),
    },
    {
      id: 'cursor',
      name: 'Cursor',
      configCandidates: [
        { path: path.join(cwd, '.cursor', 'mcp.json'), scope: 'project', format: 'jsonc' },
        { path: path.join(home, '.cursor', 'mcp.json'), scope: 'user', format: 'jsonc' },
      ],
      skillsDir: path.join(home, '.cursor', 'skills'),
    },
    {
      id: 'vscode',
      name: 'VS Code Copilot',
      configCandidates: [
        { path: path.join(cwd, '.vscode', 'mcp.json'), scope: 'project', format: 'jsonc' },
        { path: vscodeUserMcp, scope: 'user', format: 'jsonc' },
      ],
      skillsDir: path.join(cwd, '.github', 'skills'),
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      configCandidates: [
        { path: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), scope: 'user', format: 'json' },
      ],
      skillsDir: path.join(home, '.codeium', 'windsurf', 'skills'),
    },
    {
      id: 'cline',
      name: 'Cline',
      configCandidates: [{ path: clineMcp, scope: 'user', format: 'json' }],
      skillsDir: path.join(home, '.cline', 'skills'),
    },
    {
      id: 'roo-code',
      name: 'Roo Code',
      configCandidates: [{ path: rooMcp, scope: 'user', format: 'json' }],
      skillsDir: path.join(home, '.roo', 'skills'),
    },
    {
      id: 'codex',
      name: 'OpenAI Codex CLI',
      configCandidates: [{ path: path.join(home, '.codex', 'config.toml'), scope: 'user', format: 'toml' }],
      skillsDir: path.join(home, '.codex', 'skills'),
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      configCandidates: [
        { path: path.join(cwd, '.gemini', 'settings.json'), scope: 'project', format: 'jsonc' },
        { path: path.join(home, '.gemini', 'settings.json'), scope: 'user', format: 'jsonc' },
      ],
      skillsDir: path.join(home, '.gemini', 'skills'),
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      configCandidates: [
        { path: path.join(cwd, 'opencode.json'), scope: 'project', format: 'jsonc' },
        { path: path.join(xdgConfig, 'opencode', 'opencode.json'), scope: 'user', format: 'jsonc' },
      ],
      skillsDir: path.join(xdgConfig, 'opencode', 'skills'),
    },
    {
      id: 'openclaw',
      name: 'OpenClaw',
      configCandidates: [
        { path: path.join(home, '.openclaw', 'openclaw.json'), scope: 'user', format: 'jsonc' },
      ],
      skillsDir: path.join(home, '.openclaw', 'skills'),
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      configCandidates: [
        { path: path.join(home, '.gemini', 'antigravity', 'mcp_config.json'), scope: 'user', format: 'jsonc' },
      ],
      skillsDir: path.join(home, '.gemini', 'antigravity', 'skills'),
    },
    {
      id: 'generic',
      name: 'Generic Project MCP',
      configCandidates: [
        { path: path.join(cwd, 'mcp.json'), scope: 'project', format: 'jsonc' },
        { path: path.join(cwd, 'mcp_servers.json'), scope: 'project', format: 'jsonc' },
      ],
      skillsDir: path.join(cwd, '.agents', 'skills'),
    },
  ];
}

function normalizeServerEntry(
  name: string,
  raw: Record<string, unknown>,
  meta: {
    clientId: AgentClientId;
    configPath: string;
    projectPath?: string;
    scope: 'project' | 'user';
    trusted: boolean;
  }
): McpServerConfig | null {
  if (!raw || typeof raw !== 'object') return null;

  // Handle OpenCode `mcp` format (`command: ["npx", ...]`, `type: "local"|"remote"`)
  let command = typeof raw['command'] === 'string' ? raw['command'] : undefined;
  let args = Array.isArray(raw['args']) ? raw['args'].map(String) : undefined;
  if (Array.isArray(raw['command']) && raw['command'].length > 0) {
    command = String(raw['command'][0]);
    args = raw['command'].slice(1).map(String);
  }

  const url =
    typeof raw['url'] === 'string'
      ? raw['url']
      : typeof raw['serverUrl'] === 'string'
        ? raw['serverUrl']
        : undefined;

  const rawType = typeof raw['type'] === 'string' ? raw['type'].toLowerCase() : undefined;
  let transport: TransportKind = 'stdio';
  if (url) {
    transport = rawType === 'sse' || url.endsWith('/sse') ? 'sse' : 'http';
  } else if (rawType === 'http' || rawType === 'streamable-http' || rawType === 'remote') {
    transport = 'http';
  } else if (rawType === 'sse') {
    transport = 'sse';
  }

  if (!command && !url) return null;

  const env =
    raw['env'] && typeof raw['env'] === 'object'
      ? Object.fromEntries(Object.entries(raw['env'] as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : raw['environment'] && typeof raw['environment'] === 'object'
        ? Object.fromEntries(Object.entries(raw['environment'] as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
        : undefined;

  const headers =
    raw['headers'] && typeof raw['headers'] === 'object'
      ? Object.fromEntries(Object.entries(raw['headers'] as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : undefined;

  const disabled = Boolean(raw['disabled'] === true || raw['enabled'] === false);

  const server: McpServerConfig = {
    name,
    transport,
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
    ...(typeof raw['cwd'] === 'string' ? { cwd: raw['cwd'] } : {}),
    ...(url ? { url } : {}),
    ...(headers ? { headers } : {}),
    disabled,
    clientId: meta.clientId,
    configPath: meta.configPath,
    ...(meta.projectPath ? { projectPath: meta.projectPath } : {}),
    scope: meta.scope,
    trusted: meta.trusted,
  };
  server.referencedEnvVars = findReferencedEnvVars(server);
  return server;
}

function isFlatServerEntry(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['command'] === 'string' ||
    Array.isArray(obj['command']) ||
    typeof obj['url'] === 'string' ||
    typeof obj['serverUrl'] === 'string'
  );
}

export function extractServersFromParsedConfig(
  parsed: Record<string, unknown>,
  meta: {
    clientId: AgentClientId;
    configPath: string;
    projectPath?: string;
    scope: 'project' | 'user';
    trusted: boolean;
  }
): McpServerConfig[] {
  const wrapper =
    (parsed['mcpServers'] as Record<string, unknown> | undefined) ??
    (parsed['servers'] as Record<string, unknown> | undefined) ??
    (parsed['mcp'] as Record<string, unknown> | undefined) ??
    (parsed['mcp_servers'] as Record<string, unknown> | undefined);

  let mapObj: Record<string, unknown> = {};
  if (wrapper && typeof wrapper === 'object' && !Array.isArray(wrapper)) {
    mapObj = wrapper;
  } else {
    // Support flat `.mcp.json` maps (common in Claude Code plugins: `{ "atlassian": { "type": "http", "url": "..." } }`)
    for (const [k, v] of Object.entries(parsed)) {
      if (isFlatServerEntry(v)) {
        mapObj[k] = v;
      }
    }
  }

  const list: McpServerConfig[] = [];
  for (const [name, entry] of Object.entries(mapObj)) {
    if (entry && typeof entry === 'object') {
      const normalized = normalizeServerEntry(name, entry as Record<string, unknown>, meta);
      if (normalized) list.push(normalized);
    }
  }
  return list;
}

interface ClaudeProjectEntry {
  projectPath: string;
  servers: McpServerConfig[];
}

function extractClaudeProjectConfigs(
  parsed: Record<string, unknown>,
  configPath: string,
  cwd: string,
  trustOverride?: boolean
): ClaudeProjectEntry[] {
  const projects = parsed['projects'];
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return [];

  const resolvedCwd = path.resolve(cwd);
  const entries = Object.entries(projects as Record<string, unknown>).filter(
    ([, val]) => val && typeof val === 'object' && !Array.isArray(val)
  );

  // Prioritize exact cwd match, then ancestor matches of cwd, then remaining paths
  entries.sort(([dirA], [dirB]) => {
    const resA = path.resolve(dirA);
    const resB = path.resolve(dirB);
    const score = (p: string) =>
      p === resolvedCwd ? 0 : resolvedCwd.startsWith(p + path.sep) ? 1 : 2;
    const diff = score(resA) - score(resB);
    return diff !== 0 ? diff : dirA.localeCompare(dirB);
  });

  const out: ClaudeProjectEntry[] = [];
  for (const [projectPath, rawProj] of entries) {
    const proj = rawProj as Record<string, unknown>;
    if (!proj['mcpServers'] || typeof proj['mcpServers'] !== 'object') continue;
    const disabledSet = new Set(
      Array.isArray(proj['disabledMcpServers'])
        ? (proj['disabledMcpServers'] as unknown[]).map(String)
        : []
    );
    const servers = extractServersFromParsedConfig(
      { mcpServers: proj['mcpServers'] },
      {
        clientId: 'claude-code',
        configPath,
        projectPath,
        scope: 'project',
        // `~/.claude.json` is user-owned in $HOME (written by `claude mcp add`), not a repo-tracked file.
        trusted: trustOverride ?? true,
      }
    ).map((s) => (disabledSet.has(s.name) ? { ...s, disabled: true } : s));

    if (servers.length > 0) {
      out.push({ projectPath, servers });
    }
  }
  return out;
}

export async function parseConfigFile(
  configPath: string,
  meta: { clientId: AgentClientId; scope: 'project' | 'user'; format: 'json' | 'jsonc' | 'toml'; trusted?: boolean }
): Promise<{ servers: McpServerConfig[]; parsedObj?: Record<string, unknown>; parseError?: string }> {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const trusted = meta.trusted ?? meta.scope === 'user';

    if (meta.format === 'toml') {
      const tomlServers = parseCodexToml(raw);
      const servers: McpServerConfig[] = [];
      for (const [name, entry] of Object.entries(tomlServers)) {
        const norm = normalizeServerEntry(name, entry, {
          clientId: meta.clientId,
          configPath,
          scope: meta.scope,
          trusted,
        });
        if (norm) servers.push(norm);
      }
      return { servers };
    }

    const parsed = (meta.format === 'jsonc' ? parseJsonc(raw) : JSON.parse(raw)) as Record<string, unknown>;
    return {
      parsedObj: parsed,
      servers: extractServersFromParsedConfig(parsed, {
        clientId: meta.clientId,
        configPath,
        scope: meta.scope,
        trusted,
      }),
    };
  } catch (err) {
    return {
      servers: [],
      parseError: err instanceof Error ? err.message : String(err),
    };
  }
}

async function readJsonSafe(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    if (!(await fileExists(filePath))) return null;
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = parseJsonc(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function discoverClaudePlugins(
  home: string,
  cwd: string,
  skillsDir: string,
  trustOverride?: boolean
): Promise<DiscoveredClientConfig[]> {
  const installedPath = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  const installedJson = await readJsonSafe(installedPath);
  if (!installedJson) return [];

  // Merge enabledPlugins across user & project Claude settings
  const enabledPlugins: Record<string, boolean> = {};
  let hasEnabledPluginsMap = false;
  const settingsCandidates = [
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'settings.local.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.local.json'),
  ];
  for (const sPath of settingsCandidates) {
    const sObj = await readJsonSafe(sPath);
    const ep = sObj?.['enabledPlugins'];
    if (ep && typeof ep === 'object' && !Array.isArray(ep)) {
      hasEnabledPluginsMap = true;
      for (const [k, v] of Object.entries(ep as Record<string, unknown>)) {
        if (typeof v === 'boolean') enabledPlugins[k] = v;
      }
    }
  }

  const rawPluginsMap =
    installedJson['plugins'] && typeof installedJson['plugins'] === 'object' && !Array.isArray(installedJson['plugins'])
      ? (installedJson['plugins'] as Record<string, unknown>)
      : installedJson;

  const discovered: DiscoveredClientConfig[] = [];
  const seenConfigFiles = new Set<string>();

  for (const [pluginId, rawEntry] of Object.entries(rawPluginsMap)) {
    if (pluginId === 'version') continue;
    const records = Array.isArray(rawEntry) ? rawEntry : [rawEntry];
    for (const rec of records) {
      if (!rec || typeof rec !== 'object') continue;
      const installPath = (rec as Record<string, unknown>)['installPath'];
      if (typeof installPath !== 'string' || !installPath) continue;

      const isPluginDisabled = hasEnabledPluginsMap ? enabledPlugins[pluginId] !== true : false;
      const mcpCandidates = [path.join(installPath, '.mcp.json')];

      const pluginManifestPath = path.join(installPath, '.claude-plugin', 'plugin.json');
      const manifestObj = await readJsonSafe(pluginManifestPath);
      if (manifestObj) {
        if (typeof manifestObj['mcpServers'] === 'string') {
          mcpCandidates.push(path.resolve(installPath, manifestObj['mcpServers']));
        } else if (manifestObj['mcpServers'] && typeof manifestObj['mcpServers'] === 'object') {
          mcpCandidates.push(pluginManifestPath);
        }
      }

      for (const candidateFile of mcpCandidates) {
        const resolvedFile = path.resolve(candidateFile);
        if (seenConfigFiles.has(resolvedFile)) continue;
        if (!(await fileExists(resolvedFile))) continue;
        seenConfigFiles.add(resolvedFile);

        const { servers, parseError } = await parseConfigFile(resolvedFile, {
          clientId: 'claude-code',
          scope: 'user',
          format: 'jsonc',
          trusted: trustOverride ?? true,
        });

        const finalServers = servers.map((s) =>
          isPluginDisabled ? { ...s, disabled: true } : s
        );

        if (finalServers.length === 0 && !parseError) continue;

        discovered.push({
          clientId: 'claude-code',
          clientName: `Claude Code Plugin (${pluginId})`,
          configPath: resolvedFile,
          readonlyConfig: true,
          skillsDir,
          scope: 'user',
          format: 'json',
          exists: true,
          servers: finalServers,
          ...(parseError ? { parseError } : {}),
        });
      }
    }
  }

  return discovered;
}

export interface ScanOptions {
  cwd?: string;
  homeDir?: string;
  client?: AgentClientId;
  configPath?: string;
  trust?: boolean;
  includeMissing?: boolean;
}

export async function scanAgentClients(opts: ScanOptions = {}): Promise<DiscoveredClientConfig[]> {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.homeDir ?? getHomeDir();

  if (opts.configPath) {
    const abs = path.resolve(opts.configPath);
    const exists = await fileExists(abs);
    if (!exists) {
      throw new Mcp2CliError({
        kind: 'not_found',
        message: `Config file not found: ${abs}`,
        retryable: false,
      });
    }
    const format = abs.endsWith('.toml') ? 'toml' : 'jsonc';
    const { servers, parsedObj, parseError } = await parseConfigFile(abs, {
      clientId: opts.client ?? 'generic',
      scope: 'project',
      format,
      trusted: opts.trust ?? true, // Explicit file path is a user trust action
    });
    const out: DiscoveredClientConfig[] = [
      {
        clientId: opts.client ?? 'generic',
        clientName: 'Explicit Config',
        configPath: abs,
        skillsDir: path.join(cwd, '.agents', 'skills'),
        scope: 'project',
        format,
        exists: true,
        servers,
        ...(parseError ? { parseError } : {}),
      },
    ];
    if (parsedObj && (opts.client === 'claude-code' || path.basename(abs) === '.claude.json')) {
      for (const proj of extractClaudeProjectConfigs(parsedObj, abs, cwd, opts.trust)) {
        out.push({
          clientId: 'claude-code',
          clientName: `Claude Code (${proj.projectPath})`,
          configPath: abs,
          projectPath: proj.projectPath,
          skillsDir: path.join(home, '.claude', 'skills'),
          scope: 'project',
          format: 'json',
          exists: true,
          servers: proj.servers,
        });
      }
    }
    return out;
  }

  const descriptors = getClientDescriptors(cwd, home).filter(
    (d) => !opts.client || d.id === opts.client
  );
  const results: DiscoveredClientConfig[] = [];
  const seenPaths = new Set<string>();

  for (const desc of descriptors) {
    for (const candidate of desc.configCandidates) {
      const normalized = path.resolve(candidate.path);
      if (seenPaths.has(normalized)) continue;
      const exists = await fileExists(normalized);
      if (!exists && !opts.includeMissing) continue;
      seenPaths.add(normalized);

      if (!exists) {
        results.push({
          clientId: desc.id,
          clientName: desc.name,
          configPath: normalized,
          skillsDir: desc.skillsDir,
          scope: candidate.scope,
          format: candidate.format,
          exists: false,
          servers: [],
        });
        continue;
      }

      const { servers, parsedObj, parseError } = await parseConfigFile(normalized, {
        clientId: desc.id,
        scope: candidate.scope,
        format: candidate.format,
        trusted: opts.trust ?? candidate.scope === 'user',
      });

      results.push({
        clientId: desc.id,
        clientName: desc.name,
        configPath: normalized,
        skillsDir: desc.skillsDir,
        scope: candidate.scope,
        format: candidate.format,
        exists: true,
        servers,
        ...(parseError ? { parseError } : {}),
      });

      // Claude Code stores `claude mcp add` (local scope) entries under `projects[dir].mcpServers` in ~/.claude.json
      if (desc.id === 'claude-code' && candidate.scope === 'user' && parsedObj) {
        for (const proj of extractClaudeProjectConfigs(parsedObj, normalized, cwd, opts.trust)) {
          results.push({
            clientId: 'claude-code',
            clientName: `Claude Code (${proj.projectPath})`,
            configPath: normalized,
            projectPath: proj.projectPath,
            skillsDir: desc.skillsDir,
            scope: 'project',
            format: candidate.format,
            exists: true,
            servers: proj.servers,
          });
        }
      }
    }

    if (desc.id === 'claude-code') {
      const pluginConfigs = await discoverClaudePlugins(home, cwd, desc.skillsDir, opts.trust);
      results.push(...pluginConfigs);
    }
  }

  return results;
}

export function getBackupPathForConfig(configPath: string): string {
  return `${configPath}.mcp2cli.backup`;
}

function parkInServerMap(
  container: Record<string, unknown>,
  serverNames: string[]
): string[] {
  const key =
    'mcpServers' in container
      ? 'mcpServers'
      : 'servers' in container
        ? 'servers'
        : 'mcp' in container
          ? 'mcp'
          : null;

  if (!key || !container[key] || typeof container[key] !== 'object') {
    return [];
  }

  const map = container[key] as Record<string, Record<string, unknown>>;
  const parkedArchive = (container['_mcp2cliParked'] as Record<string, unknown> | undefined) ?? {};
  const parked: string[] = [];

  for (const name of serverNames) {
    if (name in map) {
      parkedArchive[name] = map[name];
      delete map[name];
      parked.push(name);
    }
  }

  if (parked.length > 0) {
    container['_mcp2cliParked'] = parkedArchive;
  }
  return parked;
}

/**
 * Safely park/disable migrated MCP server entries in a JSON/JSONC client config
 * after writing a verified backup so `mcp2cli restore` can revert 100% cleanly.
 */
export async function parkServersInConfig(
  configPath: string,
  serverNames: string[],
  format: 'json' | 'jsonc' | 'toml' | 'yaml',
  projectPath?: string
): Promise<{ backupPath: string; parked: string[] }> {
  const backupPath = getBackupPathForConfig(configPath);
  const original = await fs.readFile(configPath, 'utf8');
  if (!(await fileExists(backupPath))) {
    await atomicWriteFile(backupPath, original, 0o600);
  }

  if (format === 'toml' || format === 'yaml') {
    // Non-destructive comment-out or notice for TOML/YAML
    throw new Mcp2CliError({
      kind: 'validation',
      message: `Automatic in-place parking for ${format.toUpperCase()} configs is skipped to avoid reformatting comments.`,
      hint: `Backup saved at ${backupPath}. Remove or comment out [mcp_servers.<name>] manually after verifying the Skill.`,
      retryable: false,
    });
  }

  const parsed = (format === 'jsonc' ? parseJsonc(original) : JSON.parse(original)) as Record<string, unknown>;
  let parked: string[] = [];

  if (projectPath && parsed['projects'] && typeof parsed['projects'] === 'object') {
    const projMap = parsed['projects'] as Record<string, unknown>;
    const proj = projMap[projectPath];
    if (proj && typeof proj === 'object' && !Array.isArray(proj)) {
      parked = parkInServerMap(proj as Record<string, unknown>, serverNames);
    }
  } else {
    parked = parkInServerMap(parsed, serverNames);
    if (parked.length === 0 && parsed['projects'] && typeof parsed['projects'] === 'object') {
      const remaining = new Set(serverNames);
      for (const rawProj of Object.values(parsed['projects'] as Record<string, unknown>)) {
        if (rawProj && typeof rawProj === 'object' && !Array.isArray(rawProj)) {
          const newlyParked = parkInServerMap(rawProj as Record<string, unknown>, [...remaining]);
          parked.push(...newlyParked);
          for (const p of newlyParked) remaining.delete(p);
        }
      }
    }
  }

  if (parked.length > 0) {
    await atomicWriteFile(configPath, JSON.stringify(parsed, null, 2) + os.EOL, 0o600);
  }

  return { backupPath, parked };
}

export async function restoreConfigFromBackup(configPath: string): Promise<boolean> {
  const backupPath = getBackupPathForConfig(configPath);
  if (!(await fileExists(backupPath))) return false;
  const original = await fs.readFile(backupPath, 'utf8');
  await atomicWriteFile(configPath, original, 0o600);
  return true;
}
