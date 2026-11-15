import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionView } from "@nervekit/contracts/extensions";
import {
  activeNamespaces,
  controlFor,
  detailLayout,
  helperNote,
  entryWithEnabled,
  entryWithSetting,
  extensionChanges,
  extensionFix,
  extensionProblem,
  extensionSummary,
  fieldSections,
  namespaceProblem,
  parseNumberInput,
  type AccountChoices,
} from "./extensions-view";

const accounts: AccountChoices = {
  atlassian: [{ id: "a1", name: "Nerve Test" }],
  tavily: [],
};

const source = { layer: "user" as const };
function atlassian(patch: Partial<ExtensionView> = {}): ExtensionView {
  return {
    metadata: {
      id: "atlassian",
      name: "Atlassian",
      description: "Jira and Confluence through one Atlassian account.",
      icon: { type: "lucide", name: "layers" },
      source: "builtin",
      settingsVersion: 1,
      enabledByDefault: false,
      permissions: {},
      contributes: {
        namespaces: [
          { id: "atlassian", helper: true, summary: "site" },
          {
            id: "jira",
            enabledBy: "jira",
            requiresAccount: "account",
            summary: "Issues",
          },
          {
            id: "confluence",
            enabledBy: "confluence",
            requiresAccount: "account",
            summary: "Pages",
          },
        ],
        tools: [],
        skills: [],
      },
    },
    settingsSchema: {
      sections: [{ id: "extra", title: "Extra" }],
      fields: {
        account: {
          type: "account",
          kind: "atlassian",
          label: "Account",
        },
        jira: { type: "boolean", label: "Jira", default: false },
        confluence: { type: "boolean", label: "Confluence", default: false },
        project: {
          type: "string",
          label: "Project",
          section: "extra",
          advanced: true,
          scopes: ["user"],
        },
        hidden: {
          type: "string",
          label: "Hidden",
          visibleWhen: { field: "jira", equals: true },
        },
      },
    },
    accountKinds: [
      {
        kind: "atlassian",
        label: "Atlassian account",
        fields: {},
        secret: { label: "API token" },
      },
    ],
    enabled: { value: true, source },
    fields: {
      account: { value: "a1", source, visible: true },
      jira: { value: true, source, visible: true },
      confluence: { value: true, source, visible: true },
      project: { value: "NRV", source, visible: true },
      hidden: { value: "x", source, visible: false },
    },
    stored: null,
    readOnly: false,
    locked: [],
    availability: {
      jira: { configured: true, available: true },
      confluence: { configured: true, available: true },
    },
    ...patch,
  };
}

describe("extension summary and availability", () => {
  it("lists the account and the switched-on products, never On or Off", () => {
    assert.equal(
      extensionSummary(atlassian(), accounts),
      "Nerve Test · Jira, Confluence",
    );
  });

  it("falls back to the description when nothing is set up", () => {
    const empty = atlassian({
      fields: {
        account: { value: undefined, source, visible: true },
        jira: { value: false, source, visible: true },
        confluence: { value: false, source, visible: true },
        project: { value: undefined, source, visible: true },
        hidden: { value: undefined, source, visible: false },
      },
    });
    assert.equal(
      extensionSummary(empty, accounts),
      "Jira and Confluence through one Atlassian account.",
    );
  });

  it("reports the agent's reason only when enabled and unavailable", () => {
    const broken = atlassian({
      availability: {
        jira: {
          configured: true,
          available: false,
          reason: "no Atlassian account is selected for Jira.",
          fix: "Ask the user",
        },
        confluence: { configured: false, available: true },
      },
    });
    assert.equal(
      extensionProblem(broken),
      "No Atlassian account is selected for Jira.",
    );
    assert.equal(
      extensionProblem({
        ...broken,
        enabled: { value: false, source },
      }),
      undefined,
    );
    assert.deepEqual(extensionFix(broken, { atlassian: [] }), {
      label: "Add account",
      section: "accounts",
    });
    assert.deepEqual(extensionFix(broken, accounts), {
      label: "Choose account",
      section: "settings",
    });
    assert.equal(extensionFix(atlassian(), accounts), undefined);
  });

  it("derives the fix from the failing namespace's account field", () => {
    const base = atlassian();
    const two = atlassian({
      metadata: {
        ...base.metadata,
        contributes: {
          ...base.metadata.contributes,
          namespaces: [
            { id: "other", requiresAccount: "other", summary: "x" },
            ...base.metadata.contributes.namespaces,
          ],
        },
      },
      settingsSchema: {
        fields: {
          ...base.settingsSchema.fields,
          other: { type: "account", kind: "tavily", label: "Other" },
        },
      },
      availability: {
        other: {
          configured: true,
          available: false,
          reason: "no account.",
          fix: "Ask",
        },
      },
    });
    // The first account kind (atlassian) has accounts; the failing one (tavily) has none.
    assert.deepEqual(
      extensionFix(two, { atlassian: [{ id: "a", name: "A" }], tavily: [] }),
      { label: "Add account", section: "accounts" },
    );
    assert.deepEqual(
      extensionFix(two, { atlassian: [], tavily: [{ id: "t", name: "T" }] }),
      { label: "Choose account", section: "settings" },
    );
  });

  it("lists active namespaces and finds the first unusable one", () => {
    const off = atlassian({
      metadata: {
        ...atlassian().metadata,
        contributes: {
          namespaces: [
            { id: "atlassian", helper: true, summary: "site" },
            { id: "storage", helper: true, summary: "builders" },
          ],
          tools: [],
          skills: [],
        },
      },
      availability: {
        atlassian: { configured: true, available: true },
        jira: { configured: true, available: true },
        confluence: { configured: false, available: true },
        storage: { configured: false, available: true },
      },
    });
    assert.deepEqual(activeNamespaces([off]), ["files", "image", "jira"]);
    assert.deepEqual(
      activeNamespaces([{ ...off, enabled: { value: false, source } }]),
      ["files", "image"],
    );
    const broken = atlassian({
      availability: {
        confluence: {
          configured: true,
          available: false,
          reason: "the token is missing.",
          fix: "Ask",
        },
      },
    });
    assert.deepEqual(namespaceProblem([off, broken]), {
      extensionId: "atlassian",
      namespace: "confluence",
      text: "The token is missing.",
    });
  });
});

