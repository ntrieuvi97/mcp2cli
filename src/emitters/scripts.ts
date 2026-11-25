import { McpServerConfig, ScriptTarget } from '../types.js';

export interface GeneratedScript {
  filename: string;
  content: string;
  executable: boolean;
}

/**
 * Generate portable cross-platform wrapper scripts for POSIX sh, Windows PowerShell,
 * Python 3 stdlib, and Node 22+ stdlib.
 *
 * For HTTP MCP servers, Python/Node scripts can speak JSON-RPC 2.0 directly over HTTP
 * with zero dependencies, or fall back to `mcp2cli run` for stdio/OAuth/session support.
 */
export function generateScriptsForServer(
  server: McpServerConfig,
  targets: ScriptTarget[]
): GeneratedScript[] {
  const out: GeneratedScript[] = [];
  const serverJson = JSON.stringify({
    name: server.name,
    transport: server.transport,
    ...(server.url ? { url: server.url } : {}),
    ...(server.command ? { command: server.command } : {}),
    ...(server.args ? { args: server.args } : {}),
  });

  if (targets.includes('sh')) {
    out.push({
      filename: 'call.sh',
      executable: true,
      content: `#!/bin/sh
# POSIX-compliant wrapper for MCP server: ${server.name}
# Works on Linux, macOS, Alpine, BSD, and Android Termux.
set -eu

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <tool-name> [json-args | - for stdin]" >&2
  exit 2
fi

TOOL="$1"
shift
ARGS="\${1:-}"

if [ -n "$ARGS" ] && [ "$ARGS" != "-" ]; then
  exec mcp2cli run ${JSON.stringify(server.name)} "$TOOL" --req-json "$ARGS" --output json
elif [ ! -t 0 ]; then
  exec mcp2cli run ${JSON.stringify(server.name)} "$TOOL" --stdin --output json
else
  exec mcp2cli run ${JSON.stringify(server.name)} "$TOOL" --output json
fi
`,
    });
  }

  if (targets.includes('ps1')) {
    out.push({
      filename: 'call.ps1',
      executable: false,
      content: `# PowerShell wrapper for MCP server: ${server.name}
# Works natively on Windows PowerShell 5.1+ and PowerShell 7+ (no WSL/bash required).
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Tool,
  [Parameter(Position = 1)]
  [string]$JsonArgs = ""
)

$ErrorActionPreference = "Stop"

if ($JsonArgs -and $JsonArgs -ne "-") {
  & mcp2cli run ${JSON.stringify(server.name)} $Tool --req-json $JsonArgs --output json
  exit $LASTEXITCODE
} elseif ([Console]::IsInputRedirected) {
  $stdinBody = [Console]::In.ReadToEnd()
  $stdinBody | & mcp2cli run ${JSON.stringify(server.name)} $Tool --stdin --output json
  exit $LASTEXITCODE
} else {
  & mcp2cli run ${JSON.stringify(server.name)} $Tool --output json
  exit $LASTEXITCODE
}
`,
    });
  }

  if (targets.includes('py')) {
    out.push({
      filename: 'call.py',
      executable: true,
      content: `#!/usr/bin/env python3
"""Zero-dependency Python 3 wrapper for MCP server: ${server.name}.
Supports direct Streamable HTTP JSON-RPC calls (when url is configured) or delegates to mcp2cli.
"""
import json
import os
import shutil
import subprocess
import sys
import urllib.request

SERVER = json.loads(${JSON.stringify(serverJson)})


def call_http(tool: str, args: dict) -> dict:
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool, "arguments": args},
    }).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    token = os.environ.get("MCP_AUTH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(SERVER["url"], data=payload, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw)


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: call.py <tool-name> [json-args]\\n")
        return 2
    tool = sys.argv[1]
    raw_args = sys.argv[2] if len(sys.argv) > 2 else (sys.stdin.read().strip() if not sys.stdin.isatty() else "{}")
    parsed_args = json.loads(raw_args or "{}")

    if SERVER.get("transport") == "http" and SERVER.get("url") and os.environ.get("MCP2CLI_DIRECT_HTTP") == "1":
        result = call_http(tool, parsed_args)
        print(json.dumps(result))
        return 0

    bin_path = shutil.which("mcp2cli") or "mcp2cli"
    proc = subprocess.run(
        [bin_path, "run", SERVER["name"], tool, "--req-json", json.dumps(parsed_args), "--output", "json"],
        check=False,
    )
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
`,
    });
  }

  if (targets.includes('mjs')) {
    out.push({
      filename: 'call.mjs',
      executable: true,
      content: `#!/usr/bin/env node
// Zero-dependency Node.js 22+ wrapper for MCP server: ${server.name}
import { spawnSync } from 'node:child_process';

const SERVER = ${serverJson};
const MCP2CLI_BIN = process.platform === 'win32' ? 'mcp2cli.cmd' : 'mcp2cli';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const [, , tool, rawArg] = process.argv;
  if (!tool) {
    process.stderr.write('Usage: call.mjs <tool-name> [json-args]\\n');
    process.exit(2);
  }
  const argText = rawArg && rawArg !== '-' ? rawArg : await readStdin();
  const parsedArgs = argText ? JSON.parse(argText) : {};

  if (SERVER.transport === 'http' && SERVER.url && process.env.MCP2CLI_DIRECT_HTTP === '1') {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (process.env.MCP_AUTH_TOKEN) {
      headers.authorization = \`Bearer \${process.env.MCP_AUTH_TOKEN}\`;
    }
    const res = await fetch(SERVER.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: parsedArgs },
      }),
    });
    const text = await res.text();
    process.stdout.write(text.endsWith('\\n') ? text : \`\${text}\\n\`);
    process.exit(res.ok ? 0 : 1);
  }

  const res = spawnSync(
    MCP2CLI_BIN,
    ['run', SERVER.name, tool, '--req-json', JSON.stringify(parsedArgs), '--output', 'json'],
    { stdio: 'inherit', shell: false }
  );
  process.exit(res.status ?? 1);
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ error: { kind: 'internal', message: err.message } }) + '\\n');
  process.exit(1);
});
`,
    });
  }

  return out;
}
