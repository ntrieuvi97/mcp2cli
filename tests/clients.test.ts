import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parkServersInConfig,
  parseCodexToml,
  parseJsonc,
  restoreConfigFromBackup,
  scanAgentClients,
} from '../src/clients/registry.js';

describe('agent client config discovery, parsing & reversible parking', () => {
  it('parses JSONC with comments and trailing commas without corrupting URLs', () => {
    const parsed = parseJsonc(`{
      // Comment mentioning https://example.com
      "mcpServers": {
        "context7": {
          "url": "https://mcp.context7.com/mcp", // trailing comment
        },
      },
    }`) as { mcpServers: { context7: { url: string } } };
    expect(parsed.mcpServers.context7.url).toBe('https://mcp.context7.com/mcp');
  });

  it('parses Codex TOML [mcp_servers.<name>] configs', () => {
    const parsed = parseCodexToml(`
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[mcp_servers.github.env]
GITHUB_PERSONAL_ACCESS_TOKEN = "\${GITHUB_TOKEN}"
`);
    expect(parsed['github']?.['command']).toBe('npx');
    expect(parsed['github']?.['args']).toEqual(['-y', '@modelcontextprotocol/server-github']);
    expect((parsed['github']?.['env'] as Record<string, string>)['GITHUB_PERSONAL_ACCESS_TOKEN']).toBe(
      '${GITHUB_TOKEN}'
    );
  });

  it('scans project Cursor config, flags untrusted env refs, parks, and restores', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp2cli-clients-'));
    try {
      const cursorDir = path.join(tmpDir, '.cursor');
      await fs.mkdir(cursorDir, { recursive: true });
      const cfgPath = path.join(cursorDir, 'mcp.json');
      const original = JSON.stringify(
        {
          mcpServers: {
            tracker: {
              command: 'node',
              args: ['./server.js'],
              env: { API_TOKEN: '${TRACKER_TOKEN}' },
            },
          },
        },
        null,
        2
      );
      await fs.writeFile(cfgPath, original, 'utf8');

      const discovered = await scanAgentClients({ cwd: tmpDir, client: 'cursor' });
      expect(discovered).toHaveLength(1);
      expect(discovered[0]!.servers[0]!.name).toBe('tracker');
      expect(discovered[0]!.servers[0]!.trusted).toBe(false);
      expect(discovered[0]!.servers[0]!.referencedEnvVars).toEqual(['TRACKER_TOKEN']);

      const parkRes = await parkServersInConfig(cfgPath, ['tracker'], 'jsonc');
      expect(parkRes.parked).toEqual(['tracker']);
      const afterPark = JSON.parse(await fs.readFile(cfgPath, 'utf8')) as Record<string, unknown>;
      expect(afterPark['mcpServers']).toEqual({});
      expect(afterPark['_mcp2cliParked']).toHaveProperty('tracker');

      const restored = await restoreConfigFromBackup(cfgPath);
      expect(restored).toBe(true);
      expect(await fs.readFile(cfgPath, 'utf8')).toBe(original);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('scans ~/.claude.json projects.<dir>.mcpServers, honors disabledMcpServers, parks, and restores', async () => {
    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp2cli-claude-home-'));
    try {
      const projA = path.join(tmpHome, 'work', 'app-a');
      const projB = path.join(tmpHome, 'work', 'app-b');
      const claudeJsonPath = path.join(tmpHome, '.claude.json');
      const original = JSON.stringify(
        {
          mcpServers: {
            globalTool: { command: 'npx', args: ['-y', '@acme/global'] },
          },
          projects: {
            [projA]: {
              mcpServers: {
                testomat: { command: 'npx', args: ['-y', '@testomatio/mcp'] },
                oldServer: { command: 'node', args: ['./old.js'] },
              },
              disabledMcpServers: ['oldServer'],
            },
            [projB]: {
              mcpServers: {
                atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v1/mcp' },
              },
            },
          },
        },
        null,
        2
      );
      await fs.writeFile(claudeJsonPath, original, 'utf8');

      const discovered = await scanAgentClients({ cwd: projA, homeDir: tmpHome, client: 'claude-code' });
      expect(discovered).toHaveLength(3);
      expect(discovered[0]!.servers.map((s) => s.name)).toEqual(['globalTool']);
      // Exact cwd match projA comes before projB
      expect(discovered[1]!.projectPath).toBe(projA);
      expect(discovered[1]!.servers.find((s) => s.name === 'testomat')?.disabled).toBe(false);
      expect(discovered[1]!.servers.find((s) => s.name === 'oldServer')?.disabled).toBe(true);
      expect(discovered[2]!.projectPath).toBe(projB);
      expect(discovered[2]!.servers[0]!.name).toBe('atlassian');
      expect(discovered[2]!.servers[0]!.transport).toBe('http');

      const parkRes = await parkServersInConfig(claudeJsonPath, ['testomat'], 'json', projA);
      expect(parkRes.parked).toEqual(['testomat']);
      const afterPark = JSON.parse(await fs.readFile(claudeJsonPath, 'utf8')) as {
        projects: Record<string, { mcpServers: Record<string, unknown>; _mcp2cliParked: Record<string, unknown> }>;
      };
      expect(afterPark.projects[projA]!.mcpServers).not.toHaveProperty('testomat');
      expect(afterPark.projects[projA]!._mcp2cliParked).toHaveProperty('testomat');

      const restored = await restoreConfigFromBackup(claudeJsonPath);
      expect(restored).toBe(true);
      expect(await fs.readFile(claudeJsonPath, 'utf8')).toBe(original);
    } finally {
      await fs.rm(tmpHome, { recursive: true, force: true });
    }
  });

  it('scans Claude Code installed plugins (.mcp.json flat map & enabledPlugins)', async () => {
    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp2cli-claude-plugins-'));
    try {
      const pluginsDir = path.join(tmpHome, '.claude', 'plugins');
      const atlassianInstall = path.join(pluginsDir, 'cache', 'official', 'atlassian', '1.0.0');
      const disabledInstall = path.join(pluginsDir, 'cache', 'official', 'linear', '1.0.0');
      await fs.mkdir(atlassianInstall, { recursive: true });
      await fs.mkdir(disabledInstall, { recursive: true });

      await fs.writeFile(
        path.join(tmpHome, '.claude', 'settings.json'),
        JSON.stringify({
          enabledPlugins: {
            'atlassian@claude-plugins-official': true,
            'linear@claude-plugins-official': false,
          },
        }),
        'utf8'
      );

      await fs.writeFile(
        path.join(pluginsDir, 'installed_plugins.json'),
        JSON.stringify({
          version: 2,
          plugins: {
            'atlassian@claude-plugins-official': [{ scope: 'user', installPath: atlassianInstall }],
            'linear@claude-plugins-official': [{ scope: 'user', installPath: disabledInstall }],
          },
        }),
        'utf8'
      );

      // Flat .mcp.json format used by Claude Code plugins
      await fs.writeFile(
        path.join(atlassianInstall, '.mcp.json'),
        JSON.stringify({
          atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v1/mcp' },
        }),
        'utf8'
      );
      await fs.writeFile(
        path.join(disabledInstall, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            linear: { type: 'http', url: 'https://mcp.linear.app/mcp' },
          },
        }),
        'utf8'
      );

      const discovered = await scanAgentClients({ cwd: tmpHome, homeDir: tmpHome, client: 'claude-code' });
      const pluginItems = discovered.filter((d) => d.clientName.startsWith('Claude Code Plugin'));
      expect(pluginItems).toHaveLength(2);

      const atlassianPlugin = pluginItems.find((p) => p.clientName.includes('atlassian'));
      expect(atlassianPlugin?.readonlyConfig).toBe(true);
      expect(atlassianPlugin?.servers[0]?.name).toBe('atlassian');
      expect(atlassianPlugin?.servers[0]?.disabled).toBe(false);

      const linearPlugin = pluginItems.find((p) => p.clientName.includes('linear'));
      expect(linearPlugin?.servers[0]?.name).toBe('linear');
      expect(linearPlugin?.servers[0]?.disabled).toBe(true);
    } finally {
      await fs.rm(tmpHome, { recursive: true, force: true });
    }
  });
});
