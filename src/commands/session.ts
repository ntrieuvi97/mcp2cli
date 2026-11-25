import { spawn } from 'node:child_process';
import { McpServerConfig } from '../types.js';
import { scanAgentClients } from '../clients/registry.js';
import { OutputOptions, formatOutput, writeStdout } from '../core/output.js';
import { Mcp2CliError, assertSafeIdentifier } from '../core/security.js';
import { getSavedServer } from '../core/server-registry.js';
import {
  listActiveSessions,
  runSessionDaemonLoop,
  sendSessionRpc,
  stopSession,
} from '../core/session-daemon.js';

export interface SessionStartOptions extends OutputOptions {
  server?: string;
  mcp?: string;
  mcpStdio?: string;
  idleTimeout?: number;
  trust?: boolean;
}

async function resolveSessionServer(opts: SessionStartOptions): Promise<McpServerConfig> {
  if (opts.mcp) {
    return {
      name: opts.server ?? 'remote-mcp',
      transport: opts.mcp.endsWith('/sse') ? 'sse' : 'http',
      url: opts.mcp,
      trusted: true,
    };
  }
  if (opts.mcpStdio) {
    const parts = opts.mcpStdio.split(/\s+/).filter(Boolean);
    return {
      name: opts.server ?? 'stdio-mcp',
      transport: 'stdio',
      command: parts[0],
      args: parts.slice(1),
      trusted: true,
    };
  }
  if (opts.server) {
    const saved = await getSavedServer(opts.server);
    if (saved) return saved;
    const discovered = await scanAgentClients({ trust: opts.trust });
    const match = discovered.flatMap((c) => c.servers).find((s) => s.name === opts.server);
    if (match) return match;
  }
  throw new Mcp2CliError({
    kind: 'validation',
    message: 'Provide --server <name>, --mcp <url>, or --mcp-stdio "<cmd>" to start a session.',
    retryable: false,
  });
}

export async function runSessionStart(name: string, opts: SessionStartOptions): Promise<void> {
  assertSafeIdentifier(name, 'session name');
  const server = await resolveSessionServer(opts);
  const idleMs = (opts.idleTimeout ?? 300) * 1000;

  const payload = Buffer.from(
    JSON.stringify({ name, server, idleTimeoutMs: idleMs, trustUntrusted: Boolean(opts.trust) }),
    'utf8'
  ).toString('base64');

  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1]!, 'session', '_serve', payload],
    {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    }
  );
  child.unref();

  // Wait briefly for socket/pipe registration
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      await sendSessionRpc(name, 'ping');
      writeStdout(
        formatOutput({ session: name, server: server.name, status: 'live', changed: true }, opts, () =>
          `Session '${name}' started for ${server.name} (${server.transport}).`
        )
      );
      return;
    } catch {
      // Retry while daemon boots
    }
  }

  throw new Mcp2CliError({
    kind: 'timeout',
    message: `Session daemon '${name}' did not become ready in time.`,
    retryable: true,
  });
}

export async function runSessionList(opts: OutputOptions): Promise<void> {
  const sessions = await listActiveSessions();
  writeStdout(
    formatOutput({ items: sessions }, opts, (bounded) => {
      const data = bounded as { items: typeof sessions };
      if (data.items.length === 0) return 'No active sessions.';
      return data.items
        .map((s) => `• @${s.name} -> ${s.serverName} (${s.transport}, pid=${s.pid}, socket=${s.socketPath})`)
        .join('\n');
    })
  );
}

export async function runSessionStop(name: string, opts: OutputOptions): Promise<void> {
  assertSafeIdentifier(name, 'session name');
  const stopped = await stopSession(name);
  writeStdout(
    formatOutput({ session: name, stopped, changed: stopped }, opts, () =>
      stopped ? `Stopped session '${name}'.` : `Session '${name}' was not running.`
    )
  );
}

export async function runSessionServeInternal(encodedPayload: string): Promise<void> {
  const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf8')) as {
    name: string;
    server: McpServerConfig;
    idleTimeoutMs: number;
    trustUntrusted: boolean;
  };
  await runSessionDaemonLoop(decoded.name, decoded.server, {
    idleTimeoutMs: decoded.idleTimeoutMs,
    trustUntrusted: decoded.trustUntrusted,
  });
}
