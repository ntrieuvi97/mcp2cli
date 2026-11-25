import { encode as encodeToon } from '@toon-format/toon';
import { CliErrorEnvelope, OutputFormat } from '../types.js';
import { isColorEnabled, isStdoutTty } from './platform.js';
import { Mcp2CliError } from './security.js';

export interface OutputOptions {
  format?: OutputFormat;
  pretty?: boolean;
  fields?: string[];
  limit?: number;
  offset?: number;
  head?: number;
}

export function resolveOutputFormat(requested: OutputFormat = 'auto'): Exclude<OutputFormat, 'auto'> {
  if (requested !== 'auto') return requested;
  return isStdoutTty() ? 'text' : 'json';
}

/**
 * Project specific fields from objects or arrays (`--fields name,status`).
 */
export function applyFieldMask(data: unknown, fields?: string[]): unknown {
  if (!fields || fields.length === 0) return data;
  const pickObj = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (f in obj) out[f] = obj[f];
    }
    return out;
  };

  if (Array.isArray(data)) {
    return data.map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? pickObj(item as Record<string, unknown>) : item));
  }
  if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>;
    if (Array.isArray(rec['items'])) {
      return { ...rec, items: applyFieldMask(rec['items'], fields) };
    }
    return pickObj(rec);
  }
  return data;
}

/**
 * Apply bounded output slicing (`--limit`, `--offset`, `--head`) with in-band truncation metadata.
 */
export function applyBounds(
  data: unknown,
  opts: Pick<OutputOptions, 'limit' | 'offset' | 'head'>
): unknown {
  const effectiveLimit = opts.head ?? opts.limit;
  const offset = opts.offset ?? 0;

  if (effectiveLimit === undefined && offset === 0) return data;

  const sliceArray = (arr: unknown[]) => {
    const total = arr.length;
    const sliced = effectiveLimit !== undefined ? arr.slice(offset, offset + effectiveLimit) : arr.slice(offset);
    const truncated = offset + sliced.length < total;
    return {
      items: sliced,
      total,
      offset,
      ...(effectiveLimit !== undefined ? { limit: effectiveLimit } : {}),
      truncated,
    };
  };

  if (Array.isArray(data)) {
    return sliceArray(data);
  }

  if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>;
    if (Array.isArray(rec['items'])) {
      const sliced = sliceArray(rec['items']);
      return {
        ...rec,
        ...sliced,
      };
    }
  }

  return data;
}

/**
 * Minimal lossless YAML serializer for CLI output (zero extra dependencies).
 */
export function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value === '' || /[:#\n\r\t{}[\],&*!|>'"%@`]|^\s|\s$/.test(value)) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const rendered = toYaml(item, indent + 1);
          const lines = rendered.split('\n');
          return `${pad}- ${lines[0]!.trimStart()}\n${lines.slice(1).join('\n')}`.trimEnd();
        }
        return `${pad}- ${toYaml(item, 0)}`;
      })
      .join('\n');
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  return entries
    .map(([k, v]) => {
      if (v && typeof v === 'object' && (!Array.isArray(v) ? Object.keys(v).length > 0 : v.length > 0)) {
        return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
      }
      return `${pad}${k}: ${toYaml(v, 0)}`;
    })
    .join('\n');
}

export function formatOutput(
  data: unknown,
  opts: OutputOptions = {},
  humanRenderer?: (bounded: unknown, color: boolean) => string
): string {
  const format = resolveOutputFormat(opts.format ?? 'auto');
  const bounded = applyFieldMask(applyBounds(data, opts), opts.fields);

  switch (format) {
    case 'json': {
      const pretty = opts.pretty ?? isStdoutTty();
      return pretty ? JSON.stringify(bounded, null, 2) : JSON.stringify(bounded);
    }
    case 'ndjson': {
      const items =
        Array.isArray(bounded)
          ? bounded
          : bounded && typeof bounded === 'object' && Array.isArray((bounded as Record<string, unknown>)['items'])
            ? ((bounded as Record<string, unknown>)['items'] as unknown[])
            : [bounded];
      return items.map((item) => JSON.stringify(item)).join('\n');
    }
    case 'toon': {
      return encodeToon(bounded);
    }
    case 'yaml': {
      return toYaml(bounded);
    }
    case 'text':
    default: {
      if (humanRenderer) {
        return humanRenderer(bounded, isColorEnabled());
      }
      if (typeof bounded === 'string') return bounded;
      return JSON.stringify(bounded, null, 2);
    }
  }
}

export function writeStdout(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

export function writeStderrInfo(text: string): void {
  process.stderr.write(text.endsWith('\n') ? text : `${text}\n`);
}

/**
 * clispec v0.2 compliant error emission:
 * single-line JSON error envelope as the last line of stderr.
 */
export function emitCliError(err: unknown): number {
  let exitCode = 1;
  let envelope: CliErrorEnvelope;

  if (err instanceof Mcp2CliError) {
    exitCode = err.exitCode;
    envelope = {
      error: {
        kind: err.kind,
        message: err.message,
        ...(err.hint ? { hint: err.hint } : {}),
        retryable: err.retryable,
        ...(err.details ? { details: err.details } : {}),
      },
    };
  } else if (err instanceof Error) {
    envelope = {
      error: {
        kind: 'internal',
        message: err.message,
        retryable: false,
      },
    };
  } else {
    envelope = {
      error: {
        kind: 'internal',
        message: String(err),
        retryable: false,
      },
    };
  }

  process.stderr.write(`${JSON.stringify(envelope)}\n`);
  return exitCode;
}
