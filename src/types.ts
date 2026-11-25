export type OutputFormat = 'auto' | 'text' | 'json' | 'ndjson' | 'toon' | 'yaml';

export type TransportKind = 'stdio' | 'http' | 'sse';

export type AgentClientId =
  | 'claude-code'
  | 'claude-desktop'
  | 'cursor'
  | 'vscode'
  | 'windsurf'
  | 'cline'
  | 'roo-code'
  | 'codex'
  | 'gemini-cli'
  | 'opencode'
  | 'goose'
  | 'openclaw'
  | 'antigravity'
  | 'generic';

export interface McpServerConfig {
  name: string;
  transport: TransportKind;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
  /** Origin client metadata */
  clientId?: AgentClientId;
  configPath?: string;
  projectPath?: string;
  scope?: 'project' | 'user';
  trusted?: boolean;
  /** References env vars like ${GITHUB_TOKEN} that require trust verification */
  referencedEnvVars?: string[];
}

export interface DiscoveredClientConfig {
  clientId: AgentClientId;
  clientName: string;
  configPath: string;
  projectPath?: string;
  readonlyConfig?: boolean;
  skillsDir: string;
  scope: 'project' | 'user';
  format: 'json' | 'jsonc' | 'toml' | 'yaml';
  exists: boolean;
  servers: McpServerConfig[];
  parseError?: string;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface McpServerCapabilitiesSnapshot {
  serverName: string;
  serverInfo?: {
    name: string;
    version: string;
  };
  protocolVersion?: string;
  instructions?: string;
  tools: McpToolDefinition[];
  resources: McpResourceDefinition[];
  prompts: McpPromptDefinition[];
  fetchedAt: string;
  transport: TransportKind;
}

export interface NativeCliRecommendation {
  cli: string;
  packageHint: string;
  reason: string;
  installCommand: string;
}

export interface ServerTokenAudit {
  serverName: string;
  clientId?: AgentClientId;
  configPath?: string;
  transport: TransportKind;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  /** Tokens consumed per turn when attached directly via native MCP */
  mcpUpfrontTokens: number;
  /** Tokens consumed at startup when converted to SKILL.md (frontmatter only) */
  skillCatalogTokens: number;
  /** Full SKILL.md body tokens loaded on-demand when triggered */
  skillOnDemandTokens: number;
  /** Percentage of per-turn baseline context saved */
  savingsPercent: number;
  /** Estimated USD saved per 1,000 agent turns (at $3 / 1M input tokens baseline) */
  estimatedUsdSavedPer1kTurns: number;
  nativeCliAlternative?: NativeCliRecommendation;
  status: 'ok' | 'skipped-untrusted' | 'error';
  error?: string;
}

export interface AuditReport {
  generatedAt: string;
  totalServers: number;
  auditedServers: number;
  totalMcpUpfrontTokens: number;
  totalSkillCatalogTokens: number;
  totalSavingsPercent: number;
  estimatedUsdSavedPer1kTurns: number;
  servers: ServerTokenAudit[];
}

export type ScriptTarget = 'sh' | 'ps1' | 'py' | 'mjs';
export type SdkTarget = 'ts' | 'py';

export interface ConvertOptions {
  outDir: string;
  scripts?: ScriptTarget[];
  sdk?: SdkTarget[];
  includeNativeAlternative?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  readOnlyOnly?: boolean;
  topTools?: number;
}

export interface EmittedArtifact {
  path: string;
  kind: 'skill' | 'reference' | 'script' | 'sdk' | 'cli-shim' | 'schema';
  bytes: number;
}

export interface ConvertResult {
  serverName: string;
  skillName: string;
  outputDir: string;
  toolCount: number;
  mcpUpfrontTokens: number;
  skillCatalogTokens: number;
  savingsPercent: number;
  nativeCliAlternative?: NativeCliRecommendation;
  artifacts: EmittedArtifact[];
}

export type ErrorKind =
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

export interface CliErrorEnvelope {
  error: {
    kind: ErrorKind;
    message: string;
    hint?: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}
