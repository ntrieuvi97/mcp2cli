import { McpServerCapabilitiesSnapshot, McpServerConfig, McpToolDefinition } from '../types.js';
import { scanAgentClients } from '../clients/registry.js';
import {
  UsageSortMode,
  buildServerCacheKey,
  getServerUsage,
  readCachedSnapshot,
  recordToolUsage,
  sortToolsByMode,
  writeCachedSnapshot,
} from '../core/cache.js';
import { callMcpTool, introspectMcpServer } from '../core/mcp-client.js';
import { OutputOptions, formatOutput, writeStdout } from '../core/output.js';
import { isStdinTty } from '../core/platform.js';
import { Mcp2CliError, assertNoControlChars } from '../core/security.js';
import { getSavedServer } from '../core/server-registry.js';
import { sendSessionRpc } from '../core/session-daemon.js';
import { isToolDestructive, isToolMutating, toKebabCase } from '../optimizer/analyzer.js';

export interface RunCommandOptions extends OutputOptions {
  list?: boolean;
  search?: string;
  schema?: string;
  compact?: boolean;
  sort?: UsageSortMode;
  top?: number;
  reqJson?: string;
  stdin?: boolean;
  session?: string;
  mcp?: string;
  mcpStdio?: string;
  dryRun?: boolean;
  yes?: boolean;
  refresh?: boolean;
  trust?: boolean;
}

async function readStdinText(): Promise<string> {
  if (isStdinTty()) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function parseDynamicFlags(extraArgs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < extraArgs.length; i++) {
    const token = extraArgs[i]!;
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    let key: string;
    let rawVal: string;
    if (eq !== -1) {
      key = token.slice(2, eq);
      rawVal = token.slice(eq + 1);
    } else {
      key = token.slice(2);
      const next = extraArgs[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        rawVal = next;
        i++;
      } else {
        rawVal = 'true';
      }
    }
    assertNoControlChars(key, 'flag name');
    assertNoControlChars(rawVal, `value for --${key}`);

    // Convert kebab-case flag back to original or camel/snake; resolved later against tool schema
    if (rawVal === 'true') out[key] = true;
    else if (rawVal === 'false') out[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(rawVal)) out[key] = Number(rawVal);
    else if ((rawVal.startsWith('{') && rawVal.endsWith('}')) || (rawVal.startsWith('[') && rawVal.endsWith(']'))) {
      try {
        out[key] = JSON.parse(rawVal);
      } catch {
        out[key] = rawVal;
      }
    } else {
      out[key] = rawVal;
    }
  }
  return out;
}

function mapFlagsToWireArgs(
  rawFlags: Record<string, unknown>,
  tool?: McpToolDefinition
): Record<string, unknown> {
  const props = (tool?.inputSchema?.['properties'] as Record<string, unknown> | undefined) ?? {};
  const kebabToWire = new Map<string, string>();
  for (const wire of Object.keys(props)) {
    kebabToWire.set(toKebabCase(wire), wire);
    kebabToWire.set(wire, wire);
  }
  const mapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawFlags)) {
    const wire = kebabToWire.get(k) ?? kebabToWire.get(toKebabCase(k)) ?? k;
    mapped[wire] = v;
  }
  return mapped;
}

async function resolveTargetServer(
  serverTarget: string | undefined,
  opts: RunCommandOptions
): Promise<McpServerConfig> {
  if (opts.mcp) {
    return {
      name: serverTarget ?? 'remote-mcp',
      transport: opts.mcp.endsWith('/sse') ? 'sse' : 'http',
      url: opts.mcp,
      trusted: true,
    };
  }
  if (opts.mcpStdio) {
    const parts = opts.mcpStdio.split(/\s+/).filter(Boolean);
    return {
      name: serverTarget ?? 'stdio-mcp',
      transport: 'stdio',
      command: parts[0],
      args: parts.slice(1),
      trusted: true,
    };
  }
  if (!serverTarget) {
    throw new Mcp2CliError({
      kind: 'validation',
      message: 'Server name (or --mcp / --mcp-stdio / --session) is required.',
      hint: 'Run `mcp2cli scan` to list available servers.',
      retryable: false,
    });
  }

  const saved = await getSavedServer(serverTarget);
  if (saved) return saved;

  const discovered = await scanAgentClients({ trust: opts.trust });
  const match = discovered.flatMap((c) => c.servers).find((s) => s.name === serverTarget);
  if (match) return match;

  throw new Mcp2CliError({
    kind: 'not_found',
    message: `Server '${serverTarget}' not found in saved bindings or agent client configs.`,
    hint: 'Run `mcp2cli scan` or pass `--mcp <url>` / `--mcp-stdio "<cmd>"`.',
    retryable: false,
  });
}

