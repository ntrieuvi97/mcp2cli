import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve('dist/cli.js');
const MOCK_SERVER_PATH = path.resolve('tests/fixtures/mock-mcp-server.mjs');

async function runCli(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const res = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      encoding: 'utf8',
    });
    return { code: 0, stdout: res.stdout, stderr: res.stderr };
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

describe('E2E: MCP -> CLI + Scripts + Skills + Migration against real stdio MCP server', () => {
  it('supports offline clispec v0.2 schema command and subtree filtering', async () => {
    const res = await runCli(['schema', 'audit']);
    expect(res.code).toBe(0);
    const doc = JSON.parse(res.stdout);
    expect(doc.clispec).toBe('0.2');
    expect(doc.command_layout).toBe('flat');
    expect(doc.commands).toHaveLength(1);
    expect(doc.commands[0].name).toBe('audit');
  });

  it('scans, audits, converts, runs with TOON & --dry-run, migrates, and restores', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp2cli-e2e-'));
    const env = {
      MCP2CLI_CONFIG_DIR: path.join(tmpDir, 'cfg'),
      MCP2CLI_CACHE_DIR: path.join(tmpDir, 'cache'),
    };

    try {
      // Create a project Cursor MCP config pointing to our mock stdio MCP server
      const cursorDir = path.join(tmpDir, '.cursor');
      await fs.mkdir(cursorDir, { recursive: true });
      const mcpConfigPath = path.join(cursorDir, 'mcp.json');
      await fs.writeFile(
        mcpConfigPath,
        JSON.stringify(
          {
            mcpServers: {
              'mock-tracker': {
                command: process.execPath,
                args: [MOCK_SERVER_PATH],
              },
            },
          },
          null,
          2
        ),
        'utf8'
      );

      // 1. Scan
      const scanRes = await runCli(['-o', 'json', 'scan', '--config', mcpConfigPath], { cwd: tmpDir, env });
      expect(scanRes.code).toBe(0);
      const scanJson = JSON.parse(scanRes.stdout);
      expect(scanJson.totalServers).toBe(1);
      expect(scanJson.items[0].servers[0].name).toBe('mock-tracker');

      // 2. Audit
      const auditRes = await runCli(['-o', 'json', 'audit', '--config', mcpConfigPath], { cwd: tmpDir, env });
      expect(auditRes.code).toBe(0);
      const auditJson = JSON.parse(auditRes.stdout);
      expect(auditJson.auditedServers).toBe(1);
      expect(auditJson.servers[0].toolCount).toBe(3);
      expect(auditJson.servers[0].savingsPercent).toBeGreaterThan(50);

      // 3. Convert -> Skill + scripts (.sh, .ps1, .py, .mjs) + SDK (.ts, .py) + shims
      const skillsOut = path.join(tmpDir, 'out-skills');
      const convRes = await runCli(
        ['-o', 'json', 'convert', '--config', mcpConfigPath, '--out', skillsOut],
        { cwd: tmpDir, env }
      );
      expect(convRes.code).toBe(0);
      const convJson = JSON.parse(convRes.stdout);
      const converted = convJson.items[0];
      expect(converted.skillName).toBe('mock-tracker');
      expect(converted.toolCount).toBe(3);

      const skillMd = await fs.readFile(path.join(skillsOut, 'mock-tracker', 'SKILL.md'), 'utf8');
      expect(skillMd).toContain('name: mock-tracker');
      expect(skillMd).toContain('search-issues');

      const refMd = await fs.readFile(path.join(skillsOut, 'mock-tracker', 'references', 'REFERENCE.md'), 'utf8');
      expect(refMd).toContain('delete_issue');

      const ps1 = await fs.readFile(path.join(skillsOut, 'mock-tracker', 'scripts', 'call.ps1'), 'utf8');
      expect(ps1).toContain('mcp2cli run "mock-tracker"');

      const tsSdk = await fs.readFile(path.join(skillsOut, 'mock-tracker', 'sdk', 'ts', 'index.ts'), 'utf8');
      expect(tsSdk).toContain('export function searchIssues');

      // 4. Runtime `run` (--list, --output toon, --fields, --dry-run, non-TTY refusal)
      const listCompact = await runCli(['run', 'mock-tracker', '--list', '--compact'], { cwd: tmpDir, env });
      expect(listCompact.code).toBe(0);
      expect(listCompact.stdout.trim()).toContain('search-issues');

      const callToon = await runCli(
        ['run', 'mock-tracker', 'search-issues', '--query', 'latency', '--fields', 'id,title', '--output', 'toon'],
        { cwd: tmpDir, env }
      );
      expect(callToon.code).toBe(0);
      expect(callToon.stdout).toContain('ISS-1');
      expect(callToon.stdout).not.toContain('priority');

      const dryRunRes = await runCli(
        ['-o', 'json', 'run', 'mock-tracker', 'delete-issue', '--issue-id', 'ISS-1', '--dry-run'],
        { cwd: tmpDir, env }
      );
      expect(dryRunRes.code).toBe(0);
      expect(JSON.parse(dryRunRes.stdout).dryRun).toBe(true);

      // Non-TTY destructive call without --yes must fail safe with confirmation_required
      const blockedRes = await runCli(
        ['run', 'mock-tracker', 'delete-issue', '--issue-id', 'ISS-1'],
        { cwd: tmpDir, env }
      );
      expect(blockedRes.code).toBe(2);
      const errLines = blockedRes.stderr.trim().split('\n');
      const errEnv = JSON.parse(errLines[errLines.length - 1]!);
      expect(errEnv.error.kind).toBe('confirmation_required');

      // 5. Migrate (refuses without --yes, succeeds with --yes, parks config, then restores)
      const migrateRefused = await runCli(['migrate', '--config', mcpConfigPath], { cwd: tmpDir, env });
      expect(migrateRefused.code).toBe(2);

      const installedSkillsDir = path.join(tmpDir, 'client-skills');
      const migrateOk = await runCli(
        ['-o', 'json', 'migrate', '--config', mcpConfigPath, '--skills-dir', installedSkillsDir, '--yes'],
        { cwd: tmpDir, env }
      );
      expect(migrateOk.code).toBe(0);
      const parkedConfig = JSON.parse(await fs.readFile(mcpConfigPath, 'utf8'));
      expect(parkedConfig.mcpServers).toEqual({});
      expect(parkedConfig._mcp2cliParked).toHaveProperty('mock-tracker');
      expect(
        await fs.readFile(path.join(installedSkillsDir, 'mock-tracker', 'SKILL.md'), 'utf8')
      ).toContain('mock-tracker');

      const restoreRes = await runCli(['-o', 'json', 'restore', '--config', mcpConfigPath, '--yes'], {
        cwd: tmpDir,
        env,
      });
      expect(restoreRes.code).toBe(0);
      const restoredConfig = JSON.parse(await fs.readFile(mcpConfigPath, 'utf8'));
      expect(restoredConfig.mcpServers).toHaveProperty('mock-tracker');

      // 6. Warm session lifecycle (start -> list -> run --session -> stop)
      const sessStart = await runCli(
        ['-o', 'json', 'session', 'start', 'work', '--mcp-stdio', `${process.execPath} ${MOCK_SERVER_PATH}`],
        { cwd: tmpDir, env }
      );
      expect(sessStart.code).toBe(0);
      expect(JSON.parse(sessStart.stdout).status).toBe('live');

      const sessCall = await runCli(
        ['-o', 'json', 'run', 'mock-tracker', 'search_issues', '--session', 'work', '--req-json', '{"query":"session"}'],
        { cwd: tmpDir, env }
      );
      expect(sessCall.code).toBe(0);
      expect(sessCall.stdout).toContain('ISS-1');

      const sessStop = await runCli(['-o', 'json', 'session', 'stop', 'work'], { cwd: tmpDir, env });
      expect(sessStop.code).toBe(0);
      expect(JSON.parse(sessStop.stdout).stopped).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
