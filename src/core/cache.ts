import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServerCapabilitiesSnapshot, McpToolDefinition } from '../types.js';
import { atomicWriteFile, fileExists, getCacheDir, withFileLock } from './platform.js';

export interface UsageEntry {
  count: number;
  lastUsedAt: number;
}

export type UsageSortMode = 'usage' | 'recent' | 'alpha' | 'default';

export function buildServerCacheKey(identifier: string): string {
  return crypto.createHash('sha256').update(identifier).digest('hex').slice(0, 16);
}

export async function readCachedSnapshot(
  serverKey: string,
  ttlSeconds = 3600
): Promise<McpServerCapabilitiesSnapshot | null> {
  const filePath = path.join(getCacheDir(), 'schemas', `${serverKey}.json`);
  if (!(await fileExists(filePath))) return null;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as McpServerCapabilitiesSnapshot;
    const ageSec = (Date.now() - new Date(parsed.fetchedAt).getTime()) / 1000;
    if (ttlSeconds > 0 && ageSec > ttlSeconds) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCachedSnapshot(
  serverKey: string,
  snapshot: McpServerCapabilitiesSnapshot
): Promise<void> {
  const filePath = path.join(getCacheDir(), 'schemas', `${serverKey}.json`);
  await atomicWriteFile(filePath, JSON.stringify(snapshot, null, 2), 0o600);
}

function getUsagePath(): string {
  return path.join(getCacheDir(), 'usage.json');
}

export async function recordToolUsage(serverKey: string, toolName: string): Promise<void> {
  const usagePath = getUsagePath();
  const lockPath = `${usagePath}.lock`;
  await withFileLock(lockPath, async () => {
    let data: Record<string, Record<string, UsageEntry>> = {};
    if (await fileExists(usagePath)) {
      try {
        data = JSON.parse(await fs.readFile(usagePath, 'utf8')) as typeof data;
      } catch {
        data = {};
      }
    }
    const serverUsage = data[serverKey] ?? {};
    const prev = serverUsage[toolName] ?? { count: 0, lastUsedAt: 0 };
    serverUsage[toolName] = {
      count: prev.count + 1,
      lastUsedAt: Date.now(),
    };
    data[serverKey] = serverUsage;
    await atomicWriteFile(usagePath, JSON.stringify(data, null, 2), 0o600);
  });
}

export async function getServerUsage(serverKey: string): Promise<Record<string, UsageEntry>> {
  const usagePath = getUsagePath();
  if (!(await fileExists(usagePath))) return {};
  try {
    const data = JSON.parse(await fs.readFile(usagePath, 'utf8')) as Record<
      string,
      Record<string, UsageEntry>
    >;
    return data[serverKey] ?? {};
  } catch {
    return {};
  }
}

export function sortToolsByMode(
  tools: McpToolDefinition[],
  usage: Record<string, UsageEntry>,
  mode: UsageSortMode = 'usage'
): McpToolDefinition[] {
  const copy = [...tools];
  if (mode === 'default') return copy;
  if (mode === 'alpha') {
    return copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (mode === 'recent') {
    return copy.sort((a, b) => {
      const ta = usage[a.name]?.lastUsedAt ?? 0;
      const tb = usage[b.name]?.lastUsedAt ?? 0;
      return tb - ta;
    });
  }
  // 'usage': most frequently used first, preserving order on ties
  const hasUsage = Object.keys(usage).length > 0;
  if (!hasUsage) return copy;
  return copy.sort((a, b) => {
    const ca = usage[a.name]?.count ?? 0;
    const cb = usage[b.name]?.count ?? 0;
    return cb - ca;
  });
}
