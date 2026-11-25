import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServerConfig } from '../types.js';
import { atomicWriteFile, fileExists, getConfigDir, withFileLock } from './platform.js';
import { assertSafeIdentifier, redactServerSecrets } from './security.js';

function getBakedRegistryPath(): string {
  return path.join(getConfigDir(), 'servers.json');
}

export async function listSavedServers(): Promise<Record<string, McpServerConfig>> {
  const regPath = getBakedRegistryPath();
  if (!(await fileExists(regPath))) return {};
  try {
    return JSON.parse(await fs.readFile(regPath, 'utf8')) as Record<string, McpServerConfig>;
  } catch {
    return {};
  }
}

export async function getSavedServer(name: string): Promise<McpServerConfig | undefined> {
  assertSafeIdentifier(name, 'server name');
  const all = await listSavedServers();
  return all[name];
}

export async function saveServerBinding(server: McpServerConfig): Promise<void> {
  assertSafeIdentifier(server.name, 'server name');
  const regPath = getBakedRegistryPath();
  await withFileLock(`${regPath}.lock`, async () => {
    const all = await listSavedServers();
    all[server.name] = server;
    await atomicWriteFile(regPath, JSON.stringify(all, null, 2), 0o600);
  });
}

export async function removeSavedServer(name: string): Promise<boolean> {
  assertSafeIdentifier(name, 'server name');
  const regPath = getBakedRegistryPath();
  return withFileLock(`${regPath}.lock`, async () => {
    const all = await listSavedServers();
    if (!(name in all)) return false;
    delete all[name];
    await atomicWriteFile(regPath, JSON.stringify(all, null, 2), 0o600);
    return true;
  });
}

export function listSavedServersRedacted(all: Record<string, McpServerConfig>): McpServerConfig[] {
  return Object.values(all).map(redactServerSecrets);
}
