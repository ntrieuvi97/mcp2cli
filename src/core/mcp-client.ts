import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import {
  McpPromptDefinition,
  McpResourceDefinition,
  McpServerCapabilitiesSnapshot,
  McpServerConfig,
  McpToolDefinition,
} from '../types.js';
import {
  Mcp2CliError,
  expandEnvPlaceholders,
  findReferencedEnvVars,
  resolveSecretRef,
} from './security.js';

export interface ConnectOptions {
  timeoutMs?: number;
  trustUntrusted?: boolean;
  extraHeaders?: Record<string, string>;
  extraEnv?: Record<string, string>;
}

async function resolveServerConfigForExecution(
  server: McpServerConfig,
  opts: ConnectOptions
): Promise<McpServerConfig> {
  const referenced = server.referencedEnvVars ?? findReferencedEnvVars(server);
  if (server.scope === 'project' && !server.trusted && !opts.trustUntrusted && referenced.length > 0) {
    throw new Mcp2CliError({
      kind: 'untrusted_config',
      message: `Refusing to auto-expand environment variables (${referenced.join(', ')}) from untrusted project config '${server.configPath ?? server.name}'.`,
      hint: 'Review the config file and pass --trust to allow connecting with environment variables.',
      retryable: false,
      details: { server: server.name, referencedEnvVars: referenced },
    });
  }

  const resolveStr = async (raw: string): Promise<string> => {
    const withSecrets = await resolveSecretRef(raw);
    const { value } = expandEnvPlaceholders(withSecrets);
    return value;
  };

  const resolvedEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...(server.env ?? {}), ...(opts.extraEnv ?? {}) })) {
    resolvedEnv[k] = await resolveStr(v);
  }

  const resolvedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...(server.headers ?? {}), ...(opts.extraHeaders ?? {}) })) {
    resolvedHeaders[k] = await resolveStr(v);
  }

  return {
    ...server,
    command: server.command ? await resolveStr(server.command) : undefined,
    args: server.args ? await Promise.all(server.args.map(resolveStr)) : undefined,
    url: server.url ? await resolveStr(server.url) : undefined,
    env: resolvedEnv,
    headers: resolvedHeaders,
  };
}

export interface ConnectedMcpSession {
  client: Client;
  close: () => Promise<void>;
}

export async function connectToMcpServer(
  rawServer: McpServerConfig,
  opts: ConnectOptions = {}
): Promise<ConnectedMcpSession> {
  const server = await resolveServerConfigForExecution(rawServer, opts);
  const client = new Client(
    { name: 'mcp2cli', version: '0.1.0' },
    {
      enforceStrictCapabilities: false,
    }
  );

  if (server.transport === 'stdio') {
    if (!server.command) {
      throw new Mcp2CliError({
        kind: 'validation',
        message: `MCP server '${server.name}' uses stdio transport but has no 'command'.`,
        retryable: false,
      });
    }

    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      env: {
        ...getDefaultEnvironment(),
        ...(server.env ?? {}),
      },
      cwd: server.cwd,
      stderr: 'pipe',
    });

    try {
      await client.connect(transport, { timeout: opts.timeoutMs ?? 30_000 });
    } catch (err) {
      await transport.close().catch(() => undefined);
      throw new Mcp2CliError({
        kind: 'transport',
        message: `Failed to connect to stdio MCP server '${server.name}': ${err instanceof Error ? err.message : String(err)}`,
        hint: 'Verify the command exists on PATH and starts cleanly.',
        retryable: true,
      });
    }

    return {
      client,
      close: async () => {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
      },
    };
  }

  // HTTP / Streamable HTTP with optional SSE fallback
  if (!server.url) {
    throw new Mcp2CliError({
      kind: 'validation',
      message: `MCP server '${server.name}' uses ${server.transport} transport but has no 'url'.`,
      retryable: false,
    });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(server.url);
  } catch {
    throw new Mcp2CliError({
      kind: 'validation',
      message: `Invalid MCP server URL for '${server.name}': ${server.url}`,
      retryable: false,
    });
  }

  const requestInit: RequestInit =
    server.headers && Object.keys(server.headers).length > 0
      ? { headers: server.headers }
      : {};

  if (server.transport === 'sse') {
    const sse = new SSEClientTransport(targetUrl, { requestInit });
    await client.connect(sse, { timeout: opts.timeoutMs ?? 30_000 });
    return {
      client,
      close: async () => {
        await client.close().catch(() => undefined);
        await sse.close().catch(() => undefined);
      },
    };
  }

  // Try Streamable HTTP first; fall back to SSE if server does not support Streamable HTTP
  const streamable = new StreamableHTTPClientTransport(targetUrl, { requestInit });
  try {
    await client.connect(streamable, { timeout: opts.timeoutMs ?? 30_000 });
    return {
      client,
      close: async () => {
        await client.close().catch(() => undefined);
        await streamable.close().catch(() => undefined);
      },
    };
  } catch (streamErr) {
    await streamable.close().catch(() => undefined);
    const fallbackClient = new Client(
      { name: 'mcp2cli', version: '0.1.0' },
      { enforceStrictCapabilities: false }
    );
    const sse = new SSEClientTransport(targetUrl, { requestInit });
    try {
      await fallbackClient.connect(sse, { timeout: opts.timeoutMs ?? 30_000 });
      return {
        client: fallbackClient,
        close: async () => {
          await fallbackClient.close().catch(() => undefined);
          await sse.close().catch(() => undefined);
        },
      };
    } catch {
      await sse.close().catch(() => undefined);
      const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
      const needsOAuth = /401|unauthorized|invalid_token|oauth/i.test(errMsg);
      throw new Mcp2CliError({
        kind: needsOAuth ? 'auth' : 'transport',
        message: `Failed to connect to MCP server '${server.name}' (${server.url}): ${errMsg}`,
        hint: needsOAuth
          ? `Server requires OAuth or auth headers. Add headers or bridge via \`npx -y mcp-remote ${server.url}\` (--mcp-stdio).`
          : 'Check the URL, network access, and authentication headers.',
        retryable: !needsOAuth,
      });
    }
  }
}

