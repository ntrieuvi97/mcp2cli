import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { McpServerConfig } from '../types.js';
import { connectToMcpServer } from './mcp-client.js';
import {
  atomicWriteFile,
  ensurePrivateDir,
  fileExists,
  getCacheDir,
  getSocketPath,
  isWindows,
} from './platform.js';
import { Mcp2CliError } from './security.js';

export interface SessionRecord {
  name: string;
  pid: number;
  socketPath: string;
  token: string;
  serverName: string;
  transport: McpServerConfig['transport'];
  startedAt: string;
  idleTimeoutMs: number;
}

interface DaemonRpcRequest {
  token: string;
  method: 'ping' | 'listTools' | 'callTool' | 'stop';
  params?: Record<string, unknown>;
}

interface DaemonRpcResponse {
  ok: boolean;
  result?: unknown;
  error?: { kind: string; message: string };
}

function getSessionsRegistryPath(): string {
  return path.join(getCacheDir(), 'sessions', 'registry.json');
}

async function readSessionsRegistry(): Promise<Record<string, SessionRecord>> {
  const regPath = getSessionsRegistryPath();
  if (!(await fileExists(regPath))) return {};
  try {
    return JSON.parse(await fs.readFile(regPath, 'utf8')) as Record<string, SessionRecord>;
  } catch {
    return {};
  }
}

async function writeSessionsRegistry(reg: Record<string, SessionRecord>): Promise<void> {
  const regPath = getSessionsRegistryPath();
  await ensurePrivateDir(path.dirname(regPath));
  await atomicWriteFile(regPath, JSON.stringify(reg, null, 2), 0o600);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function listActiveSessions(): Promise<SessionRecord[]> {
  const reg = await readSessionsRegistry();
  const active: SessionRecord[] = [];
  let dirty = false;

  for (const [name, rec] of Object.entries(reg)) {
    if (isProcessAlive(rec.pid)) {
      active.push(rec);
    } else {
      delete reg[name];
      dirty = true;
    }
  }

  if (dirty) {
    await writeSessionsRegistry(reg);
  }
  return active;
}

export async function sendSessionRpc(
  sessionName: string,
  method: DaemonRpcRequest['method'],
  params?: Record<string, unknown>
): Promise<unknown> {
  const reg = await readSessionsRegistry();
  const rec = reg[sessionName];
  if (!rec) {
    throw new Mcp2CliError({
      kind: 'not_found',
      message: `Session '${sessionName}' does not exist.`,
      hint: `Start one with: mcp2cli session start ${sessionName} ...`,
      retryable: false,
    });
  }

  return new Promise((resolve, reject) => {
    const client = net.createConnection(rec.socketPath);
    let buffer = '';
    const timer = setTimeout(() => {
      client.destroy();
      reject(
        new Mcp2CliError({
          kind: 'timeout',
          message: `Session '${sessionName}' did not respond in time.`,
          retryable: true,
        })
      );
    }, 60_000);

    client.on('connect', () => {
      const req: DaemonRpcRequest = { token: rec.token, method, params };
      client.write(`${JSON.stringify(req)}\n`);
    });

    client.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl !== -1) {
        clearTimeout(timer);
        const line = buffer.slice(0, nl);
        client.end();
        try {
          const resp = JSON.parse(line) as DaemonRpcResponse;
          if (!resp.ok) {
            reject(
              new Mcp2CliError({
                kind: 'transport',
                message: resp.error?.message ?? 'Session error',
                retryable: false,
              })
            );
          } else {
            resolve(resp.result);
          }
        } catch (err) {
          reject(err);
        }
      }
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      reject(
        new Mcp2CliError({
          kind: 'transport',
          message: `Could not reach session '${sessionName}': ${err.message}`,
          hint: `Restart the session or run without --session.`,
          retryable: true,
        })
      );
    });
  });
}

