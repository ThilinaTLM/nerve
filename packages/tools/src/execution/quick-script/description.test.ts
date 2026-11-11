import assert from "node:assert/strict";
import test from "node:test";
import { quickScriptDescription } from "./description.js";

void test("without integrations the description lists only utilities", () => {
  const text = quickScriptDescription();
  assert.doesNotMatch(
    text,
    /Integrations:|jira|confluence|Write to integrations/,
  );
  assert.match(text, /^Run a sandboxed TypeScript script/);
  assert.match(
    text,
    /\nUtilities: files, XLSX, Papa, docx \+ mammoth \(Word\), PptxGenJS \+ pptxText \(PowerPoint\), image, diagram \(Kroki\)\.\n/,
  );
  assert.match(text, /Read \{\{skill:quick-script\}\} before first use\.$/);
});

void test("integration fragments appear in fixed order, only when active", () => {
  const both = quickScriptDescription({
    integrations: ["confluence", "jira"],
  });
  assert.match(both, /Integrations: jira \([^)]*\), confluence \([^)]*\)\./);
  assert.match(both, /Write to integrations only on explicit user request\./);
  const jiraOnly = quickScriptDescription({ integrations: ["jira"] });
  assert.doesNotMatch(jiraOnly, /confluence/);
});

void test("web lists search only with a Tavily account, and alone does not announce writes", () => {
  const fetchOnly = quickScriptDescription({ integrations: ["web"] });
  assert.match(fetchOnly, /Integrations: web \(fetch\)\./);
  assert.doesNotMatch(fetchOnly, /Write to integrations/);
  const withSearch = quickScriptDescription({
    integrations: ["web", "web.search"],
  });
  assert.match(withSearch, /Integrations: web \(fetch, search\)\./);
  assert.doesNotMatch(
    quickScriptDescription({ integrations: ["web.search"] }),
    /web/,
  );
});
