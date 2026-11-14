import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compileSettingsValidator,
  extensionsDocumentSchema,
  fieldValue,
  resolveExtensions,
  upgradeEntry,
  type ExtensionSettingsDefinition,
} from "../../src/domains/extensions/index.js";

const atlassian: ExtensionSettingsDefinition = {
  id: "atlassian",
  settingsVersion: 2,
  enabledByDefault: false,
  settings: {
    fields: {
      account: { type: "account", kind: "atlassian", label: "Account" },
      jira: { type: "boolean", label: "Jira", default: false },
      site: {
        type: "string",
        label: "Site",
        format: "url",
        default: "https://a.example/",
        scopes: ["user", "project"],
      },
      mode: {
        type: "enum",
        label: "Mode",
        default: "basic",
        options: [
          { value: "basic", label: "Basic" },
          { value: "pro", label: "Pro" },
        ],
      },
      proLevel: {
        type: "number",
        label: "Level",
        min: 1,
        max: 5,
        default: 1,
        visibleWhen: { field: "mode", equals: "pro" },
      },
    },
  },
  // v1 stored `enabledJira`.
  migrations: {
    2: (v1) => {
      const { enabledJira, ...rest } = v1;
      return { ...rest, jira: enabledJira };
    },
  },
};

describe("settings validator", () => {
  const validate = compileSettingsValidator(atlassian.settings);
  it("normalizes valid values and reports the rest per field", () => {
    const result = validate({
      account: " work ",
      site: "https://x.example/wiki",
      mode: "gold",
      proLevel: 9,
      extra: 1,
    });
    assert.deepEqual(result.value, {
      account: "work",
      site: "https://x.example/wiki/",
    });
    assert.deepEqual(
      result.issues.map((issue) => [issue.field, issue.code]),
      [
        ["mode", "invalid-value"],
        ["proLevel", "invalid-value"],
        ["extra", "unknown-field"],
      ],
    );
  });
  it("rejects URLs with credentials or queries", () => {
    assert.equal(validate({ site: "https://u:p@x.example/" }).issues.length, 1);
    assert.equal(validate({ site: "https://x.example/?a=1" }).issues.length, 1);
  });
});

describe("entry versions", () => {
  it("upgrades on read without touching the input", () => {
    const stored = { version: 1, settings: { enabledJira: true } };
    const result = upgradeEntry(atlassian, stored);
    assert.equal(result.status, "upgraded");
    assert.deepEqual(result.entry, { version: 2, settings: { jira: true } });
    assert.deepEqual(stored.settings, { enabledJira: true });
  });
  it("marks newer entries and failed upgrades", () => {
    assert.equal(upgradeEntry(atlassian, { version: 3 }).status, "newer");
    assert.equal(
      upgradeEntry(
        { ...atlassian, migrations: {} },
        { version: 1, settings: {} },
      ).status,
      "failed",
    );
  });
});

describe("envelope", () => {
  it("is strict", () => {
    const base = { schemaVersion: 1, revision: 0, extensions: {} };
    assert.ok(extensionsDocumentSchema.safeParse(base).success);
    assert.ok(
      !extensionsDocumentSchema.safeParse({ ...base, extra: 1 }).success,
    );
    assert.ok(
      !extensionsDocumentSchema.safeParse({
        ...base,
        extensions: { Bad_Id: { version: 1 } },
      }).success,
    );
  });
});

describe("resolution", () => {
  it("resolves per field with sources, nearest layer winning", () => {
    const { extensions, diagnostics } = resolveExtensions(
      [atlassian],
      [
        {
          layer: "user",
          entries: {
            atlassian: {
              version: 2,
              enabled: true,
              settings: { account: "a", jira: true },
            },
          },
        },
        {
          layer: "project",
          entries: { atlassian: { version: 2, settings: { account: "b" } } },
        },
        {
          layer: "profile",
          profile: "planning",
          locked: true,
          entries: { atlassian: { version: 2, settings: { jira: false } } },
        },
      ],
    );
    const resolved = extensions.atlassian!;
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(resolved.enabled, {
      value: true,
      source: { layer: "user" },
    });
    assert.deepEqual(resolved.fields.account, {
      value: "b",
      source: { layer: "project" },
      visible: true,
    });
    assert.deepEqual(resolved.fields.jira!.source, {
      layer: "profile",
      profile: "planning",
      locked: true,
    });
    assert.equal(resolved.fields.site!.source.layer, "default");
  });

  it("enforces field scopes and ignores invalid values, with diagnostics", () => {
    const { extensions, diagnostics } = resolveExtensions(
      [atlassian],
      [
        {
          layer: "conversation",
          entries: {
            atlassian: {
              version: 2,
              settings: { site: "https://c.example/", mode: "nope" },
            },
          },
        },
      ],
    );
    assert.equal(extensions.atlassian!.fields.site!.source.layer, "default");
    assert.deepEqual(diagnostics.map((d) => [d.code, d.field]).sort(), [
      ["invalid-value", "mode"],
      ["scope-not-allowed", "site"],
    ]);
  });

  it("upgrades old entries, ignores newer ones and keeps unknown extensions", () => {
    const { extensions, unknown, diagnostics } = resolveExtensions(
      [atlassian],
      [
        {
          layer: "user",
          entries: {
            atlassian: { version: 1, settings: { enabledJira: true } },
            future: { version: 1, settings: { a: 1 } },
          },
        },
        {
          layer: "project",
          entries: { atlassian: { version: 9, settings: { jira: false } } },
        },
      ],
    );
    assert.equal(extensions.atlassian!.fields.jira!.value, true);
    assert.deepEqual(extensions.atlassian!.readOnlyLayers, ["project"]);
    assert.deepEqual(
      unknown.map((entry) => entry.id),
      ["future"],
    );
    assert.deepEqual(diagnostics.map((d) => d.code).sort(), [
      "newer-version",
      "unknown-extension",
    ]);
  });

  it("hides fields whose visibleWhen is not met but keeps their value", () => {
    const { extensions } = resolveExtensions(
      [atlassian],
      [
        {
          layer: "user",
          entries: { atlassian: { version: 2, settings: { proLevel: 3 } } },
        },
      ],
    );
    const resolved = extensions.atlassian!;
    assert.equal(resolved.fields.proLevel!.value, 3);
    assert.equal(resolved.fields.proLevel!.visible, false);
    assert.equal(fieldValue(resolved, "proLevel"), undefined);
  });
});
