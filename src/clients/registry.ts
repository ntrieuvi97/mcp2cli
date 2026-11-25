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

export function getClientDescriptors(cwd = process.cwd()): ClientDescriptor[] {
  const home = getHomeDir();
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
  meta: { clientId: AgentClientId; configPath: string; scope: 'project' | 'user'; trusted: boolean }
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
    scope: meta.scope,
    trusted: meta.trusted,
  };
  server.referencedEnvVars = findReferencedEnvVars(server);
  return server;
}

export function extractServersFromParsedConfig(
  parsed: Record<string, unknown>,
  meta: { clientId: AgentClientId; configPath: string; scope: 'project' | 'user'; trusted: boolean }
): McpServerConfig[] {
  const mapObj =
    (parsed['mcpServers'] as Record<string, unknown> | undefined) ??
    (parsed['servers'] as Record<string, unknown> | undefined) ??
    (parsed['mcp'] as Record<string, unknown> | undefined) ??
    (parsed['mcp_servers'] as Record<string, unknown> | undefined) ??
    {};

  if (!mapObj || typeof mapObj !== 'object') return [];

  const list: McpServerConfig[] = [];
  for (const [name, entry] of Object.entries(mapObj)) {
    if (entry && typeof entry === 'object') {
      const normalized = normalizeServerEntry(name, entry as Record<string, unknown>, meta);
      if (normalized) list.push(normalized);
    }
  }
  return list;
}

export async function parseConfigFile(
  configPath: string,
  meta: { clientId: AgentClientId; scope: 'project' | 'user'; format: 'json' | 'jsonc' | 'toml'; trusted?: boolean }
): Promise<{ servers: McpServerConfig[]; parseError?: string }> {
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

export interface ScanOptions {
  cwd?: string;
  client?: AgentClientId;
  configPath?: string;
  trust?: boolean;
  includeMissing?: boolean;
}

export async function scanAgentClients(opts: ScanOptions = {}): Promise<DiscoveredClientConfig[]> {
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
    const { servers, parseError } = await parseConfigFile(abs, {
      clientId: opts.client ?? 'generic',
      scope: 'project',
      format,
      trusted: opts.trust ?? true, // Explicit file path is a user trust action
    });
    return [
      {
        clientId: opts.client ?? 'generic',
        clientName: 'Explicit Config',
        configPath: abs,
        skillsDir: path.join(opts.cwd ?? process.cwd(), '.agents', 'skills'),
        scope: 'project',
        format,
        exists: true,
        servers,
        ...(parseError ? { parseError } : {}),
      },
    ];
  }

  const descriptors = getClientDescriptors(opts.cwd).filter(
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

      const { servers, parseError } = await parseConfigFile(normalized, {
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
    }
  }

  return results;
}

export function getBackupPathForConfig(configPath: string): string {
  return `${configPath}.mcp2cli.backup`;
}

/**
 * Safely park/disable migrated MCP server entries in a JSON/JSONC client config
 * after writing a verified backup so `mcp2cli restore` can revert 100% cleanly.
 */
export async function parkServersInConfig(
  configPath: string,
  serverNames: string[],
  format: 'json' | 'jsonc' | 'toml' | 'yaml'
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
  const key =
    'mcpServers' in parsed
      ? 'mcpServers'
      : 'servers' in parsed
        ? 'servers'
        : 'mcp' in parsed
          ? 'mcp'
          : null;

  if (!key || !parsed[key] || typeof parsed[key] !== 'object') {
    return { backupPath, parked: [] };
  }

  const map = parsed[key] as Record<string, Record<string, unknown>>;
  const parkedArchive = (parsed['_mcp2cliParked'] as Record<string, unknown> | undefined) ?? {};
  const parked: string[] = [];

  for (const name of serverNames) {
    if (name in map) {
      parkedArchive[name] = map[name];
      delete map[name];
      parked.push(name);
    }
  }

  if (parked.length > 0) {
    parsed['_mcp2cliParked'] = parkedArchive;
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