describe("schema to controls", () => {
  it("maps field types to controls", () => {
    const fields = atlassian().settingsSchema.fields;
    assert.equal(controlFor(fields.account!), "account");
    assert.equal(controlFor(fields.jira!), "switch");
    assert.equal(controlFor(fields.project!), "input");
    assert.equal(
      controlFor({ type: "string", label: "u", format: "url" }),
      "url",
    );
    assert.equal(controlFor({ type: "number", label: "n" }), "number");
    assert.equal(
      controlFor({
        type: "enum",
        label: "e",
        default: "a",
        options: [{ value: "a", label: "A" }],
      }),
      "select",
    );
    assert.equal(controlFor({ type: "model", label: "m" }), "model");
  });

  it("groups visible fields by section and splits advanced ones", () => {
    const sections = fieldSections(atlassian(), "user");
    assert.deepEqual(
      sections.map((s) => [
        s.id,
        s.fields.map((f) => f.key),
        s.advanced.length,
      ]),
      [
        ["settings", ["account", "jira", "confluence"], 0],
        ["extra", [], 1],
      ],
    );
  });

  it("shows fields the scope cannot set read-only with the reason", () => {
    const [, extra] = fieldSections(atlassian(), "project");
    assert.equal(extra!.advanced[0]!.editable, false);
    assert.equal(
      extra!.advanced[0]!.readOnlyReason,
      "Set in your user settings",
    );
    const locked = atlassian({
      fields: {
        ...atlassian().fields,
        jira: {
          value: true,
          source: { layer: "profile", profile: "Planning", locked: true },
          visible: true,
        },
      },
    });
    const jira = fieldSections(locked, "user")[0]!.fields[1]!;
    assert.equal(jira.editable, false);
    assert.equal(jira.readOnlyReason, "Locked by Planning");
  });
});

describe("changes against the inherited value", () => {
  const stored = (settings: Record<string, unknown>, enabled?: boolean) =>
    atlassian({
      stored: { ...(enabled !== undefined ? { enabled } : {}), settings },
    });

  it("compares a user value with the schema default", () => {
    assert.deepEqual(
      extensionChanges(stored({ jira: true }), "user", accounts),
      [{ key: "jira", label: "Jira", from: "Off", to: "On" }],
    );
    assert.deepEqual(
      extensionChanges(stored({ jira: false }), "user", accounts),
      [],
    );
  });

  it("compares the user's enable switch with the extension default", () => {
    assert.deepEqual(extensionChanges(stored({}, true), "user", accounts), [
      { key: "enabled", label: "Enabled", from: "Off", to: "On" },
    ]);
    assert.deepEqual(extensionChanges(stored({}, false), "user", accounts), []);
  });

  it("compares a project value with the user's resolved value", () => {
    const user = atlassian();
    assert.deepEqual(
      extensionChanges(
        stored({ jira: true, account: "a1" }, false),
        "project",
        accounts,
        user,
      ),
      [{ key: "enabled", label: "Enabled", from: "On", to: "Off" }],
    );
    assert.deepEqual(
      extensionChanges(stored({ jira: false }), "project", accounts, user),
      [{ key: "jira", label: "Jira", from: "On", to: "Off" }],
    );
  });
});

