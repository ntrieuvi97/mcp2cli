import { McpServerConfig } from '../types.js';
import { toSkillName } from '../core/security.js';

export interface GeneratedCliShim {
  filename: string;
  content: string;
  executable: boolean;
}

/**
 * Emit cross-platform branded CLI shims (`bin/<name>`, `bin/<name>.cmd`, `bin/<name>.ps1`)
 * so agents and humans can invoke `<name> <tool> --flag val` like a native binary.
 */
export function generateCliShims(server: McpServerConfig): GeneratedCliShim[] {
  const binName = toSkillName(server.name);
  return [
    {
      filename: binName,
      executable: true,
      content: `#!/bin/sh
set -eu
exec mcp2cli run ${JSON.stringify(server.name)} "$@"
`,
    },
    {
      filename: `${binName}.cmd`,
      executable: false,
      content: `@echo off\r\nmcp2cli run ${JSON.stringify(server.name)} %*\r\n`,
    },
    {
      filename: `${binName}.ps1`,
      executable: false,
      content: `& mcp2cli run ${JSON.stringify(server.name)} @args\nexit $LASTEXITCODE\n`,
    },
  ];
}
