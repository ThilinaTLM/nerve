import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { krokiToolSettingsSchema } from "../../src/domains/settings/index.js";

describe("Kroki configuration", () => {
  it("normalizes public and private endpoints without losing path prefixes", () => {
    for (const [input, expected] of [
      [" https://kroki.io ", "https://kroki.io/"],
      ["http://127.0.0.1:9080/kroki", "http://127.0.0.1:9080/kroki/"],
      ["https://example.org/kroki/", "https://example.org/kroki/"],
    ])
      assert.equal(krokiToolSettingsSchema.parse({ url: input }).url, expected);
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
});
