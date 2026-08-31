import { z } from "zod";
import { agentConfig, agentMember, modelId, skillDoc, toolGrant, triggerConfig } from "./member.js";

export const PLUGIN_SCHEMA_URL = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
/** Namespace this perch instance writes perch-specific agent data under, per the spec's `extensions` escape hatch. */
export const PERCH_AGENT_EXTENSION_KEY = "dev.perch.agent";

export const pluginManifest = z.object({
  $schema: z.literal(PLUGIN_SCHEMA_URL),
  /** 1-64 chars, lowercase alphanumeric/hyphen/period, must start+end alphanumeric, no "--" or "..". */
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/)
    .refine((s) => !s.includes("--") && !s.includes(".."), "no consecutive hyphens or periods"),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z
    .object({ name: z.string().optional(), email: z.string().optional(), url: z.string().optional() })
    .optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  /** Names of additional skill folders this plugin carries beyond the implicit primary one
   * (named after `name` itself, at `skills/{name}/SKILL.md`) — e.g. `skills/foo/SKILL.md` for a
   * `"foo"` entry here. A portable-shape concern any conformant reader needs to discover what to
   * fetch, so it lives on the manifest itself rather than perch's private `extensions` block. */
  skills: z.array(z.string()).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
export type PluginManifest = z.infer<typeof pluginManifest>;

/**
 * Everything an AgentConfig carries that has no home in the portable plugin.json/SKILL.md shape,
 * stored under the `dev.perch.agent` extension key. `agentToPlugin` (a perch instance publishing
 * one of its own agents) writes every field; a hand-authored open-source plugin can set any
 * subset — most commonly just `tools`, to pre-select the tool grants its skill needs and leave
 * model / triggers / spend cap for the importing user to choose. Every field is therefore
 * optional, and `pluginToAgentDraft` fills each missing one from a conservative default.
 */
export const perchAgentExtension = z.object({
  handle: z.string().min(1).optional(),
  roleDescription: z.string().min(1).optional(),
  colorBg: z.string().optional(),
  colorFg: z.string().optional(),
  model: modelId.optional(),
  tools: z.array(toolGrant).optional(),
  triggers: z.array(triggerConfig).optional(),
  dailySpendCapUsd: z.number().positive().optional(),
});
export type PerchAgentExtension = z.infer<typeof perchAgentExtension>;

export const pluginIndexEntry = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  publishedAt: z.string().datetime(),
  publishedBy: z.string(),
});
export type PluginIndexEntry = z.infer<typeof pluginIndexEntry>;

export const pluginIndex = z.array(pluginIndexEntry);
export type PluginIndex = z.infer<typeof pluginIndex>;

