import "./install.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DISCOVERY_BUDGET_CHARS } from "@nervekit/tools/quick-script/runtime/discovery";
import type { QuickScriptAvailability } from "@nervekit/tools/quick-script/manifest-types";
import {
  createSdkEnvironment,
  findSdkMethod,
} from "@nervekit/tools/quick-script/runtime/sdk";

const namespaces: QuickScriptAvailability = {
  atlassian: { configured: true, available: true },
  jira: { configured: true, available: true },
  confluence: {
    configured: true,
    available: false,
    reason: "no Atlassian account is selected for Confluence.",
    fix: "Ask the user to choose an Atlassian account in Settings → Extensions → Atlassian.",
  },
  storage: {
    configured: false,
    available: false,
    reason: "off",
    fix: "enable",
  },
  web: {
    configured: false,
    available: false,
    reason: "Web is switched off for quick_script.",
    fix: "Ask the user to enable Web.",
  },
  diagram: { configured: true, available: true },
};

function session(conversationDir?: string) {
  const env = createSdkEnvironment({
    cwd: process.cwd(),
    conversationDir,
    namespaces,
  });
  return async (method: string, ...args: unknown[]) =>
    String(await findSdkMethod(method)!.prepare(args, env).run(env));
}

void test("sdk methods have risk none and need no authorization", () => {
  for (const name of ["list", "describe", "search", "docs"]) {
    const method = findSdkMethod(`sdk.${name}`)!;
    assert.equal(method.risk, "none");
  }
});

void test("list reports availability with reason and fix", async () => {
  const text = await session()("sdk.list");
  assert.match(
    text,
    /^- jira \(Atlassian extension; \d+ methods; docs: jira\/workflows, jira\/raw\)/m,
  );
  assert.match(text, /^- confluence \(Atlassian extension; unavailable;/m);
  assert.match(
    text,
    /reason: no Atlassian account is selected for Confluence\./,
  );
  assert.match(text, /fix: Ask the user to choose an Atlassian account/);
  assert.match(text, /^- files \(built-in;/m);
  assert.match(text, /^- libraries \(built-in;/m);
});

void test("describe serves a group, a method and unavailable namespaces", async () => {
  const call = session();
  const group = await call("sdk.describe", "jira.issues");
  assert.match(group, /declare const jira: \{\n {2}issues: \{/);
  assert.doesNotMatch(group, /sprints:/);
  assert.match(group, /interface Issue\b/);
  const method = await call("sdk.describe", "jira.issues.get");
  assert.match(method, /get\(/);
  assert.doesNotMatch(method, /search\(/);
  const off = await call("sdk.describe", "confluence");
  assert.match(off, /^confluence is unavailable: no Atlassian account/);
  assert.match(off, /Fix: /);
  await assert.rejects(call("sdk.describe", "jra"), /Did you mean: jira/);
  await assert.rejects(
    call("sdk.describe", "jira.isues"),
    /Did you mean: jira\.issues/,
  );
});

void test("search ranks path before doc matches and pages", async () => {
  const call = session();
  const text = await call("sdk.search", "sprint");
  const lines = text.split("\n");
  assert.match(lines[0], /matches for "sprint"/);
  assert.match(lines[1], /^jira\.sprints?\./);
  assert.match(text, /\[(?:network|external_write)\]/);
  assert.doesNotMatch(text, /confluence\./);
  const paged = await call("sdk.search", "a", { in: "jira" });
  assert.match(paged, /next: sdk\.search\("a", \{ in: "jira", offset: 20 \}\)/);
  const second = await call("sdk.search", "a", { in: "jira", offset: 20 });
  assert.match(second, /showing 21-/);
  assert.match(await call("sdk.search", "zzzz"), /^No methods match/);
  await assert.rejects(
    call("sdk.search", "x", { limit: 1 }),
    /no option 'limit'/,
  );
});

void test("docs: index with whenToRead, one topic, unknown topic", async () => {
  const call = session();
  assert.match(
    await call("sdk.docs", "jira"),
    /- jira\/workflows: before creating or updating issues/,
  );
  assert.match(await call("sdk.docs", "files/handles"), /20 MiB/);
  assert.match(await call("sdk.docs"), /- diagram\/render:/);
  assert.doesNotMatch(await call("sdk.docs"), /confluence\/writing/);
  await assert.rejects(
    call("sdk.docs", "jira/workflow"),
    /Did you mean: jira\/workflows/,
  );
});

void test("over budget, describe summarises and writes the full declarations to an artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-discovery-"));
  try {
    const call = session(dir);
    const first = await call("sdk.describe", "jira");
    const second = await call("sdk.describe", "jira.issues");
    assert.ok(first.length + second.length > 0);
    // Spend the rest of the budget, then ask for the whole namespace again.
    const env = createSdkEnvironment({
      cwd: process.cwd(),
      conversationDir: dir,
      namespaces,
    });
    env.discovery.used = DISCOVERY_BUDGET_CHARS - 500;
    const summary = String(
      await findSdkMethod("sdk.describe")!.prepare(["jira"], env).run(env),
    );
    const file = /Full declarations: (\S+)/.exec(summary)?.[1];
    assert.ok(file, summary);
    assert.match(file, /sdk-jira\.d\.ts$/);
    assert.ok(summary.length < 3_500);
    assert.match(summary, /sdk\.describe\("jira\.<group>"\)/);
    assert.match(await readFile(file, "utf8"), /declare const jira: \{/);
    assert.ok(env.report.artifacts.has("artifact:sdk-jira.d.ts"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test("a wrong argument names the method's declaration", async () => {
  const env = createSdkEnvironment({ cwd: process.cwd() });
  const method = findSdkMethod("jira.issues.get")!;
  assert.throws(() => method.prepare([1, 2], env), /takes one argument/);
});
