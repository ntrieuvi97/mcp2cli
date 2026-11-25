import { McpToolDefinition } from '../types.js';

/**
 * Calibrated offline token estimator for BPE tokenizers (Claude / GPT / Gemini).
 * JSON punctuation (`{"":,}`) tokenizes denser (~3.1 chars/token) than English prose (~4.0 chars/token).
 * Zero external WASM/binary dependencies so it runs identically on Termux, Alpine, Windows, and WASM.
 */
export function estimateTokens(text: string, mode: 'json' | 'prose' = 'prose'): number {
  if (!text) return 0;
  if (mode === 'json') {
    const structuralChars = (text.match(/[{}\[\]":,]/g) ?? []).length;
    const contentChars = text.length - structuralChars;
    return Math.ceil(contentChars / 3.6 + structuralChars * 0.62);
  }
  return Math.ceil(text.length / 3.9);
}

/**
 * Estimate per-turn upfront context tokens consumed when MCP tool schemas are injected directly
 * into an LLM system prompt / tool manifest.
 */
export function estimateMcpToolsTokens(tools: McpToolDefinition[]): number {
  if (tools.length === 0) return 0;
  // Serialize the exact wire payload an agent harness injects per tool
  const payload = JSON.stringify(
    tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      input_schema: t.inputSchema ?? { type: 'object', properties: {} },
    }))
  );
  // Add small per-tool harness framing (~18 tokens/tool)
  return estimateTokens(payload, 'json') + tools.length * 18;
}

/**
 * Estimate savings percentage and USD saved per 1,000 agent turns
 * (baseline $3.00 / 1M input tokens — standard frontier coding model tier).
 */
export function computeTokenSavings(mcpUpfrontTokens: number, skillCatalogTokens: number): {
  savingsPercent: number;
  estimatedUsdSavedPer1kTurns: number;
} {
  if (mcpUpfrontTokens <= 0) {
    return { savingsPercent: 0, estimatedUsdSavedPer1kTurns: 0 };
  }
  const savedPerTurn = Math.max(0, mcpUpfrontTokens - skillCatalogTokens);
  const savingsPercent = Number(((savedPerTurn / mcpUpfrontTokens) * 100).toFixed(1));
  // 1,000 turns * savedPerTurn tokens * ($3 / 1,000,000 tokens)
  const estimatedUsdSavedPer1kTurns = Number(((savedPerTurn * 1000 * 3) / 1_000_000).toFixed(2));
  return { savingsPercent, estimatedUsdSavedPer1kTurns };
}
