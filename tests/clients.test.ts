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
});
