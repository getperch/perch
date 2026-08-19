import { z } from "zod";
import { agentConfig, agentMember, modelId, skillDoc, toolGrant, triggerConfig } from "./member.js";

export const PLUGIN_SCHEMA_URL = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
/** Namespace this fizz instance writes fizz-specific agent data under, per the spec's `extensions` escape hatch. */
export const FIZZ_AGENT_EXTENSION_KEY = "org.fizz.agent";

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
   * fetch, so it lives on the manifest itself rather than fizz's private `extensions` block. */
  skills: z.array(z.string()).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
export type PluginManifest = z.infer<typeof pluginManifest>;

/** Everything an AgentConfig carries that has no home in the portable plugin.json/SKILL.md shape. */
export const fizzAgentExtension = z.object({
  handle: z.string().min(1),
  roleDescription: z.string().min(1),
  colorBg: z.string(),
  colorFg: z.string(),
  model: modelId,
  tools: z.array(toolGrant),
  triggers: z.array(triggerConfig),
  dailySpendCapUsd: z.number().positive(),
});
export type FizzAgentExtension = z.infer<typeof fizzAgentExtension>;

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
 * Builds the plugin.json manifest + skills/<handle>/SKILL.md body for a fizz agent, plus one
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

  const extension: FizzAgentExtension = {
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
    extensions: { [FIZZ_AGENT_EXTENSION_KEY]: extension },
  };

  const skillMarkdown = skillMarkdownFor(name, agent.roleDescription, agent.config.instructions);
  const additionalSkillMarkdown: Record<string, string> = {};
  for (const skill of agent.config.skills) {
    additionalSkillMarkdown[skill.name] = skillMarkdownFor(skill.name, skill.description, skill.body);
  }

  return { manifest, skillMarkdown, additionalSkillMarkdown };
}

/** Fallback shape for a plugin published outside fizz, with no `org.fizz.agent` extension block. */
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
 * Reverses agentToPlugin — parses SKILL.md frontmatter + body and merges with the fizz extension
 * block when present. Any agent-plugins.org-compliant plugin lacking that block (i.e. not
 * published by a fizz instance) still imports, falling back to conservative defaults instead of
 * throwing — this is what makes "install and run any agent plugin" actually true.
 *
 * `additionalSkillMarkdown` (skill name -> raw SKILL.md body) covers every skill beyond the
 * primary one — see `manifest.skills` for which names to expect. Missing/empty is fine; not every
 * plugin has any.
 */
export function pluginToAgentDraft(manifest: PluginManifest, skillMarkdown: string, additionalSkillMarkdown: Record<string, string> = {}) {
  const extensionRaw = manifest.extensions?.[FIZZ_AGENT_EXTENSION_KEY];
  const parsed = fizzAgentExtension.safeParse(extensionRaw);
  const instructions = skillMarkdown.replace(FRONTMATTER, "").trim();
  const skills = Object.entries(additionalSkillMarkdown).map(([name, md]) => parseSkillMarkdown(md, name));

  const extension: FizzAgentExtension = parsed.success
    ? parsed.data
    : {
        handle: slugify(manifest.name),
        roleDescription: manifest.description ?? manifest.name,
        colorBg: "#e5e5e5",
        colorFg: "#111111",
        model: DEFAULT_MODEL,
        tools: [],
        triggers: [{ kind: "mention", enabled: true }],
        dailySpendCapUsd: DEFAULT_DAILY_SPEND_CAP_USD,
      };

  return {
    name: manifest.name,
    handle: extension.handle,
    roleDescription: extension.roleDescription,
    instructions,
    colorBg: extension.colorBg,
    colorFg: extension.colorFg,
    config: agentConfig.parse({
      instructions,
      model: extension.model,
      tools: extension.tools,
      triggers: extension.triggers,
      dailySpendCapUsd: extension.dailySpendCapUsd,
      postsInChannelIds: [],
      skills,
    }),
  };
}