function slugify(handle: string) {
  return handle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function skillMarkdownFor(name: string, description: string, body: string): string {
  return ["---", `name: ${name}`, `description: ${description}`, "---", "", body, ""].join("\n");
}

/**
 * Builds the plugin.json manifest + skills/<handle>/SKILL.md body for a perch agent, plus one
 * additional skills/<skill.name>/SKILL.md per entry in `agent.config.skills`. Throws if any skill's
 * name collides with the plugin's own name (the primary skill's own folder).
 */
export function agentToPlugin(
  agent: Pick<z.infer<typeof agentMember>, "handle" | "name" | "roleDescription" | "colorBg" | "colorFg" | "config">,
  opts?: { version?: string },
): { manifest: PluginManifest; skillMarkdown: string; additionalSkillMarkdown: Record<string, string> } {
  const name = slugify(agent.handle);

  const collision = agent.config.skills.find((s) => s.name === name);
  if (collision) throw new Error(`skill "${collision.name}" collides with this agent's own plugin name — rename it`);

  const extension: PerchAgentExtension = {
    handle: agent.handle,
    roleDescription: agent.roleDescription,
    colorBg: agent.colorBg,
    colorFg: agent.colorFg,
    model: agent.config.model,
    tools: agent.config.tools,
    triggers: agent.config.triggers,
    dailySpendCapUsd: agent.config.dailySpendCapUsd,
  };

  const manifest: PluginManifest = {
    $schema: PLUGIN_SCHEMA_URL,
    name,
    version: opts?.version ?? "1.0.0",
    description: agent.roleDescription,
    ...(agent.config.skills.length > 0 && { skills: agent.config.skills.map((s) => s.name) }),
    extensions: { [PERCH_AGENT_EXTENSION_KEY]: extension },
  };

  const skillMarkdown = skillMarkdownFor(name, agent.roleDescription, agent.config.instructions);
  const additionalSkillMarkdown: Record<string, string> = {};
  for (const skill of agent.config.skills) {
    additionalSkillMarkdown[skill.name] = skillMarkdownFor(skill.name, skill.description, skill.body);
  }

  return { manifest, skillMarkdown, additionalSkillMarkdown };
}

/** Fallback shape for a plugin published outside perch, with no `dev.perch.agent` extension block. */
const DEFAULT_MODEL: z.infer<typeof modelId> = "anthropic.claude-3-5-haiku-20241022-v1:0";
const DEFAULT_DAILY_SPEND_CAP_USD = 12;

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

/** Parses a `name:`/`description:` frontmatter field out of a SKILL.md body — used for additional
 * skills, which (unlike the primary one) have no other source for their name/description on
 * import. Falls back to the fallback name/description if the field is missing, rather than
 * throwing — matches this file's general "don't reject a plugin over a missing optional bit"
 * posture. */
function parseSkillMarkdown(skillMarkdown: string, fallbackName: string): z.infer<typeof skillDoc> {
  const match = skillMarkdown.match(FRONTMATTER);
  const frontmatter = match?.[1] ?? "";
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || fallbackName;
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() || fallbackName;
  const body = skillMarkdown.replace(FRONTMATTER, "").trim();
  return { name, description, body };
}

/**
 * Reverses agentToPlugin — parses SKILL.md frontmatter + body and merges with the perch extension
 * block when present. Any agent-plugins.org-compliant plugin still imports: fields the extension
 * block omits (or a plugin with no block at all — i.e. not published by a perch instance) fall
 * back to conservative defaults per field rather than throwing, which is what makes "install and
 * run any agent plugin" actually true. A plugin that sets only `extensions."dev.perch.agent".tools`
 * lands in the import screen with those grants pre-selected and everything else at its default for
 * the user to adjust.
 *
 * `additionalSkillMarkdown` (skill name -> raw SKILL.md body) covers every skill beyond the
 * primary one — see `manifest.skills` for which names to expect. Missing/empty is fine; not every
 * plugin has any.
 */
export function pluginToAgentDraft(manifest: PluginManifest, skillMarkdown: string, additionalSkillMarkdown: Record<string, string> = {}) {
  const parsed = perchAgentExtension.safeParse(manifest.extensions?.[PERCH_AGENT_EXTENSION_KEY]);
  const ext: PerchAgentExtension = parsed.success ? parsed.data : {};
  const instructions = skillMarkdown.replace(FRONTMATTER, "").trim();
  const skills = Object.entries(additionalSkillMarkdown).map(([name, md]) => parseSkillMarkdown(md, name));

  return {
    name: manifest.name,
    handle: ext.handle ?? slugify(manifest.name),
    roleDescription: ext.roleDescription ?? manifest.description ?? manifest.name,
    instructions,
    colorBg: ext.colorBg ?? "#e5e5e5",
    colorFg: ext.colorFg ?? "#111111",
    config: agentConfig.parse({
      instructions,
      model: ext.model ?? DEFAULT_MODEL,
      tools: ext.tools ?? [],
      triggers: ext.triggers ?? [{ kind: "mention", enabled: true }],
      dailySpendCapUsd: ext.dailySpendCapUsd ?? DEFAULT_DAILY_SPEND_CAP_USD,
      postsInChannelIds: [],
      skills,
    }),
  };
}
