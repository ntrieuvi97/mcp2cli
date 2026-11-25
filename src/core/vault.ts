import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteFile, fileExists, getConfigDir, withFileLock } from './platform.js';

interface VaultEnvelope {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

/**
 * Portable AES-256-GCM encrypted credential vault with zero native dependencies.
 * Works uniformly across Linux, macOS, Windows, Alpine, Termux, Docker, and CI.
 */
export class SecretVault {
  private readonly vaultPath: string;
  private readonly lockPath: string;

  constructor(vaultDir = getConfigDir()) {
    this.vaultPath = path.join(vaultDir, 'vault.enc.json');
    this.lockPath = path.join(vaultDir, 'vault.lock');
  }

  private deriveKey(salt: Buffer): Buffer {
    const passphrase =
      process.env['MCP2CLI_VAULT_PASSWORD'] ||
      `${os.hostname()}:${os.userInfo().username}:${getConfigDir()}:mcp2cli-v1`;
    return crypto.scryptSync(passphrase, salt, 32);
  }

  private async readAll(): Promise<Record<string, string>> {
    if (!(await fileExists(this.vaultPath))) return {};
    const raw = await fs.readFile(this.vaultPath, 'utf8');
    const env = JSON.parse(raw) as VaultEnvelope;
    const salt = Buffer.from(env.salt, 'base64');
    const iv = Buffer.from(env.iv, 'base64');
    const tag = Buffer.from(env.tag, 'base64');
    const ciphertext = Buffer.from(env.ciphertext, 'base64');
    const key = this.deriveKey(salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(plain) as Record<string, string>;
  }

  private async writeAll(entries: Record<string, string>): Promise<void> {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = this.deriveKey(salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(entries), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope: VaultEnvelope = {
      version: 1,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    await atomicWriteFile(this.vaultPath, JSON.stringify(envelope, null, 2), 0o600);
  }

  async set(key: string, value: string): Promise<void> {
    await withFileLock(this.lockPath, async () => {
      const entries = await this.readAll();
      entries[key] = value;
      await this.writeAll(entries);
    });
  }

  async get(key: string): Promise<string | undefined> {
    const entries = await this.readAll();
    return entries[key];
  }

  async delete(key: string): Promise<boolean> {
    return withFileLock(this.lockPath, async () => {
      const entries = await this.readAll();
      if (!(key in entries)) return false;
      delete entries[key];
      await this.writeAll(entries);
      return true;
    });
  }

  async listKeys(): Promise<string[]> {
    const entries = await this.readAll();
    return Object.keys(entries).sort();
  }
}