export async function introspectMcpServer(
  server: McpServerConfig,
  opts: ConnectOptions = {}
): Promise<McpServerCapabilitiesSnapshot> {
  const session = await connectToMcpServer(server, opts);
  try {
    const caps = session.client.getServerCapabilities();
    const serverInfo = session.client.getServerVersion();
    const protocolVersion = session.client.getNegotiatedProtocolVersion();
    const instructions = session.client.getInstructions();

    let tools: McpToolDefinition[] = [];
    if (!caps || caps.tools) {
      try {
        const res = await session.client.listTools(undefined, { timeout: opts.timeoutMs ?? 30_000 });
        tools = (res.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown> | undefined,
          outputSchema: t.outputSchema as Record<string, unknown> | undefined,
          annotations: t.annotations as McpToolDefinition['annotations'],
        }));
      } catch {
        tools = [];
      }
    }

    let resources: McpResourceDefinition[] = [];
    if (caps?.resources) {
      try {
        const res = await session.client.listResources(undefined, { timeout: opts.timeoutMs ?? 30_000 });
        resources = (res.resources ?? []).map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }));
      } catch {
        resources = [];
      }
    }

    let prompts: McpPromptDefinition[] = [];
    if (caps?.prompts) {
      try {
        const res = await session.client.listPrompts(undefined, { timeout: opts.timeoutMs ?? 30_000 });
        prompts = (res.prompts ?? []).map((p) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments,
        }));
      } catch {
        prompts = [];
      }
    }

    return {
      serverName: server.name,
      serverInfo: serverInfo ? { name: serverInfo.name, version: serverInfo.version } : undefined,
      protocolVersion,
      instructions,
      tools,
      resources,
      prompts,
      fetchedAt: new Date().toISOString(),
      transport: server.transport,
    };
  } finally {
    await session.close();
  }
}

export async function callMcpTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  opts: ConnectOptions = {}
): Promise<{ content: unknown[]; structuredContent?: unknown; isError: boolean }> {
  const session = await connectToMcpServer(server, opts);
  try {
    const result = await session.client.callTool(
      { name: toolName, arguments: args },
      { timeout: opts.timeoutMs ?? 60_000 }
    );
    return {
      content: (result.content as unknown[]) ?? [],
      ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
      isError: Boolean(result.isError),
    };
  } finally {
    await session.close();
  }
}
