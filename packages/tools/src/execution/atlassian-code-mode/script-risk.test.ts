import assert from "node:assert/strict";
import { test } from "node:test";
import { sdkMethodNames } from "./sdk.js";
import {
  CODE_MODE_METHOD_TOOLS,
  classifyCodeModeScript,
} from "./script-risk.js";

const classify = (code: string) => classifyCodeModeScript(code);

void test("every SDK method is classified or argument-dependent", () => {
  const dependent = new Set([
    "jira.request",
    "confluence.request",
    "files.write",
  ]);
  for (const name of sdkMethodNames())
    assert.ok(
      name in CODE_MODE_METHOD_TOOLS || dependent.has(name),
      `${name} needs an entry in CODE_MODE_METHOD_TOOLS`,
    );
  for (const name of Object.keys(CODE_MODE_METHOD_TOOLS))
    assert.ok(sdkMethodNames().includes(name), `${name} is not an SDK method`);
});

void test("read-only scripts are read and list their operations", () => {
  const result = classify(`
    const a = await jira.issues.search({ jql: "project = X" });
    const b = await jira.issues.search({ jql: "project = Y" });
    return await confluence.pages.get({ id: "98506" });
  `);
  assert.equal(result.risk, "read");
  assert.deepEqual(result.operations, [
    "jira.issues.search ×2",
    "confluence.pages.get (98506)",
  ]);
});

void test("a script without SDK calls is read", () => {
  assert.equal(classify("console.log(1 + 1)").risk, "read");
});

void test("writes and destructive calls raise the risk", () => {
  const write = classify(
    `await confluence.pages.update({ id: "98506", title: "t" });`,
  );
  assert.equal(write.risk, "workspace_write");
  assert.deepEqual(write.operations, ["confluence.pages.update (98506)"]);
  assert.equal(
    classify(`await confluence.labels.add({ id: "1", labels: ["a"] })`).risk,
    "workspace_write",
  );
  assert.equal(
    classify(`await files.write("out/a.txt", "x", { workspace: true })`).risk,
    "workspace_write",
  );
  assert.equal(classify(`await files.write("a.txt", "x")`).risk, "read");
  assert.equal(
    classify(`await files.write("a.txt", "x", { workspace: false })`).risk,
    "read",
  );
});

void test("request is judged by its literal method", () => {
  assert.equal(
    classify(`await jira.request("get", "/rest/api/3/myself")`).risk,
    "read",
  );
  const post = classify(`await jira.request('POST', "/rest/api/3/issue", {})`);
  assert.equal(post.risk, "destructive");
  assert.deepEqual(post.operations, ["jira.request POST (/rest/api/3/issue)"]);
  assert.equal(
    classify(`const m = "GET"; await confluence.request(m, "/x")`).risk,
    "destructive",
  );
});

void test("aliasing and computed access are destructive", () => {
  for (const code of [
    `const j = jira; await j["issues"]["create"]({})`,
    `await jira["issues"].search({})`,
    `const { issues } = jira; await issues.search({})`,
    `const s = jira.issues.search; await s({})`,
    `await jira.issues.search.call(null, {})`,
    `await globalThis["ji" + "ra"].issues.get("A-1")`,
    `await eval("jira.issues.get('A-1')")`,
    `await jira.issues.unknownMethod({})`,
  ])
    assert.equal(classify(code).risk, "destructive", code);
});

void test("comments, strings and property names do not count", () => {
  const result = classify(`
    // await confluence.pages.update({ id: "1" })
    /* jira.request("DELETE", "/x") */
    const text = "confluence.pages.update(" + 'jira["x"]' + \`files.write\`;
    const label = { files: 1, jira: 2 };
    const re = /jira\\.request\\("POST"/;
    console.log(label.files, \`\${await jira.issues.get("A-1")}\`);
  `);
  assert.equal(result.risk, "read");
  assert.deepEqual(result.operations, ["jira.issues.get (A-1)"]);
});
