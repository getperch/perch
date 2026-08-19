import { z } from "zod";
import { memberId, pluginIndex, pluginManifest, workspaceId } from "@fizz/core";

/** Backs "Publish as plugin" on the agent detail screen. */
export const publishInput = z.object({ workspaceId, memberId });
export const publishOutput = z.object({ name: z.string(), version: z.string() });

/** Backs "Browse plugins" in the Add member -> Agent screen. */
export const listInput = z.object({ workspaceId, q: z.string().optional() });
export const listOutput = pluginIndex;

export const getInput = z.object({ workspaceId, name: z.string(), version: z.string() });
export const getOutput = z.object({
  manifest: pluginManifest,
  skillMarkdown: z.string(),
  /** Skill name -> raw SKILL.md body, one per entry in `manifest.skills`. */
  additionalSkills: z.record(z.string(), z.string()).optional(),
});

/** Backs "Import from URL…" in the Add member -> Agent screen's plugin picker. */
export const importInput = z.object({ workspaceId, url: z.string().url() });
export const importOutput = z.object({
  manifest: pluginManifest,
  skillMarkdown: z.string(),
  additionalSkills: z.record(z.string(), z.string()).optional(),
});
