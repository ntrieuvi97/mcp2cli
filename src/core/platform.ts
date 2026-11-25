import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export type OsFamily = 'windows' | 'macos' | 'linux' | 'bsd' | 'android';

export function detectOsFamily(): OsFamily {
  const p = process.platform;
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  if (p === 'android' || process.env['TERMUX_VERSION']) return 'android';
  if (p === 'freebsd' || p === 'openbsd' || p === 'netbsd') return 'bsd';
  return 'linux';
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isTermux(): boolean {
  return Boolean(process.env['TERMUX_VERSION']) || process.platform === 'android';
}

export function isHeadless(): boolean {
  if (isWindows() || process.platform === 'darwin') {
    return Boolean(process.env['CI'] || process.env['SSH_CONNECTION']);
  }
  return !process.env['DISPLAY'] && !process.env['WAYLAND_DISPLAY'];
}

export function getHomeDir(): string {
  return os.homedir();
}

export function getConfigDir(): string {
  if (process.env['MCP2CLI_CONFIG_DIR']) {
    return path.resolve(process.env['MCP2CLI_CONFIG_DIR']);
  }
  if (isWindows()) {
    const appData = process.env['APPDATA'] || path.join(getHomeDir(), 'AppData', 'Roaming');
    return path.join(appData, 'mcp2cli');
  }
  const xdg = process.env['XDG_CONFIG_HOME'] || path.join(getHomeDir(), '.config');
  return path.join(xdg, 'mcp2cli');
}

export function getCacheDir(): string {
  if (process.env['MCP2CLI_CACHE_DIR']) {
    return path.resolve(process.env['MCP2CLI_CACHE_DIR']);
  }
  if (isWindows()) {
    const localAppData = process.env['LOCALAPPDATA'] || path.join(getHomeDir(), 'AppData', 'Local');
    return path.join(localAppData, 'mcp2cli', 'cache');
  }
  if (process.platform === 'darwin') {
    return path.join(getHomeDir(), 'Library', 'Caches', 'mcp2cli');
  }
  const xdg = process.env['XDG_CACHE_HOME'] || path.join(getHomeDir(), '.cache');
  return path.join(xdg, 'mcp2cli');
}

export function getDataDir(): string {
  if (process.env['MCP2CLI_DATA_DIR']) {
    return path.resolve(process.env['MCP2CLI_DATA_DIR']);
  }
  if (isWindows()) {
    const localAppData = process.env['LOCALAPPDATA'] || path.join(getHomeDir(), 'AppData', 'Local');
    return path.join(localAppData, 'mcp2cli', 'data');
  }
  const xdg = process.env['XDG_DATA_HOME'] || path.join(getHomeDir(), '.local', 'share');
  return path.join(xdg, 'mcp2cli');
}

export function getSocketPath(sessionName: string): string {
  const safe = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (isWindows()) {
    // Windows Named Pipe — works without AF_UNIX or elevated privileges
    const userHash = crypto.createHash('sha256').update(os.userInfo().username).digest('hex').slice(0, 8);
    return `\\\\.\\pipe\\mcp2cli-${userHash}-${safe}`;
  }
  const runDir = process.env['XDG_RUNTIME_DIR']
    ? path.join(process.env['XDG_RUNTIME_DIR'], 'mcp2cli')
    : path.join(getCacheDir(), 'sessions');
  return path.join(runDir, `${safe}.sock`);
}

export async function ensurePrivateDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  if (!isWindows()) {
    try {
      await fs.chmod(dirPath, 0o700);
    } catch {
      // Best-effort on filesystems without POSIX permissions
    }
  }
}

/**
 * Atomic file write safe under parallel agent invocations.
 * Writes to a temp file in the same directory and renames atomically.
 */
export async function atomicWriteFile(
  targetPath: string,
  content: string | Uint8Array,
  mode = 0o600
): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(targetPath)}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`
  );
  await fs.writeFile(tmp, content, { mode });
  await fs.rename(tmp, targetPath);
  if (!isWindows()) {
    try {
      await fs.chmod(targetPath, mode);
    } catch {
      // Ignore on virtual filesystems
    }
  }
}

/**
 * Advisory file lock using exclusive creation (wx) with stale-lock recovery.
 */
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, timeoutMs = 5000): Promise<T> {
  const dir = path.dirname(lockPath);
  await fs.mkdir(dir, { recursive: true });
  const start = Date.now();

  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, ts: Date.now() }));
        return await fn();
      } finally {
        await handle.close().catch(() => undefined);
        await fs.unlink(lockPath).catch(() => undefined);
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') throw err;

      // Recover stale lock older than 30s
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > 30_000) {
          await fs.unlink(lockPath).catch(() => undefined);
          continue;
        }
      } catch {
        continue;
      }

      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for lock: ${lockPath}`);
      }
      await new Promise((r) => setTimeout(r, 35));
    }
  }
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function isStdoutTty(): boolean {
  return Boolean(process.stdout.isTTY);
}

export function isStdinTty(): boolean {
  return Boolean(process.stdin.isTTY);
}

export function isColorEnabled(): boolean {
  if (process.env['NO_COLOR'] !== undefined) return false;
  if (process.env['FORCE_COLOR'] === '0') return false;
  return isStdoutTty();
}
