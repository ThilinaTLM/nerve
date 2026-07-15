import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSuspiciousKey,
  isSuspiciousValue,
  redactStructuredValue,
  toolArgumentSource,
} from "./argument-source";

describe("ToolArgumentSource", () => {
  it("prefers exact arguments, then complete streamed JSON, then transcript previews", () => {
    const source = toolArgumentSource({
      args: { path: "exact.ts" },
      argsText: '{"path":"streamed.ts","limit":20}',
      argsPreview: { path: "preview.ts", query: "durable query" },
    });

    assert.equal(source.string("path"), "exact.ts");
    assert.equal(source.number("limit"), 20);
    assert.equal(source.string("query"), "durable query");
  });

  it("extracts bounded scalar values from malformed partial JSON", () => {
    const source = toolArgumentSource({
      argsText:
        '{"path":"src/app.ts","content":"one\\ntwo","dryRun":true,"limit":15,"unfinished":',
    });

    assert.equal(source.string("path"), "src/app.ts");
    assert.equal(source.string("content"), "one\ntwo");
    assert.equal(source.boolean("dryRun"), true);
    assert.equal(source.number("limit"), 15);
    assert.equal(source.value("unfinished"), undefined);
  });

  it("extracts nested labels from exact and partial orchestration inputs", () => {
    assert.deepEqual(
      toolArgumentSource({
        args: { tasks: [{ label: "UI" }, { label: "Server" }] },
      }).nestedStrings("label"),
      ["UI", "Server"],
    );
    assert.deepEqual(
      toolArgumentSource({
        argsText: '{"tasks":[{"label":"UI"},{"label":"Server',
      }).nestedStrings("label"),
      ["UI", "Server"],
    );
  });

  it("exposes environment key names without values", () => {
    const source = toolArgumentSource({
      args: {
        env: {
          API_TOKEN: "secret-token-value",
          SAFE_MODE: "1",
        },
      },
    });

    assert.deepEqual(source.objectKeys("env"), ["API_TOKEN", "SAFE_MODE"]);
    const entry = source.structuredEntries().find((item) => item.key === "env");
    assert.equal(entry?.value, "fields: API_TOKEN, SAFE_MODE");
    assert.equal(entry?.value.includes("secret-token-value"), false);
  });
});

describe("structured fallback redaction", () => {
  it("redacts suspicious keys and token-shaped scalar values", () => {
    assert.equal(isSuspiciousKey("api_token"), true);
    assert.equal(isSuspiciousKey("path"), false);
    assert.equal(isSuspiciousValue("Bearer abc.def.ghi"), true);
    assert.equal(redactStructuredValue("password", "hunter2"), "[redacted]");
    assert.equal(
      redactStructuredValue("value", "ghp_123456789012345678901234"),
      "[redacted]",
    );
  });

  it("never places secret-looking values in unknown structured entries", () => {
    const entries = toolArgumentSource({
      args: {
        path: "src/app.ts",
        authorization: "Bearer secret-token",
        token: "top-secret",
        nested: { password: "hidden", safe: "field" },
      },
    }).structuredEntries();
    const serialized = JSON.stringify(entries);

    assert.match(serialized, /src\/app\.ts/);
    assert.doesNotMatch(serialized, /secret-token|top-secret|hidden/);
    assert.match(serialized, /\[redacted\]/);
    assert.match(serialized, /fields: password, safe/);
  });
});
