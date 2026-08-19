import type { Usage } from "@strands-agents/sdk";

/**
 * USD per 1M tokens, on-demand Bedrock pricing (us-east-1, approximate — update these if Bedrock
 * repricing makes spend-cap enforcement drift noticeably from actual billing). Cache-read tokens
 * are billed at a fraction of input price on most providers; we don't have per-model cache
 * pricing here, so cache reads are folded into the input rate, which slightly overestimates cost
 * for cache-heavy runs — acceptable for a budget *cap*, where erring toward stopping early is
 * safer than erring toward overspend.
 */
const PRICE_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  "anthropic.claude-3-5-sonnet-20241022-v2:0": { input: 3.0, output: 15.0 },
  "anthropic.claude-3-5-haiku-20241022-v1:0": { input: 0.8, output: 4.0 },
  "anthropic.claude-3-opus-20240229-v1:0": { input: 15.0, output: 75.0 },
  "amazon.nova-pro-v1:0": { input: 0.8, output: 3.2 },
  "amazon.nova-lite-v1:0": { input: 0.06, output: 0.24 },
  "amazon.nova-micro-v1:0": { input: 0.035, output: 0.14 },
  "meta.llama3-1-70b-instruct-v1:0": { input: 0.72, output: 0.72 },
  "meta.llama3-1-8b-instruct-v1:0": { input: 0.22, output: 0.22 },
  "mistral.mistral-large-2407-v1:0": { input: 4.0, output: 12.0 },
  "mistral.mistral-small-2402-v1:0": { input: 1.0, output: 3.0 },
  "cohere.command-r-plus-v1:0": { input: 3.0, output: 15.0 },
  "google.gemma-3-27b-it": { input: 0.2, output: 0.2 },
  // Bedrock on-demand `moonshotai.kimi-k2.5`. Rates approximate (~Moonshot list price, nudged up
  // so the budget cap errs toward stopping early) — refresh against Bedrock pricing if needed.
  "moonshotai.kimi-k2.5": { input: 1.0, output: 3.0 },
};

/** Falls back to Claude 3.5 Sonnet's price if a model id isn't in the table, rather than $0 — an
 * unpriced model should never look free to the budget cap. */
const FALLBACK_PRICE = PRICE_PER_1M_TOKENS["anthropic.claude-3-5-sonnet-20241022-v2:0"]!;

export function estimateCostUsd(modelId: string, usage: Usage): number {
  const price = PRICE_PER_1M_TOKENS[modelId] ?? FALLBACK_PRICE;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}
