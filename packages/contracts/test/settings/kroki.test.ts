import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultSettings,
  krokiToolSettingsSchema,
} from "../../src/domains/settings/index.js";
import { krokiExportResultDetailsSchema } from "../../src/domains/tools/kroki.js";
import { resolveAgentConfiguration } from "../../src/domains/agent-configuration/resolver.js";
import { leadSettingsOverridesSchema } from "../../src/domains/agent-configuration/schemas.js";

describe("Kroki configuration", () => {
  it("normalizes public and private endpoints without losing path prefixes", () => {
    for (const [input, expected] of [
      [" https://kroki.io ", "https://kroki.io/"],
      ["http://127.0.0.1:9080/kroki", "http://127.0.0.1:9080/kroki/"],
      ["https://example.org/kroki/", "https://example.org/kroki/"],
    ])
      assert.equal(krokiToolSettingsSchema.parse({ url: input }).url, expected);
    assert.ok(defaultSettings.tools.disabled.includes("kroki_export"));
    assert.equal(
      resolveAgentConfiguration({ role: "lead" }).settings.tools?.kroki_export
        ?.enabled,
      false,
    );
    assert.deepEqual(
      leadSettingsOverridesSchema.parse({
        tools: { kroki_export: { settings: { url: "https://example.org" } } },
      }),
      {
        tools: { kroki_export: { settings: { url: "https://example.org/" } } },
      },
    );
  });
  it("rejects credentials, queries, fragments, non-HTTP and invalid URLs", () => {
    for (const url of [
      "",
      "not a URL",
      "/kroki",
      "file:///tmp/kroki",
      "ftp://example.org",
      "https://user:password@example.org",
      "https://example.org/?token=x",
      "https://example.org/#svg",
      `https://example.org/${"a".repeat(2_048)}`,
    ]) {
      assert.equal(
        krokiToolSettingsSchema.safeParse({ url }).success,
        false,
        url,
      );
    }
  });
  it("rejects malformed or mismatched export details", () => {
    const details = {
      diagramType: "graphviz",
      outputFormat: "svg",
      path: "/tmp/diagram.svg",
      filename: "diagram.svg",
      mediaType: "image/svg+xml",
      bytes: 32,
    };
    assert.ok(krokiExportResultDetailsSchema.safeParse(details).success);
    for (const override of [
      { outputFormat: "pdf" },
      { diagramType: "../mermaid" },
      { path: "" },
      { bytes: 0 },
      { mediaType: "image/png" },
    ]) {
      assert.equal(
        krokiExportResultDetailsSchema.safeParse({ ...details, ...override })
          .success,
        false,
      );
    }
  });
});
