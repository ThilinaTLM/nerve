import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionView } from "@nervekit/contracts/extensions";
import {
  extensionToolState,
  toolExtensionState,
  toolSettingsLink,
} from "./tool-extension-links";

const source = { layer: "user" as const };
function extension(
  id: string,
  options: {
    enabled?: boolean;
    field?: { key: string; kind: string; value?: string };
    availability?: ExtensionView["availability"];
    toolAvailability?: ExtensionView["toolAvailability"];
    kind?: string;
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
      permissions: {},
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
    accountKinds: options.kind
      ? [
          {
            kind: options.kind,
            label: "Account",
            fields: {},
            secret: { label: "Key" },
          },
        ]
      : [],
    enabled: { value: options.enabled ?? true, source },
    fields: field
      ? { [field.key]: { value: field.value, source, visible: true } }
      : {},
    stored: null,
    readOnly: false,
    locked: [],
    availability: options.availability ?? {},
    ...(options.toolAvailability
      ? { toolAvailability: options.toolAvailability }
      : {}),
  };
}
const accounts = {
  tavily: [{ id: "t1", name: "Tavily work" }],
  atlassian: [{ id: "a1", name: "Nerve Test" }],
};
const web = (
  enabled: boolean,
  value?: string,
  toolAvailability?: ExtensionView["toolAvailability"],
) =>
  extension("web", {
    enabled,
    field: { key: "searchAccount", kind: "tavily", value },
    availability: { web: { configured: enabled, available: true } },
    kind: "tavily",
    toolAvailability,
  });

describe("tool rows backed by extensions", () => {
  it("links the core tool that follows an extension and nothing else", () => {
    assert.deepEqual(toolSettingsLink("web_fetch"), { item: "web" });
    assert.deepEqual(toolSettingsLink("quick_script"), {});
    assert.equal(toolSettingsLink("web_search"), undefined);
    assert.equal(toolSettingsLink("bash"), undefined);
  });

  it("disables Web fetch when the Web extension is off", () => {
    const state = toolExtensionState("web_fetch", [web(false)], accounts);
    assert.equal(state?.disabled, true);
    assert.equal(state?.fix?.extensionId, "web");
    assert.equal(
      toolExtensionState("web_fetch", [web(true)], accounts),
      undefined,
    );
  });

  it("shows what the contributing extension says about its own tool", () => {
    const ready = {
      web_search: { configured: true, available: true as const },
    };
    assert.deepEqual(
      extensionToolState(
        "web_search",
        "web",
        [web(true, "t1", ready)],
        accounts,
      ),
      { summary: "web extension · Tavily work" },
    );
    const missing = {
      web_search: {
        configured: true,
        available: false as const,
        reason: "no Tavily account is selected.",
        fix: "Ask the user to choose one.",
      },
    };
    const problem = extensionToolState(
      "web_search",
      "web",
      [web(true, undefined, missing)],
      accounts,
    );
    assert.equal(problem?.problem, "No Tavily account is selected.");
    assert.equal(problem?.fix?.label, "Choose account");
    assert.equal(
      extensionToolState(
        "web_search",
        "web",
        [web(true, undefined, missing)],
        {},
      )?.fix?.label,
      "Add account",
    );
    const off = extensionToolState("web_search", "web", [web(false)], accounts);
    assert.equal(off?.disabled, true);
    assert.equal(
      extensionToolState("web_search", "gone", [web(true)], accounts),
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
