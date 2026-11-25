import { McpServerConfig, McpToolDefinition, NativeCliRecommendation } from '../types.js';

export interface ParsedParam {
  wireName: string;
  flagName: string;
  type: string;
  required: boolean;
  defaultValue?: unknown;
  enumValues?: unknown[];
  description?: string;
}

export function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function toCamelCase(name: string): string {
  return toKebabCase(name).replace(/-([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

export function matchGlob(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

export function filterTools(
  tools: McpToolDefinition[],
  opts: {
    includePatterns?: string[];
    excludePatterns?: string[];
    readOnlyOnly?: boolean;
    topTools?: number;
  } = {}
): McpToolDefinition[] {
  let out = [...tools];

  if (opts.includePatterns && opts.includePatterns.length > 0) {
    out = out.filter((t) =>
      opts.includePatterns!.some((p) => matchGlob(p, t.name) || matchGlob(p, toKebabCase(t.name)))
    );
  }

  if (opts.excludePatterns && opts.excludePatterns.length > 0) {
    out = out.filter(
      (t) => !opts.excludePatterns!.some((p) => matchGlob(p, t.name) || matchGlob(p, toKebabCase(t.name)))
    );
  }

  if (opts.readOnlyOnly) {
    out = out.filter((t) => !isToolMutating(t));
  }

  if (opts.topTools !== undefined && opts.topTools > 0) {
    out = out.slice(0, opts.topTools);
  }

  return out;
}

const READ_ONLY_PREFIX_RE = /^(get|list|read|search|find|query|fetch|inspect|show|describe|check|ping|status|lookup|count|view)[_-]/i;
const DESTRUCTIVE_PREFIX_RE = /^(delete|remove|destroy|drop|purge|truncate|kill|terminate|revoke|reset|wipe)[_-]/i;

export function isToolMutating(tool: McpToolDefinition): boolean {
  if (tool.annotations?.readOnlyHint === true) return false;
  if (tool.annotations?.destructiveHint === true) return true;
  if (READ_ONLY_PREFIX_RE.test(tool.name)) return false;
  return true;
}

export function isToolDestructive(tool: McpToolDefinition): boolean {
  if (tool.annotations?.destructiveHint === true) return true;
  return DESTRUCTIVE_PREFIX_RE.test(tool.name);
}

export function extractToolParams(tool: McpToolDefinition): ParsedParam[] {
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== 'object') return [];
  const props = (schema['properties'] as Record<string, Record<string, unknown>> | undefined) ?? {};
  const requiredSet = new Set(
    Array.isArray(schema['required']) ? schema['required'].map(String) : []
  );

  return Object.entries(props).map(([wireName, def]) => {
    const rawType = Array.isArray(def?.['type'])
      ? (def['type'] as string[]).join(' | ')
      : typeof def?.['type'] === 'string'
        ? def['type']
        : 'string';

    return {
      wireName,
      flagName: toKebabCase(wireName),
      type: rawType,
      required: requiredSet.has(wireName),
      ...(def?.['default'] !== undefined ? { defaultValue: def['default'] } : {}),
      ...(Array.isArray(def?.['enum']) ? { enumValues: def['enum'] as unknown[] } : {}),
      ...(typeof def?.['description'] === 'string' ? { description: def['description'] } : {}),
    };
  });
}

const NATIVE_CLI_CATALOG: Array<{
  match: RegExp;
  rec: NativeCliRecommendation;
}> = [
  {
    match: /github/i,
    rec: {
      cli: 'gh',
      packageHint: '@modelcontextprotocol/server-github',
      reason: 'GitHub CLI (gh) is pretrained in frontier LLMs and avoids ~17k–55k tokens of MCP schemas.',
      installCommand: 'brew install gh  # or winget install GitHub.cli',
    },
  },
  {
    match: /gitlab/i,
    rec: {
      cli: 'glab',
      packageHint: 'gitlab-mcp',
      reason: 'GitLab CLI (glab) provides native structured JSON output without MCP schema bloat.',
      installCommand: 'brew install glab',
    },
  },
  {
    match: /playwright/i,
    rec: {
      cli: 'playwright-cli',
      packageHint: '@playwright/mcp',
      reason: 'Playwright CLI + Skill cuts browser-automation token overhead dramatically.',
      installCommand: 'npm install -g @playwright/cli',
    },
  },
  {
    match: /kubernetes|kubectl|k8s/i,
    rec: {
      cli: 'kubectl',
      packageHint: 'mcp-server-kubernetes',
      reason: 'kubectl -o json is natively understood by all coding agents with zero schema injection.',
      installCommand: 'brew install kubectl',
    },
  },
  {
    match: /\baws\b|aws-api/i,
    rec: {
      cli: 'aws',
      packageHint: 'aws-mcp',
      reason: 'AWS CLI v2 with --output json and JMESPath --query bounds responses cleanly.',
      installCommand: 'brew install awscli',
    },
  },
  {
    match: /docker/i,
    rec: {
      cli: 'docker',
      packageHint: 'mcp-server-docker',
      reason: 'Docker CLI (--format json) works locally with minimal token overhead.',
      installCommand: 'https://docs.docker.com/get-docker/',
    },
  },
  {
    match: /stripe/i,
    rec: {
      cli: 'stripe',
      packageHint: '@stripe/mcp',
      reason: 'Stripe CLI supports direct API calls and webhooks locally.',
      installCommand: 'brew install stripe/stripe-cli/stripe',
    },
  },
  {
    match: /supabase/i,
    rec: {
      cli: 'supabase',
      packageHint: '@supabase/mcp-server-supabase',
      reason: 'Supabase CLI handles DB, migrations, and Edge Functions with zero MCP schema tax.',
      installCommand: 'brew install supabase/tap/supabase',
    },
  },
];

export function detectNativeCliAlternative(server: McpServerConfig): NativeCliRecommendation | undefined {
  const haystack = [server.name, server.command ?? '', ...(server.args ?? []), server.url ?? ''].join(' ');
  for (const entry of NATIVE_CLI_CATALOG) {
    if (entry.match.test(haystack)) return entry.rec;
  }
  return undefined;
}
