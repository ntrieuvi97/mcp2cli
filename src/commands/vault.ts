import { OutputOptions, formatOutput, writeStdout } from '../core/output.js';
import { isStdinTty } from '../core/platform.js';
import { Mcp2CliError, assertSafeIdentifier } from '../core/security.js';
import { SecretVault } from '../core/vault.js';

async function readSecretFromStdin(): Promise<string> {
  if (isStdinTty()) {
    throw new Mcp2CliError({
      kind: 'validation',
      message: 'Refusing interactive secret read without --secret-stdin pipe.',
      hint: 'Pipe secret via stdin: printf "%s" "$TOKEN" | mcp2cli vault set KEY --secret-stdin',
      retryable: false,
    });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

export async function runVaultSet(key: string, opts: OutputOptions & { secretStdin?: boolean }): Promise<void> {
  assertSafeIdentifier(key, 'vault key');
  if (!opts.secretStdin) {
    throw new Mcp2CliError({
      kind: 'validation',
      message: 'Secrets must be passed via stdin (--secret-stdin), never via CLI arguments.',
      hint: `Run: printf "%s" "$SECRET" | mcp2cli vault set ${key} --secret-stdin`,
      retryable: false,
    });
  }
  const secret = await readSecretFromStdin();
  const vault = new SecretVault();
  await vault.set(key, secret);
  writeStdout(formatOutput({ key, stored: true, changed: true }, opts, () => `Stored '${key}' in encrypted vault.`));
}

export async function runVaultList(opts: OutputOptions): Promise<void> {
  const vault = new SecretVault();
  const keys = await vault.listKeys();
  writeStdout(
    formatOutput({ items: keys }, opts, () => (keys.length === 0 ? 'Vault is empty.' : keys.join('\n')))
  );
}

export async function runVaultDelete(key: string, opts: OutputOptions): Promise<void> {
  assertSafeIdentifier(key, 'vault key');
  const vault = new SecretVault();
  const deleted = await vault.delete(key);
  writeStdout(
    formatOutput({ key, deleted, changed: deleted }, opts, () =>
      deleted ? `Deleted '${key}' from vault.` : `Key '${key}' not found.`
    )
  );
}
