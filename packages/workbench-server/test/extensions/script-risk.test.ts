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

void test("runtime namespaces are scanned: starting a launch makes the script destructive", async () => {
  assert.equal((await classify(`await launches.list()`)).risk, "read");
  assert.equal(
    (await classify(`await launches.create({ command: "pnpm dev" })`)).risk,
    "workspace_write",
  );
  assert.equal(
    (await classify(`await launches.start("web")`)).risk,
    "destructive",
  );
  assert.equal(
    (await classify(`const l = launches; await l.start("web")`)).risk,
    "destructive",
  );
  // Checked as bash at run time, so no operation rule can admit the script.
  const start = await classify(`await launches.start("web")`);
  assert.equal(start.admissible, false);
  assert.deepEqual(start.calls, []);
});

void test("the scanner reads each method's declared risk", async () => {
  const risks = async (code: string) => (await classify(code)).risk;
  assert.equal(await risks(`await jira.issues.get("A-1")`), "external_read");
  assert.equal(await risks(`await artifacts.list()`), "read");
  assert.equal(await risks(`await files.search("TODO")`), "read");
  assert.equal(
    await risks(`await web.fetch("https://x.test")`),
    "external_read",
  );
  assert.equal(
    await risks(`await artifacts.list(); await web.fetch("https://x.test")`),
    "external_read",
  );
  assert.match(
    (await classify(`await search.web("q")`)).operations[0] ?? "",
    /^search\.web/,
  );
  assert.equal(
    await risks(`await confluence.comments.add({ id: "1", body: "x" })`),
    "external_write",
  );
  assert.equal(
    await risks(
      `await confluence.attachments.upload({ id: "1", file: "a.png" })`,
    ),
    "external_write",
  );
  for (const name of sdkMethodNames(registry))
    assert.ok(
      [
        "none",
        "read",
        "external_read",
        "write",
        "external_write",
        "destructive",
      ].includes(findSdkMethod(name, registry)!.risk),
      name,
    );
});

void test("integration-read scripts are external_read and list their operations", async () => {
  const result = await classify(`
    const a = await jira.issues.search({ jql: "project = X" });
    const b = await jira.issues.search({ jql: "project = Y" });
    return await confluence.pages.get({ id: "98506" });
  `);
  assert.equal(result.risk, "external_read");
  assert.deepEqual(result.operations, [
    "jira.issues.search ×2",
    "confluence.pages.get (98506)",
  ]);
});

void test("a script without SDK calls is read", async () => {
  assert.equal((await classify("console.log(1 + 1)")).risk, "read");
});

void test("writes and destructive calls raise the risk", async () => {
  const write = await classify(
    `await confluence.pages.update({ id: "98506", title: "t" });`,
  );
  assert.equal(write.risk, "external_write");
  assert.deepEqual(write.operations, ["confluence.pages.update (98506)"]);
  assert.equal(
    (await classify(`await confluence.labels.add({ id: "1", labels: ["a"] })`))
      .risk,
    "external_write",
  );
  assert.equal(
    (await classify(`await files.write({ path: "out/a.txt", data: "x" })`))
      .risk,
    "workspace_write",
  );
  assert.equal(
    (await classify(`await artifacts.write({ name: "a.txt", data: "x" })`))
      .risk,
    "read",
  );
});

void test("request is judged by its literal method", async () => {
  assert.equal(
    (await classify(`await jira.request("get", "/rest/api/3/myself")`)).risk,
    "external_read",
  );
  const post = await classify(
    `await jira.request('POST', "/rest/api/3/issue", {})`,
  );
  assert.equal(post.risk, "destructive");
  assert.deepEqual(post.operations, ["jira.request (POST)"]);
  assert.equal(
    (await classify(`const m = "GET"; await confluence.request(m, "/x")`)).risk,
    "destructive",
  );
});

void test("aliasing and computed access are destructive", async () => {
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
    assert.equal((await classify(code)).risk, "destructive", code);
});

