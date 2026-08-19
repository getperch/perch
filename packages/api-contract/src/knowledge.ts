import { z } from "zod";

/**
 * `/knowledge/*` — human read / curate / verify over the workspace's Open Knowledge Format bundle
 * (see services/api/src/okf-store.ts). The bundle is shared with the agents, which read it for
 * retrieval and write their own extracted observations into it.
 */

export const okfStatus = z.enum(["draft", "stable", "deprecated"]);
export const okfTrust = z.enum(["unverified", "machine-confirmed", "human-reviewed"]);

/** Path of a concept within the bundle, e.g. `playbooks/oncall.md` or `agents/beacon/1a2b3c.md`. */
export const conceptPath = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*\.md$/, "path like `<domain>/<slug>.md`");

export const conceptSummary = z.object({
  path: z.string(),
  type: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  status: okfStatus,
  trust: okfTrust,
  generatedAt: z.string().optional(),
  staleAfter: z.string().optional(),
  stale: z.boolean(),
  tags: z.array(z.string()),
});

export const concept = z.object({
  path: z.string(),
  /** Raw OKF frontmatter — `type` plus whatever optional families the doc carries. */
  frontmatter: z.record(z.string(), z.unknown()),
  body: z.string(),
});

export const listOutput = z.object({ concepts: z.array(conceptSummary) });

export const getInput = z.object({ path: conceptPath });
export const getOutput = concept;

/** Create or replace a human-curated doc under a `<domain>/` directory. `agents/` is rejected. */
export const putInput = z.object({
  path: conceptPath,
  type: z.string().min(1).default("Note"),
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  body: z.string().default(""),
  status: okfStatus.optional(),
  /** ISO 8601 instant after which the doc should be treated as stale. */
  staleAfter: z.string().datetime().optional(),
});
export const putOutput = concept;

export const deleteInput = z.object({ path: conceptPath });
export const deleteOutput = concept;

export const verifyInput = z.object({ path: conceptPath });
export const verifyOutput = concept;

export const reindexOutput = z.object({ indexed: z.number().int().nonnegative() });