export async function runRuntimeCommand(
  serverTarget: string | undefined,
  toolArg: string | undefined,
  extraArgs: string[],
  opts: RunCommandOptions
): Promise<void> {
  // Handle warm session route
  if (opts.session && !opts.list && !opts.search && !opts.schema && toolArg) {
    let argsObj: Record<string, unknown> = {};
    if (opts.reqJson) argsObj = JSON.parse(opts.reqJson) as Record<string, unknown>;
    else if (opts.stdin || (!isStdinTty() && extraArgs.length === 0)) {
      const text = await readStdinText();
      if (text) argsObj = JSON.parse(text) as Record<string, unknown>;
    } else {
      argsObj = parseDynamicFlags(extraArgs);
    }

    if (opts.dryRun) {
      writeStdout(
        formatOutput({ dryRun: true, session: opts.session, tool: toolArg, arguments: argsObj }, opts)
      );
      return;
    }

    const result = (await sendSessionRpc(opts.session, 'callTool', {
      name: toolArg,
      arguments: argsObj,
    })) as { content?: unknown[]; structuredContent?: unknown; isError?: boolean };

    if (result.isError) {
      const textMsg = (result.content ?? [])
        .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : JSON.stringify(c)))
        .join(' ');
      throw new Mcp2CliError({
        kind: 'tool_error',
        message: textMsg || `Tool '${toolArg}' returned isError=true.`,
        retryable: false,
        details: { result },
      });
    }

    const payload =
      result.structuredContent !== undefined
        ? result.structuredContent
        : result.content &&
            result.content.length === 1 &&
            result.content[0] &&
            typeof result.content[0] === 'object' &&
            'text' in result.content[0]
          ? (() => {
              const rawText = String((result.content[0] as { text: unknown }).text);
              try {
                return JSON.parse(rawText) as unknown;
              } catch {
                return result;
              }
            })()
          : result;

    writeStdout(formatOutput(payload, opts));
    return;
  }

  const server = await resolveTargetServer(serverTarget, opts);
  const cacheKey = buildServerCacheKey(
    `${server.name}:${server.transport}:${server.url ?? ''}:${server.command ?? ''}:${(server.args ?? []).join(' ')}`
  );

  let snapshot: McpServerCapabilitiesSnapshot | null = null;
  if (!opts.refresh) {
    snapshot = await readCachedSnapshot(cacheKey, 3600);
  }
  if (!snapshot) {
    snapshot = await introspectMcpServer(server, { trustUntrusted: opts.trust });
    await writeCachedSnapshot(cacheKey, snapshot);
  }

  const usage = await getServerUsage(cacheKey);

  // --schema <tool>
  if (opts.schema) {
    const needle = opts.schema.toLowerCase();
    const tool = snapshot.tools.find(
      (t) => t.name.toLowerCase() === needle || toKebabCase(t.name) === needle
    );
    if (!tool) {
      throw new Mcp2CliError({
        kind: 'not_found',
        message: `Tool '${opts.schema}' not found on server '${server.name}'.`,
        hint: `Run 'mcp2cli run ${server.name} --list' to see available tools.`,
        retryable: false,
      });
    }
    writeStdout(formatOutput(tool, { ...opts, format: opts.format === 'auto' ? 'json' : opts.format }));
    return;
  }

  // --list or --search or no toolArg
  if (opts.list || opts.search || !toolArg) {
    let tools = sortToolsByMode(snapshot.tools, usage, opts.sort ?? 'usage');
    if (opts.search) {
      const q = opts.search.toLowerCase();
      tools = tools.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          toKebabCase(t.name).includes(q) ||
          (t.description ?? '').toLowerCase().includes(q)
      );
    }
    if (opts.top && opts.top > 0) {
      tools = tools.slice(0, opts.top);
    }

    if (opts.compact) {
      const names = tools.map((t) => toKebabCase(t.name));
      writeStdout(
        formatOutput(names, opts, () => names.join(' '))
      );
      return;
    }

    const items = tools.map((t) => ({
      name: toKebabCase(t.name),
      wireName: t.name,
      mutating: isToolMutating(t),
      calls: usage[t.name]?.count ?? 0,
      description: (t.description ?? '').replace(/\s+/g, ' ').trim(),
    }));

    writeStdout(
      formatOutput({ server: server.name, items }, opts, (bounded) => {
        const data = bounded as { items: typeof items };
        if (data.items.length === 0) return 'No matching tools found.';
        return data.items
          .map((i) => `• ${i.name}${i.mutating ? '' : ' [ro]'} — ${i.description.slice(0, 90)}`)
          .join('\n');
      })
    );
    return;
  }

  // Execute tool
  const needle = toolArg.toLowerCase();
  const matchedTool = snapshot.tools.find(
    (t) => t.name.toLowerCase() === needle || toKebabCase(t.name) === needle
  );
  if (!matchedTool) {
    const suggestions = snapshot.tools
      .map((t) => toKebabCase(t.name))
      .filter((n) => n.includes(needle) || needle.includes(n))
      .slice(0, 3);
    throw new Mcp2CliError({
      kind: 'not_found',
      message: `Tool '${toolArg}' not found on server '${server.name}'.`,
      hint:
        suggestions.length > 0
          ? `Did you mean: ${suggestions.join(', ')}?`
          : `Run 'mcp2cli run ${server.name} --list' to inspect tools.`,
      retryable: false,
    });
  }

  let toolArgs: Record<string, unknown> = {};
  if (opts.reqJson) {
    toolArgs = JSON.parse(opts.reqJson) as Record<string, unknown>;
  } else if (opts.stdin || (!isStdinTty() && extraArgs.length === 0)) {
    const raw = await readStdinText();
    if (raw) toolArgs = JSON.parse(raw) as Record<string, unknown>;
  }

  const flagArgs = mapFlagsToWireArgs(parseDynamicFlags(extraArgs), matchedTool);
  toolArgs = { ...toolArgs, ...flagArgs };

  if (opts.dryRun) {
    writeStdout(
      formatOutput(
        {
          dryRun: true,
          server: server.name,
          tool: matchedTool.name,
          mutating: isToolMutating(matchedTool),
          destructive: isToolDestructive(matchedTool),
          arguments: toolArgs,
        },
        opts
      )
    );
    return;
  }

  if (isToolDestructive(matchedTool) && !opts.yes && !isStdinTty()) {
    throw new Mcp2CliError({
      kind: 'confirmation_required',
      message: `Tool '${matchedTool.name}' is marked destructive and requires confirmation without a TTY.`,
      hint: 'Preview with --dry-run or re-run with --yes to confirm execution.',
      retryable: false,
    });
  }

  const result = await callMcpTool(server, matchedTool.name, toolArgs, {
    trustUntrusted: opts.trust,
  });
  await recordToolUsage(cacheKey, matchedTool.name).catch(() => undefined);

  if (result.isError) {
    const textMsg = result.content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : JSON.stringify(c)))
      .join(' ');
    throw new Mcp2CliError({
      kind: 'tool_error',
      message: textMsg || `Tool '${matchedTool.name}' returned isError=true.`,
      retryable: false,
      details: { result },
    });
  }

  const payload =
    result.structuredContent !== undefined
      ? result.structuredContent
      : result.content.length === 1 &&
          result.content[0] &&
          typeof result.content[0] === 'object' &&
          'text' in result.content[0]
        ? (() => {
            const rawText = String((result.content[0] as { text: unknown }).text);
            try {
              return JSON.parse(rawText) as unknown;
            } catch {
              return result;
            }
          })()
        : result;

  writeStdout(formatOutput(payload, opts));
}
