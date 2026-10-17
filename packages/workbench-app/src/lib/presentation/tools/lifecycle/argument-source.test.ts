import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSuspiciousKey,
  isSuspiciousValue,
  redactStructuredValue,
  toolArgumentSource,
  ToolArgumentSource,
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

  it("projects object-array entries from incomplete streamed JSON", () => {
    const sources = toolArgumentSource({
      argsText:
        '{"tasks":[{"task":"Inspect {server}","label":"Server"},{"task":"Review UI","label":"Cli',
    }).objectArraySources("tasks");

    assert.equal(sources.length, 2);
    assert.equal(sources[0]?.string("task"), "Inspect {server}");
    assert.equal(sources[0]?.string("label"), "Server");
    assert.equal(sources[1]?.string("task"), "Review UI");
    assert.equal(sources[1]?.string("label"), "Cli");
  });

  it("does not split partial objects on escaped quotes or nested braces", () => {
    const sources = toolArgumentSource({
      argsText:
        '{"tasks":[{"task":"Inspect \\"quoted\\" {text}","context":{"note":"}"}},{"task":"Second',
    }).objectArraySources("tasks");

    assert.equal(sources.length, 2);
    assert.equal(sources[0]?.string("task"), 'Inspect "quoted" {text}');
    assert.equal(sources[1]?.string("task"), "Second");
  });

  it("prefers exact object arrays over streamed fragments", () => {
    const sources = toolArgumentSource({
      args: { tasks: [{ task: "Exact A" }, { task: "Exact B" }] },
      argsText: '{"tasks":[{"task":"Partial',
    }).objectArraySources("tasks");

    assert.deepEqual(
      sources.map((source) => source.string("task")),
      ["Exact A", "Exact B"],
    );
  });

  it("decodes escapes and withholds incomplete Unicode units safely", () => {
    for (const [raw, expected] of [
      [String.raw`a\"b\\c\n\t\u00e9`, 'a"b\\c\n\té'],
      ["ok\\", "ok"],
      [String.raw`ok\u00`, "ok"],
      [String.raw`ok\ud83d`, "ok"],
      [String.raw`ok\ud83d\ude`, "ok"],
      [String.raw`ok\ud83d\ude00`, "ok😀"],
      ["ok\ud83d", "ok"],
      ["ok😀", "ok😀"],
    ]) {
      const source = toolArgumentSource({ argsText: '{"content":"' + raw });
      assert.equal(source.string("content"), expected);
      assert.equal(
        source.stringMetrics("content")?.bytes,
        new TextEncoder().encode(expected).length,
      );
    }
  });

  it("bounds partial suffixes without losing full byte and line counts", () => {
    const content = "é\n".repeat(20_000) + "😀END";
    const source = toolArgumentSource({
      argsText: JSON.stringify({ content }).slice(0, -2),
    });
    assert.ok((source.string("content")?.length ?? Infinity) <= 24_000);
    assert.ok(source.string("content")?.endsWith("😀END"));
    assert.deepEqual(source.stringMetrics("content"), {
      lines: 20_001,
      bytes: 60_007,
    });
  });

  it("keeps partial decoding tied to the captured input across accessors", () => {
    const input = { argsText: '{"content":"é\\n😀' };
    const source = toolArgumentSource(input);
    assert.equal(source.string("content"), "é\n😀");
    input.argsText = '{"content":"new';
    assert.deepEqual(source.stringMetrics("content"), { lines: 2, bytes: 7 });
    assert.deepEqual(source.strings("content"), ["é\n😀"]);
    assert.deepEqual(source.nestedStrings("content"), ["é\n😀"]);
    assert.equal(source.structuredEntries()[0]?.value, "é\n😀");
    assert.equal(toolArgumentSource(input).string("content"), "new");
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

describe("streaming string arrays", () => {
  it("retains complete names and the open final name, decoding escapes", () => {
    const source = new ToolArgumentSource({
      argsText: '{"names":["first","seco',
    });
    assert.deepEqual(source.strings("names"), ["first", "seco"]);
    const escaped = new ToolArgumentSource({
      argsText: String.raw`{"names":["a\"b","c\u00e9`,
    });
    assert.deepEqual(escaped.strings("names"), ['a"b', "cé"]);
  });
});
