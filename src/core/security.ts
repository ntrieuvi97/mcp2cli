import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServerConfig } from '../types.js';

export class Mcp2CliError extends Error {
  readonly kind:
    | 'validation'
    | 'auth'
    | 'not_found'
    | 'conflict'
    | 'confirmation_required'
    | 'untrusted_config'
    | 'transport'
    | 'timeout'
    | 'tool_error'
    | 'internal';
  readonly exitCode: number;
  readonly hint?: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(opts: {
    kind: Mcp2CliError['kind'];
    message: string;
    hint?: string;
    retryable?: boolean;
    exitCode?: number;
    details?: Record<string, unknown>;
  }) {
    super(opts.message);
    this.name = 'Mcp2CliError';
    this.kind = opts.kind;
    this.hint = opts.hint;
    this.retryable = opts.retryable ?? (opts.kind === 'timeout' || opts.kind === 'transport');
    this.exitCode = opts.exitCode ?? ERROR_EXIT_CODES[opts.kind] ?? 1;
    this.details = opts.details;
  }
}

export const ERROR_EXIT_CODES: Record<Mcp2CliError['kind'], number> = {
  validation: 2,
  confirmation_required: 2,
  auth: 3,
  not_found: 4,
  timeout: 5,
  conflict: 6,
  untrusted_config: 7,
  transport: 8,
  tool_error: 9,
  internal: 1,
};

/**
 * Reject ASCII control characters (including NUL, CR, LF) that LLMs often hallucinate.
 */
export function assertNoControlChars(value: string, label = 'input'): string {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Mcp2CliError({
      kind: 'validation',
      message: `Invalid ${label}: contains disallowed control characters.`,
      hint: 'Remove newline, carriage-return, tab, or null characters from the value.',
      retryable: false,
    });
  }
  return value;
}

/**
 * Validate safe identifier / skill / server name (prevents path traversal & shell meta).
 */
export function assertSafeIdentifier(value: string, label = 'name'): string {
  assertNoControlChars(value, label);
  if (!value || value.length > 128) {
    throw new Mcp2CliError({
      kind: 'validation',
      message: `Invalid ${label}: must be 1..128 characters.`,
      retryable: false,
    });
  }
  if (value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Mcp2CliError({
      kind: 'validation',
      message: `Invalid ${label}: path separators and '..' traversal are not allowed.`,
      retryable: false,
    });
  }
  return value;
}

/**
 * Sanitize an arbitrary MCP server name into an Agent Skills compliant kebab-case name.
 * Spec (agentskills.io): 1-64 chars, lowercase [a-z0-9-], no leading/trailing/double hyphens.
 */
export function toSkillName(rawName: string): string {
  const cleaned = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return cleaned || 'mcp-server';
}

/**
 * Validate a target path stays inside an allowed base directory (prevents path traversal).
 */
export function assertPathInside(baseDir: string, candidatePath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(baseDir, candidatePath);
  const rel = path.relative(resolvedBase, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Mcp2CliError({
      kind: 'validation',
      message: `Refusing path outside target directory: ${candidatePath}`,
      retryable: false,
    });
  }
  return resolvedTarget;
}

/**
 * Resolve `env:VAR_NAME` and `file:/path/to/secret` (including `Bearer env:VAR`)
 * so secrets never sit in argv.
 */
export async function resolveSecretRef(rawValue: string): Promise<string> {
  const bearerPrefix = /^Bearer\s+(env:|file:)(.+)$/i.exec(rawValue);
  if (bearerPrefix) {
    const resolved = await resolveSecretRef(`${bearerPrefix[1]}${bearerPrefix[2]}`);
    return `Bearer ${resolved}`;
  }

  if (rawValue.startsWith('env:')) {
    const varName = rawValue.slice(4).trim();
    assertNoControlChars(varName, 'environment variable name');
    const resolved = process.env[varName];
    if (resolved === undefined) {
      throw new Mcp2CliError({
        kind: 'auth',
        message: `Environment variable '${varName}' referenced by secret is not set.`,
        hint: `Export ${varName} in your environment or store it in the mcp2cli vault.`,
        retryable: false,
      });
    }
    return resolved;
  }

  if (rawValue.startsWith('file:')) {
    const filePath = rawValue.slice(5).trim();
    assertNoControlChars(filePath, 'secret file path');
    const content = await fs.readFile(path.resolve(filePath), 'utf8');
    return content.replace(/\r?\n$/, '');
  }

  return rawValue;
}

/**
 * Expand `${VAR}` or `${VAR:-fallback}` placeholders in config strings.
 * Only called after trust verification.
 */
export function expandEnvPlaceholders(
  input: string,
  envSource: NodeJS.ProcessEnv = process.env
): { value: string; missingVars: string[] } {
  const missingVars: string[] = [];
  const value = input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_match, name: string, fallback?: string) => {
    const found = envSource[name];
    if (found !== undefined && found !== '') return found;
    if (fallback !== undefined) return fallback;
    missingVars.push(name);
    return '';
  });
  return { value, missingVars };
}

/**
 * Scan any string/object in an MCP server config for `${VAR}` references.
 */
export function findReferencedEnvVars(server: Pick<McpServerConfig, 'command' | 'args' | 'env' | 'url' | 'headers'>): string[] {
  const vars = new Set<string>();
  const scanStr = (s?: string) => {
    if (!s) return;
    const re = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      if (m[1]) vars.add(m[1]);
    }
  };
  scanStr(server.command);
  scanStr(server.url);
  for (const a of server.args ?? []) scanStr(a);
  for (const v of Object.values(server.env ?? {})) scanStr(v);
  for (const v of Object.values(server.headers ?? {})) scanStr(v);
  return [...vars];
}

const SECRET_KEY_RE = /(token|secret|password|passwd|api[-_]?key|auth|bearer|credential|private[-_]?key)/i;

/**
 * Redact sensitive header/env values for safe display, audit logs, and generated docs.
 */
export function redactServerSecrets(server: McpServerConfig): McpServerConfig {
  const maskValue = (key: string, val: string): string => {
    if (val.startsWith('env:') || val.startsWith('file:') || /\$\{[A-Za-z0-9_]+/.test(val)) {
      return val; // Keep symbolic references inspectable
    }
    if (SECRET_KEY_RE.test(key) || /^Bearer\s+/i.test(val) || /^sk[-_]/i.test(val) || /^ghp_/i.test(val)) {
      return '***REDACTED***';
    }
    return val;
  };

  const maskedEnv = server.env
    ? Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k, maskValue(k, v)]))
    : undefined;

  const maskedHeaders = server.headers
    ? Object.fromEntries(Object.entries(server.headers).map(([k, v]) => [k, maskValue(k, v)]))
    : undefined;

  return {
    ...server,
    env: maskedEnv,
    headers: maskedHeaders,
  };
}
