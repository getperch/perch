import { z } from "zod";

/** One selectable agent model, as served by `GET /models`. `id` is what gets stored in
 * `agentConfig.model` and handed to the runtime's model provider. */
export const modelOption = z.object({
  id: z.string(),
  name: z.string(),
  sub: z.string(),
  provider: z.string(),
});
export type ModelOption = z.infer<typeof modelOption>;

export const listModelsOutput = z.array(modelOption);
