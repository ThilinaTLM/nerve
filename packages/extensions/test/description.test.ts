import assert from "node:assert/strict";
import test from "node:test";
import "./install.js";
import { quickScriptDescription } from "@nervekit/tools/quick-script/runtime/description";
import { builtinExtensions } from "../src/index.js";

const ALL = builtinExtensions.flatMap((extension) =>
  (extension.contributes.sdk ?? []).map((namespace) => namespace.id),
);

/** Description size cap (characters) with every namespace configured; raise it only on purpose. */
const MAX_DESCRIPTION_CHARS = 3_200;
/** Cap for one namespace's summary plus rules. */
const MAX_NAMESPACE_CHARS = 420;

void test("without extensions the description lists the runtime only", () => {
  const text = quickScriptDescription();
  assert.doesNotMatch(text, /jira|confluence|Write to Jira/);
  assert.match(text, /^Run a sandboxed TypeScript script/);
  assert.match(text, /Namespaces: files \([^)]*\); image \([^)]*\)\./);
  assert.match(
    text,
    /\nLibraries: XLSX, Papa, docx, mammoth, PptxGenJS, pptxText, JSZip\.\n/,
  );
  assert.match(text, /sdk\.describe\("<namespace>"\)/);
  assert.doesNotMatch(text, /\{\{/);
});

void test("namespaces appear in registry order, only when configured, with their rules", () => {
  const text = quickScriptDescription({
    namespaces: ["web", "jira", "atlassian"],
  });
  assert.match(text, /atlassian \([^)]*\); jira \([^)]*\); web \([^)]*\)\./);
  assert.match(
    text,
    /\natlassian: Write to Jira and Confluence only on explicit user request/,
  );
  assert.doesNotMatch(text, /confluence \(|diagram \(/);
  assert.match(text, /web: `web\.fetch` content can be up to 8 MiB/);
});

void test("the description is stable for one configuration and independent of availability", () => {
  assert.equal(
    quickScriptDescription({ namespaces: ["jira"] }),
    quickScriptDescription({ namespaces: ["jira"] }),
  );
  assert.doesNotMatch(
    quickScriptDescription({ namespaces: ALL }),
    /\d+ methods|unavailable/,
  );
});

void test("the full description stays under its size cap", () => {
  const text = quickScriptDescription({ namespaces: ALL });
  assert.ok(text.length <= MAX_DESCRIPTION_CHARS, `${text.length} characters`);
});

void test("each namespace contributes a short summary and at most three rules", () => {
  for (const extension of builtinExtensions)
    for (const namespace of extension.contributes.sdk ?? []) {
      const rules = namespace.rules ?? [];
      assert.ok(rules.length <= 3, `${namespace.id} has ${rules.length} rules`);
      const size = [namespace.summary, ...rules].join("").length;
      assert.ok(
        size <= MAX_NAMESPACE_CHARS,
        `${namespace.id}: ${size} characters`,
      );
    }
});
