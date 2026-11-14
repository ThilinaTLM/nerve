import { registry } from "./registry.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findSdkMethod,
  sdkMethodNames,
} from "@nervekit/tools/quick-script/testing";
import {
  classifyQuickScriptScript,
  describeQuickScriptRisk,
  quickScriptRiskWithin,
} from "@nervekit/tools/quick-script";

const classify = (code: string) => classifyQuickScriptScript(code, registry);

void test("the scanner reads each method's declared risk", () => {
  const risks = (code: string) => classify(code).risk;
  assert.equal(risks(`await jira.issues.get("A-1")`), "network");
  assert.equal(risks(`await files.list()`), "read");
  assert.equal(risks(`await web.fetch("https://x.test")`), "network");
  assert.equal(
    risks(`await files.list(); await web.fetch("https://x.test")`),
    "network",
  );
  assert.match(
    classify(`await web.search("q")`).operations[0] ?? "",
    /^web\.search/,
  );
  assert.equal(
    risks(`await confluence.comments.add({ id: "1", body: "x" })`),
    "external_write",
  );
  assert.equal(
    risks(`await confluence.attachments.upload({ id: "1", file: "a.png" })`),
    "external_write",
  );
  for (const name of sdkMethodNames(registry))
    assert.ok(
      [
        "none",
        "read",
        "network",
        "write",
        "external_write",
        "destructive",
      ].includes(findSdkMethod(name, registry)!.risk),
      name,
    );
});

void test("integration-read scripts are network and list their operations", () => {
  const result = classify(`
    const a = await jira.issues.search({ jql: "project = X" });
    const b = await jira.issues.search({ jql: "project = Y" });
    return await confluence.pages.get({ id: "98506" });
  `);
  assert.equal(result.risk, "network");
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
  assert.equal(write.risk, "external_write");
  assert.deepEqual(write.operations, ["confluence.pages.update (98506)"]);
  assert.equal(
    classify(`await confluence.labels.add({ id: "1", labels: ["a"] })`).risk,
    "external_write",
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
    "network",
  );
  const post = classify(`await jira.request('POST', "/rest/api/3/issue", {})`);
  assert.equal(post.risk, "destructive");
  assert.deepEqual(post.operations, ["jira.request (POST)"]);
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
  assert.equal(result.risk, "network");
  assert.deepEqual(result.operations, ["jira.issues.get (A-1)"]);
});

void test("a slash after ) or } cannot hide calls behind a bogus string or regex", () => {
  const regexAfterParen = `if (x) /'/.test(s);\njira.issues.create({ project: "A", summary: "s" });`;
  assert.equal(classify(regexAfterParen).risk, "external_write");
  assert.equal(
    classify(`{}\n/'/.test(s);\nawait jira.issues.delete("A-1");`).risk,
    "destructive",
  );
  // Division stays readable: the quote after it is a string, not a regex body.
  const division = classify(
    `const r = (a) / 2; const s = "x"; await jira.issues.get("A-1");`,
  );
  assert.equal(division.risk, "network");
  assert.deepEqual(division.operations, ["jira.issues.get (A-1)"]);
});

void test("a tie between workspace and external writes reports the external write, in any order", () => {
  const file = `await files.write("out/a.txt", "x", { workspace: true });`;
  const jira = `await jira.comments.add({ key: "A-1", body: "x" });`;
  assert.equal(classify(file + jira).risk, "external_write");
  assert.equal(classify(jira + file).risk, "external_write");
  assert.equal(describeQuickScriptRisk("external_write"), "external write");
});

void test("workspace and external writes share a rank: either ceiling admits the other", () => {
  assert.ok(quickScriptRiskWithin("external_write", "workspace_write"));
  assert.ok(quickScriptRiskWithin("workspace_write", "external_write"));
  assert.ok(!quickScriptRiskWithin("destructive", "external_write"));
});

void test("escaped identifiers, constructor chains and host.call cannot hide calls", () => {
  for (const code of [
    `await \\u006aira.issues.delete("A-1")`,
    `await \\u{6a}ira.issues.delete("A-1")`,
    `await [].constructor.constructor("return jira")().issues.delete("A-1")`,
    `await ({})["constructor"]["constructor"]("return 1")()`,
    `await host.call("jira.issues.delete", [{ key: "A-1" }])`,
    `const h = host["call"]; await h("jira.issues.delete", [])`,
    `await this.jira.issues.delete("A-1")`,
  ])
    assert.equal(classify(code).risk, "destructive", code);
  // Properties named like escapes are not escapes.
  assert.equal(
    classify(`console.log(new URL("https://x.test").host)`).risk,
    "read",
  );
  // An escaped method name is read as the method it names.
  assert.equal(
    classify(`await jira.request("\\u0047ET", "/rest/api/3/myself")`).risk,
    "network",
  );
});

void test("workspace writes hidden behind quoted, computed or escaped option keys are found", () => {
  for (const code of [
    `await files.write("a.txt", "x", { "workspace": true })`,
    `await files.write("a.txt", "x", { ["work" + "space"]: true })`,
    `await files.write("a.txt", "x", { "\\u0077orkspace": true })`,
    `await files.write("a.txt", "x", { ...opts })`,
    `await files.write("a.txt", "x", { workspace })`,
    `await files.write("a.txt", "x", opts)`,
  ])
    assert.equal(classify(code).risk, "workspace_write", code);
  for (const code of [
    `await files.write("a.txt", "x", { "workspace": false })`,
    `await files.write("artifact:a.txt", "x", { other: 1 })`,
  ])
    assert.equal(classify(code).risk, "read", code);
});

void test("files.edit is a workspace write unless it targets a literal artifact handle", () => {
  assert.equal(
    classify(
      `await files.edit("artifact:a.md", [{ oldText: "a", newText: "b" }])`,
    ).risk,
    "read",
  );
  assert.equal(
    classify(`await files.edit("src/a.ts", [{ oldText: "a", newText: "b" }])`)
      .risk,
    "workspace_write",
  );
  assert.equal(
    classify(`await files.edit(handle, edits)`).risk,
    "workspace_write",
  );
});

void test("image chains read at most; only the bare global is not analysable", () => {
  const chain = classify(
    `await image("artifact:a.png").resize({ width: 100 }).png().save("b.png")`,
  );
  assert.equal(chain.risk, "read");
  assert.deepEqual(chain.operations, ["image (artifact:a.png)"]);
  assert.equal(
    classify(`const i = image("wide.png"); await i.info()`).risk,
    "read",
  );
  assert.equal(
    classify(`const f = image; await f("x.png").info()`).risk,
    "destructive",
  );
  assert.equal(
    classify(`await image("a.png").constructor("x")()`).risk,
    "destructive",
  );
});