export async function stopSession(sessionName: string): Promise<boolean> {
  const reg = await readSessionsRegistry();
  const rec = reg[sessionName];
  if (!rec) return false;
  try {
    await sendSessionRpc(sessionName, 'stop');
  } catch {
    if (isProcessAlive(rec.pid)) {
      try {
        process.kill(rec.pid, 'SIGTERM');
      } catch {
        // Ignore
      }
    }
  }
  delete reg[sessionName];
  await writeSessionsRegistry(reg);
  if (!isWindows()) {
    await fs.unlink(rec.socketPath).catch(() => undefined);
  }
  return true;
}

/**
 * Run an in-process or daemonized bridge server holding one warm MCP connection.
 * Used by `mcp2cli session serve` (spawned detached by `session start`).
 */
export async function runSessionDaemonLoop(
  sessionName: string,
  serverConfig: McpServerConfig,
  opts: { idleTimeoutMs?: number; trustUntrusted?: boolean } = {}
): Promise<void> {
  const idleTimeoutMs = opts.idleTimeoutMs ?? 300_000;
  const socketPath = getSocketPath(sessionName);
  const token = crypto.randomBytes(24).toString('hex');

  if (!isWindows()) {
    await ensurePrivateDir(path.dirname(socketPath));
    await fs.unlink(socketPath).catch(() => undefined);
  }

  const mcpSession = await connectToMcpServer(serverConfig, {
    trustUntrusted: opts.trustUntrusted,
  });

  let idleTimer: NodeJS.Timeout | undefined;
  const resetIdle = (server: net.Server) => {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleTimeoutMs > 0) {
      idleTimer = setTimeout(() => {
        void shutdown(server);
      }, idleTimeoutMs);
    }
  };

  const shutdown = async (server: net.Server) => {
    if (idleTimer) clearTimeout(idleTimer);
    server.close();
    await mcpSession.close();
    const reg = await readSessionsRegistry();
    delete reg[sessionName];
    await writeSessionsRegistry(reg);
    if (!isWindows()) {
      await fs.unlink(socketPath).catch(() => undefined);
    }
    process.exit(0);
  };

  const server = net.createServer((conn) => {
    resetIdle(server);
    let buf = '';
    conn.on('data', async (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);

      let resp: DaemonRpcResponse;
      try {
        const req = JSON.parse(line) as DaemonRpcRequest;
        if (req.token !== token) {
          resp = { ok: false, error: { kind: 'auth', message: 'Invalid session token' } };
          conn.write(`${JSON.stringify(resp)}\n`);
          return;
        }

        if (req.method === 'ping') {
          resp = { ok: true, result: { alive: true, serverName: serverConfig.name } };
        } else if (req.method === 'listTools') {
          const list = await mcpSession.client.listTools();
          resp = { ok: true, result: list.tools };
        } else if (req.method === 'callTool') {
          const name = String(req.params?.['name'] ?? '');
          const args = (req.params?.['arguments'] as Record<string, unknown>) ?? {};
          const result = await mcpSession.client.callTool({ name, arguments: args });
          resp = { ok: true, result };
        } else if (req.method === 'stop') {
          resp = { ok: true, result: { stopped: true } };
          conn.write(`${JSON.stringify(resp)}\n`);
          conn.end();
          await shutdown(server);
          return;
        } else {
          resp = { ok: false, error: { kind: 'validation', message: `Unknown method: ${req.method}` } };
        }
      } catch (err) {
        resp = {
          ok: false,
          error: { kind: 'internal', message: err instanceof Error ? err.message : String(err) },
        };
      }
      conn.write(`${JSON.stringify(resp)}\n`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  if (!isWindows()) {
    await fs.chmod(socketPath, 0o600).catch(() => undefined);
  }

  const reg = await readSessionsRegistry();
  reg[sessionName] = {
    name: sessionName,
    pid: process.pid,
    socketPath,
    token,
    serverName: serverConfig.name,
    transport: serverConfig.transport,
    startedAt: new Date().toISOString(),
    idleTimeoutMs,
  };
  await writeSessionsRegistry(reg);
  resetIdle(server);
}
