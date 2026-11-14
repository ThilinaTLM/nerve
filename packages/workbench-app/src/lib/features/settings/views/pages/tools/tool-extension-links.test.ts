import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionView } from "@nervekit/contracts/extensions";
import { toolExtensionState, toolSettingsLink } from "./tool-extension-links";

const source = { layer: "user" as const };
function extension(
  id: string,
  options: {
    enabled?: boolean;
    field?: { key: string; kind: string; value?: string };
    availability?: ExtensionView["availability"];
  } = {},
): ExtensionView {
  const { field } = options;
  return {
    metadata: {
      id,
      name: id,
      description: id,
      icon: "globe",
      source: "builtin",
      settingsVersion: 1,
      enabledByDefault: false,
      contributes: { namespaces: [], tools: [], skills: [] },
    },
    settingsSchema: {
      fields: field
        ? {
            [field.key]: {
              type: "account",
              kind: field.kind,
              label: "Account",
            },
          }
        : {},
    },
    accountKinds: [],
    enabled: { value: options.enabled ?? true, source },
    fields: field
      ? { [field.key]: { value: field.value, source, visible: true } }
      : {},
    stored: null,
    readOnly: false,
    locked: [],
    availability: options.availability ?? {},
  };
}
const accounts = {
  tavily: [{ id: "t1", name: "Tavily work" }],
  atlassian: [{ id: "a1", name: "Nerve Test" }],
};
const web = (enabled: boolean, value?: string) =>
  extension("web", {
    enabled,
    field: { key: "searchAccount", kind: "tavily", value },
    availability: { web: { configured: enabled, available: true } },
  });

describe("tool rows backed by extensions", () => {
  it("links tools to their extension", () => {
    assert.deepEqual(toolSettingsLink("web_fetch"), { item: "web" });
    assert.deepEqual(toolSettingsLink("quick_script"), {});
    assert.equal(toolSettingsLink("bash"), undefined);
  });

  it("shows the Web extension source on Web search and disables both rows when it is off", () => {
    assert.deepEqual(
      toolExtensionState("web_search", [web(true, "t1")], accounts),
      { summary: "Web extension · Tavily work" },
    );
    assert.equal(
      toolExtensionState("web_search", [web(true)], accounts)?.fix?.label,
      "Choose account",
    );
    for (const id of ["web_search", "web_fetch"] as const) {
      const state = toolExtensionState(id, [web(false, "t1")], accounts);
      assert.equal(state?.disabled, true);
      assert.equal(state?.fix?.extensionId, "web");
    }
    assert.equal(
      toolExtensionState("web_fetch", [web(true)], accounts),
      undefined,
    );
  });

  it("lists Quick script namespaces and links an unusable one", () => {
    const ok = extension("diagram", {
      availability: { diagram: { configured: true, available: true } },
    });
    assert.equal(
      toolExtensionState("quick_script", [ok], accounts)?.summary,
      "files, image, diagram",
    );
    const broken = extension("atlassian", {
      availability: {
        jira: {
          configured: true,
          available: false,
          reason: "no Atlassian account is selected for Jira.",
          fix: "Ask",
        },
      },
    });
    const state = toolExtensionState("quick_script", [ok, broken], accounts);
    assert.equal(state?.problem, "No Atlassian account is selected for Jira.");
    assert.equal(state?.fix?.extensionId, "atlassian");
  });
});
