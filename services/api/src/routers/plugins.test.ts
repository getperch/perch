import { describe, expect, it } from "vitest";
import { resolvePluginManifestUrl } from "./plugins.js";

describe("resolvePluginManifestUrl", () => {
  it("maps a GitHub folder page to the raw plugin.json", () => {
    expect(resolvePluginManifestUrl("https://github.com/getperch/agents/tree/main/research-agent").toString()).toBe(
      "https://raw.githubusercontent.com/getperch/agents/main/research-agent/plugin.json",
    );
  });

  it("maps a bare GitHub repo to the default branch via HEAD", () => {
    expect(resolvePluginManifestUrl("https://github.com/getperch/agents").toString()).toBe(
      "https://raw.githubusercontent.com/getperch/agents/HEAD/plugin.json",
    );
  });

  it("maps a /tree/<ref> with no path to the repo root", () => {
    expect(resolvePluginManifestUrl("https://github.com/o/r/tree/dev").toString()).toBe(
      "https://raw.githubusercontent.com/o/r/dev/plugin.json",
    );
  });

  it("uses a /blob/ link straight through when it already names the manifest", () => {
    expect(resolvePluginManifestUrl("https://github.com/o/r/blob/main/a/plugin.json").toString()).toBe(
      "https://raw.githubusercontent.com/o/r/main/a/plugin.json",
    );
  });

  it("normalizes the scheme and www host", () => {
    expect(resolvePluginManifestUrl("http://www.github.com/o/r/tree/main/x").toString()).toBe(
      "https://raw.githubusercontent.com/o/r/main/x/plugin.json",
    );
  });

  it("passes a direct raw plugin.json through unchanged", () => {
    const raw = "https://raw.githubusercontent.com/o/r/main/x/plugin.json";
    expect(resolvePluginManifestUrl(raw).toString()).toBe(raw);
  });

  it("treats a non-GitHub directory URL as holding plugin.json", () => {
    expect(resolvePluginManifestUrl("https://plugins.example.com/my-agent").toString()).toBe(
      "https://plugins.example.com/my-agent/plugin.json",
    );
  });

  it("rejects a non-repo GitHub URL", () => {
    expect(() => resolvePluginManifestUrl("https://github.com/getperch")).toThrow(/GitHub URL/);
  });

  it("rejects a GitHub URL that is neither tree nor blob", () => {
    expect(() => resolvePluginManifestUrl("https://github.com/o/r/releases/tag/v1")).toThrow(/releases/);
  });

  it("rejects a non-URL", () => {
    expect(() => resolvePluginManifestUrl("not a url")).toThrow(/not a valid URL/);
  });
});