void test("comments, strings and property names do not count", async () => {
  const result = await classify(`
    // await confluence.pages.update({ id: "1" })
    /* jira.request("DELETE", "/x") */
    const text = "confluence.pages.update(" + 'jira["x"]' + \`files.write\`;
    const label = { files: 1, jira: 2 };
    const re = /jira\\.request\\("POST"/;
    console.log(label.files, \`\${await jira.issues.get("A-1")}\`);
  `);
  assert.equal(result.risk, "external_read");
  assert.deepEqual(result.operations, ["jira.issues.get (A-1)"]);
});

void test("a slash after ) or } cannot hide calls behind a bogus string or regex", async () => {
  const regexAfterParen = `if (x) /'/.test(s);\njira.issues.create({ project: "A", summary: "s" });`;
  assert.equal((await classify(regexAfterParen)).risk, "external_write");
  assert.equal(
    (await classify(`{}\n/'/.test(s);\nawait jira.issues.delete("A-1");`)).risk,
    "destructive",
  );
  // Division stays readable: the quote after it is a string, not a regex body.
  const division = await classify(
    `const r = (a) / 2; const s = "x"; await jira.issues.get("A-1");`,
  );
  assert.equal(division.risk, "external_read");
  assert.deepEqual(division.operations, ["jira.issues.get (A-1)"]);
});

void test("a tie between workspace and external writes reports the external write, in any order", async () => {
  const file = `await files.write({ path: "out/a.txt", data: "x" });`;
  const jira = `await jira.comments.add({ key: "A-1", body: "x" });`;
  assert.equal((await classify(file + jira)).risk, "external_write");
  assert.equal((await classify(jira + file)).risk, "external_write");
  assert.equal(describeQuickScriptRisk("external_write"), "external write");
});

void test("workspace and external writes share a rank: either ceiling admits the other", async () => {
  assert.ok(quickScriptRiskWithin("external_write", "workspace_write"));
  assert.ok(quickScriptRiskWithin("workspace_write", "external_write"));
  assert.ok(!quickScriptRiskWithin("destructive", "external_write"));
});

void test("escaped identifiers, constructor chains and host.call cannot hide calls", async () => {
  for (const code of [
    `await \\u006aira.issues.delete("A-1")`,
    `await \\u{6a}ira.issues.delete("A-1")`,
    `await [].constructor.constructor("return jira")().issues.delete("A-1")`,
    `await ({})["constructor"]["constructor"]("return 1")()`,
    `await host.call("jira.issues.delete", [{ key: "A-1" }])`,
    `const h = host["call"]; await h("jira.issues.delete", [])`,
    `await this.jira.issues.delete("A-1")`,
  ])
    assert.equal((await classify(code)).risk, "destructive", code);
  // Properties named like escapes are not escapes.
  assert.equal(
    (await classify(`console.log(new URL("https://x.test").host)`)).risk,
    "read",
  );
  // An escaped method name is read as the method it names.
  assert.equal(
    (await classify(`await jira.request("\\u0047ET", "/rest/api/3/myself")`))
      .risk,
    "external_read",
  );
});

void test("files.* writes are workspace writes whatever their arguments; artifacts.* never are", async () => {
  for (const code of [
    `await files.edit({ edits: [{ path: "src/a.ts", oldText: "a", newText: "b" }] })`,
    `await files.edit({ edits: [{ glob: "*.ts", pattern: /a/, replacement: "b", all: true }], dryRun: true })`,
    `await files.edit(options)`,
    `await files.write(options)`,
  ])
    assert.equal((await classify(code)).risk, "workspace_write", code);
  for (const code of [
    `await artifacts.edit({ name: "a.md", edits: [{ oldText: "a", newText: "b" }] })`,
    `await artifacts.write(options)`,
  ])
    assert.equal((await classify(code)).risk, "read", code);
});

void test("image chains read at most; only the bare global is not analysable", async () => {
  const chain = await classify(
    `await image("artifact:a.png").resize({ width: 100 }).png().save("b.png")`,
  );
  assert.equal(chain.risk, "read");
  assert.deepEqual(chain.operations, ["image (artifact:a.png)"]);
  assert.equal(
    (await classify(`const i = image("wide.png"); await i.info()`)).risk,
    "read",
  );
  assert.equal(
    (await classify(`const f = image; await f("x.png").info()`)).risk,
    "destructive",
  );
  assert.equal(
    (await classify(`await image("a.png").constructor("x")()`)).risk,
    "destructive",
  );
});