describe("entry edits", () => {
  it("sets and clears one setting while keeping the rest of the entry", () => {
    const view = atlassian({
      stored: { enabled: true, settings: { jira: true } },
    });
    assert.deepEqual(entryWithSetting(view, "account", "a1"), {
      enabled: true,
      settings: { jira: true, account: "a1" },
    });
    assert.deepEqual(entryWithSetting(view, "jira", undefined), {
      enabled: true,
      settings: {},
    });
    assert.deepEqual(entryWithEnabled(atlassian(), false), {
      enabled: false,
      settings: {},
    });
  });

  it("parses number input", () => {
    assert.equal(parseNumberInput(" 12 "), 12);
    assert.equal(parseNumberInput(""), undefined);
    assert.equal(parseNumberInput("x"), "invalid");
  });
});

describe("detail layout", () => {
  const keys = (view: ExtensionView) =>
    detailLayout(view, "user").sections.flatMap((section) => [
      ...section.fields.map((item) => item.key),
      ...section.advanced.map((item) => item.key),
    ]);
  const withSchema = (
    fields: ExtensionView["settingsSchema"]["fields"],
    namespaces: ExtensionView["metadata"]["contributes"]["namespaces"],
    values: Record<string, unknown> = {},
  ) => {
    const base = atlassian();
    return atlassian({
      metadata: {
        ...base.metadata,
        contributes: { namespaces, tools: [], skills: [] },
      },
      settingsSchema: { fields },
      fields: Object.fromEntries(
        Object.keys(fields).map((key) => [
          key,
          { value: values[key] ?? false, source, visible: true },
        ]),
      ),
      availability: {},
    });
  };

  it("moves a switch onto its namespace row and leaves Settings", () => {
    const layout = detailLayout(atlassian(), "user");
    assert.deepEqual(keys(atlassian()), ["account", "project"]);
    assert.deepEqual(
      layout.features.map((row) => [row.id, row.control.type]),
      [
        ["jira", "switch"],
        ["confluence", "switch"],
      ],
    );
    assert.deepEqual(layout.helpers, ["atlassian"]);
    assert.equal(
      helperNote(["atlassian", "storage"]),
      "Also loads helper namespaces: atlassian, storage",
    );
    assert.equal(helperNote([]), undefined);
  });

  it("keeps a switch in Settings when it is shared, listed in an array, or placed on purpose", () => {
    const shared = withSchema(
      { a: { type: "boolean", label: "A", default: false } },
      [
        { id: "x", enabledBy: "a", summary: "x" },
        { id: "y", enabledBy: "a", summary: "y" },
      ],
    );
    assert.deepEqual(keys(shared), ["a"]);
    const array = withSchema(
      { a: { type: "boolean", label: "A", default: false } },
      [
        { id: "x", enabledBy: "a", summary: "x" },
        { id: "y", enabledBy: ["a", "b"], summary: "y" },
      ],
    );
    assert.deepEqual(keys(array), ["a"]);
    assert.equal(
      detailLayout(array, "user").features[1]!.control.type,
      "setting",
    );
    for (const extra of [
      { section: "s" },
      { advanced: true },
      { visibleWhen: { field: "b", equals: true } },
    ]) {
      const placed = withSchema(
        { a: { type: "boolean", label: "A", default: false, ...extra } },
        [{ id: "x", enabledBy: "a", summary: "x" }],
      );
      const row = detailLayout(placed, "user").features[0]!;
      assert.equal(row.control.type, "setting");
      assert.ok(keys(placed).includes("a"));
    }
  });

  it("shows state for namespaces that follow the extension or keep their switch in Settings", () => {
    const view = withSchema(
      { a: { type: "boolean", label: "A", default: false, advanced: true } },
      [
        { id: "x", summary: "x" },
        { id: "y", enabledBy: "a", summary: "y" },
      ],
      { a: true },
    );
    const [follows, setting] = detailLayout(view, "user").features;
    assert.deepEqual(follows!.control, { type: "follows" });
    assert.deepEqual(setting!.control, {
      type: "setting",
      on: true,
      sectionId: "settings",
      advanced: true,
    });
  });

  it("omits helpers from the rows and reports reasons only when configured but unavailable", () => {
    const view = atlassian({
      availability: {
        jira: {
          configured: true,
          available: false,
          reason: "needs an account.",
          fix: "Ask",
        },
        confluence: { configured: true, available: true },
      },
    });
    const features = detailLayout(view, "user").features;
    assert.deepEqual(
      features.map((row) => row.id),
      ["jira", "confluence"],
    );
    assert.equal(features[0]!.problem, "Needs an account.");
    assert.equal(features[1]!.problem, undefined);
  });
});
