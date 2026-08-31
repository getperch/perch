import { BedrockClient, ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { models as contract } from "@perch/api-contract";
import type { AppEnv } from "../context.js";

export const modelsApp = new OpenAPIHono<AppEnv>();

const bedrock = new BedrockClient({});

/**
 * Curated metadata for models we want to name/describe nicely and pull to the top of the list.
 * This is an *overlay* on top of the live `bedrock:ListFoundationModels` result (matched by id) —
 * and the whole-list fallback if that call fails (missing permission, throttle, region without
 * Bedrock). Bedrock itself returns no human description, so anything not here just shows its raw
 * `modelName` with no subtitle.
 */
const CURATED: contract.ModelOption[] = [
  { id: "anthropic.claude-3-5-sonnet-20241022-v2:0", name: "Claude 3.5 Sonnet", sub: "Best for most work", provider: "Anthropic" },
  { id: "anthropic.claude-3-opus-20240229-v1:0", name: "Claude 3 Opus", sub: "Highest capability, slower", provider: "Anthropic" },
  { id: "anthropic.claude-3-5-haiku-20241022-v1:0", name: "Claude 3.5 Haiku", sub: "Fast and cheap", provider: "Anthropic" },
  { id: "moonshotai.kimi-k2.5", name: "Kimi K2.5", sub: "Long-context, agentic", provider: "Moonshot AI" },
  { id: "amazon.nova-pro-v1:0", name: "Amazon Nova Pro", sub: "Strong multimodal, mid-cost", provider: "Amazon" },
  { id: "amazon.nova-lite-v1:0", name: "Amazon Nova Lite", sub: "Fast, low-cost multimodal", provider: "Amazon" },
  { id: "amazon.nova-micro-v1:0", name: "Amazon Nova Micro", sub: "Fastest and cheapest, text-only", provider: "Amazon" },
  { id: "meta.llama3-1-70b-instruct-v1:0", name: "Llama 3.1 70B", sub: "Open-weight, balanced", provider: "Meta" },
  { id: "meta.llama3-1-8b-instruct-v1:0", name: "Llama 3.1 8B", sub: "Very fast, very cheap", provider: "Meta" },
  { id: "mistral.mistral-large-2407-v1:0", name: "Mistral Large", sub: "Strong reasoning", provider: "Mistral AI" },
  { id: "cohere.command-r-plus-v1:0", name: "Command R+", sub: "Strong for RAG and tool use", provider: "Cohere" },
];

const CURATED_BY_ID = new Map(CURATED.map((m) => [m.id, m]));
const CURATED_ORDER = new Map(CURATED.map((m, i) => [m.id, i]));
const PROVIDER_ORDER = ["Anthropic", "Amazon", "Moonshot AI", "Meta", "Mistral AI", "Cohere", "AI21 Labs", "DeepSeek", "Qwen", "Stability AI"];

const CACHE_TTL_MS = 10 * 60_000;
let cache: { at: number; models: contract.ModelOption[] } | null = null;

function providerRank(provider: string): number {
  const i = PROVIDER_ORDER.indexOf(provider);
  return i === -1 ? PROVIDER_ORDER.length : i;
}

function sortModels(models: contract.ModelOption[]): contract.ModelOption[] {
  return [...models].sort((a, b) => {
    const ca = CURATED_ORDER.get(a.id);
    const cb = CURATED_ORDER.get(b.id);
    if (ca !== undefined || cb !== undefined) {
      if (ca === undefined) return 1;
      if (cb === undefined) return -1;
      return ca - cb;
    }
    return providerRank(a.provider) - providerRank(b.provider) || a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name);
  });
}

/**
 * Live from Bedrock: on-demand, text-in/text-out, streaming, ACTIVE models — i.e. what an agent's
 * Converse loop can actually run. Context-window variant ids (`…:0:200k`) are dropped in favour of
 * the canonical `…-vN:0`. Cached ~10min per warm Lambda; falls back to the curated list on error.
 */
async function listModels(): Promise<contract.ModelOption[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models;

  try {
    const res = await bedrock.send(
      new ListFoundationModelsCommand({ byOutputModality: "TEXT", byInferenceType: "ON_DEMAND" }),
    );

    const seen = new Set<string>();
    const models: contract.ModelOption[] = [];
    for (const m of res.modelSummaries ?? []) {
      const id = m.modelId;
      if (!id || seen.has(id)) continue;
      if ((id.match(/:/g)?.length ?? 0) > 1) continue; // context-window variant, not the canonical id
      if (m.modelLifecycle?.status && m.modelLifecycle.status !== "ACTIVE") continue;
      if (m.responseStreamingSupported === false) continue;
      if (m.inputModalities && !m.inputModalities.includes("TEXT")) continue;
      if (m.outputModalities && !m.outputModalities.includes("TEXT")) continue;

      seen.add(id);
      const curated = CURATED_BY_ID.get(id);
      models.push({
        id,
        name: curated?.name ?? m.modelName ?? id,
        sub: curated?.sub ?? "",
        provider: curated?.provider ?? m.providerName ?? "Other",
      });
    }

    if (models.length === 0) throw new Error("ListFoundationModels returned no usable models");
    const sorted = sortModels(models);
    cache = { at: Date.now(), models: sorted };
    return sorted;
  } catch (err) {
    console.error("models.list: falling back to curated list —", err instanceof Error ? err.message : err);
    return sortModels(CURATED);
  }
}

modelsApp.openapi(
  createRoute({
    method: "get",
    path: "/",
    responses: { 200: { content: { "application/json": { schema: contract.listModelsOutput } }, description: "OK" } },
  }),
  async (c) => c.json(await listModels()),
);
