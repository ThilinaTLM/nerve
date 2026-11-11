import assert from "node:assert/strict";
import { test } from "node:test";
import { withMermaidDefaults } from "./diagram-methods.js";

void test("mermaid pie charts get a high-contrast palette unless they bring their own config", () => {
  const pie = withMermaidDefaults("mermaid", 'pie title X\n  "a": 1');
  assert.match(pie, /^%%\{init: .*"pie1": "#2563eb".*"pie8"/);
  assert.ok(pie.endsWith('pie title X\n  "a": 1'));
  assert.match(
    withMermaidDefaults("mermaid", '%% note\npie\n  "a": 1'),
    /^%%\{init/,
  );
  const own = '%%{init: {"theme": "dark"}}%%\npie\n"a": 1';
  assert.equal(withMermaidDefaults("mermaid", own), own);
  assert.equal(
    withMermaidDefaults("mermaid", "graph TD; A-->B"),
    "graph TD; A-->B",
  );
  assert.equal(withMermaidDefaults("d2", "pie"), "pie");
});
