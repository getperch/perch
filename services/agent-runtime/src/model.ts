import { type Model } from "@strands-agents/sdk";
import { BedrockModel } from "@strands-agents/sdk";

/**
 * Builds the Strands model provider for a stored `agentConfig.model` id.
 *
 * `serviceTier: "flex"` (Bedrock's lower-cost, best-effort throughput tier — a real, current
 * top-level Converse parameter) is only accepted by Anthropic Claude and Amazon Nova models;
 * sending it on other providers (e.g. `moonshotai.kimi-k2.5`) makes Converse 400 with an invalid
 * parameter error. `BedrockModel`'s `additionalArgs` is `Object.assign`'d directly onto the
 * Converse/ConverseStream request (see `@strands-agents/sdk`'s bedrock.js), so this is the
 * mechanism — there's no dedicated `serviceTier` field on `BedrockModelConfig`.
 */
const FLEX_TIER_PREFIXES = ["anthropic.", "amazon.nova"];

export function resolveModel(modelId: string): BedrockModel {
  const supportsFlex = FLEX_TIER_PREFIXES.some((p) => modelId.startsWith(p));
  return new BedrockModel({
    modelId,
    ...(supportsFlex ? { additionalArgs: { serviceTier: { type: "flex" } } } : {}),
  });
}
