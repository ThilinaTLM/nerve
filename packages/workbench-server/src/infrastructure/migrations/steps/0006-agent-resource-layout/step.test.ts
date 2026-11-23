import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openCoreDatabase } from "@nervekit/conversation-core";
import { openCredential } from "../../../../domains/accounts/credential-blob.js";
import {
  EncryptedFileSecretProvider,
  loadMasterKey,
} from "../../../secrets/index.js";
import { createStepContext } from "../../framework/context.js";
import { storagePaths } from "../../../storage-bootstrap/paths.js";
import step from "./step.js";

function home() {
  const root = mkdtempSync(join(tmpdir(), "nerve-0006-"));
  const paths = storagePaths(root);
  const { context } = createStepContext(
    paths,
    step.id,
    step.description,
    () => {},
  );
  const put = (directory: string, name: string, text: string) => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, name), text);
  };
  return { root, paths, context, put };
}

void test("user profiles move from data/agent-profiles to agent/agent-profiles byte for byte", async () => {
  const { paths, context, put } = home();
  put(paths.agentProfilesConfigPath, "reviewer.json", '{"name":"reviewer"}\n');
  put(paths.agentProfilesConfigPath, "writer.json", '{"name":"writer"}\n');
  await step.run(context);
  assert.deepEqual(readdirSync(paths.agentProfilesPath).sort(), [
    "reviewer.json",
    "writer.json",
  ]);
  assert.equal(
    readFileSync(join(paths.agentProfilesPath, "writer.json"), "utf8"),
    '{"name":"writer"}\n',
  );
  assert.equal(existsSync(paths.agentProfilesConfigPath), false);
  await step.verify!(context);
});

void test("a home without user profiles needs no change, and a second run is a no-op", async () => {
  const { paths, context, put } = home();
  await step.run(context);
  assert.equal(existsSync(paths.agentProfilesPath), false);
  put(paths.agentProfilesPath, "kept.json", "{}");
  await step.run(context);
  assert.deepEqual(readdirSync(paths.agentProfilesPath), ["kept.json"]);
});

void test("an existing target wins: identical copies collapse, different ones are quarantined and reported", async () => {
  const { root, paths, context, put } = home();
  put(paths.agentProfilesPath, "same.json", "A");
  put(paths.agentProfilesPath, "differs.json", "NEW");
  put(paths.agentProfilesConfigPath, "same.json", "A");
  put(paths.agentProfilesConfigPath, "differs.json", "OLD");
  put(paths.agentProfilesConfigPath, "moved.json", "M");
  await step.run(context);
  assert.equal(
    readFileSync(join(paths.agentProfilesPath, "differs.json"), "utf8"),
    "NEW",
  );
  assert.equal(
    readFileSync(join(paths.agentProfilesPath, "moved.json"), "utf8"),
    "M",
  );
  assert.equal(existsSync(paths.agentProfilesConfigPath), false);
  // The older, different copy survives in quarantine.
  const quarantined: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(directory, entry.name));
      else quarantined.push(join(directory, entry.name));
    }
  };
  walk(join(root, "quarantine"));
  const payload = quarantined.find((file) => file.endsWith("differs.json"));
  assert.ok(payload);
  assert.equal(readFileSync(payload, "utf8"), "OLD");
  await step.verify!(context);
});

void test("accounts move into the account table as user accounts with their secrets sealed; the secrets leave credentials.enc", async () => {
  const { root, paths, context } = home();
  mkdirSync(paths.configPath, { recursive: true });
  writeFileSync(
    paths.accountsConfigPath,
    JSON.stringify({
      version: 2,
      accounts: {
        atlassian: [
          { id: "acme", name: "Acme", fields: { siteUrl: "https://a.test" } },
          { id: "empty", name: "No secret yet", fields: {} },
        ],
        tavily: [{ id: "acme", name: "Same id", fields: {} }],
      },
    }),
  );
  const secrets = new EncryptedFileSecretProvider(root);
  await secrets.initialize();
  await secrets.set("provider:account:atlassian:acme:apiKey", "token-1");
  await secrets.set("provider:account:tavily:acme:apiKey", "token-2");
  await secrets.set("provider:openai:apiKey", "sk-model");
  await step.run(context);
  await step.verify!(context);

  assert.equal(existsSync(paths.accountsConfigPath), false);
  assert.deepEqual(await secrets.list(), ["provider:openai:apiKey"]);
  const db = openCoreDatabase(paths.sqlitePath);
  try {
    const rows = db.sqlite
      .prepare(
        "SELECT id, kind, project_id, name, fields, credential, status FROM account ORDER BY kind, name",
      )
      .all();
    assert.equal(rows.length, 3);
    const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
    const key = await loadMasterKey(root);
    for (const row of rows) assert.equal(row.project_id, null);
    const acme = byName.Acme!;
    assert.equal(acme.id, "acme");
    assert.equal(acme.status, "ready");
    assert.deepEqual(JSON.parse(acme.fields as string), {
      siteUrl: "https://a.test",
    });
    const sealed = acme.credential as Uint8Array;
    assert.equal(
      Buffer.from(sealed).toString("utf8").includes("token-1"),
      false,
    );
    assert.deepEqual(openCredential(key, "acme", sealed).secrets, {
      secret: "token-1",
    });
    // The blob is bound to its account id.
    assert.throws(() => openCredential(key, "other", sealed));
    const empty = byName["No secret yet"]!;
    assert.equal(empty.status, "needs_sign_in");
    assert.equal(empty.credential, null);
    // The second account that used the id "acme" got a new id and kept its own secret.
    const second = byName["Same id"]!;
    assert.notEqual(second.id, "acme");
    assert.deepEqual(
      openCredential(key, second.id as string, second.credential as Uint8Array)
        .secrets,
      { secret: "token-2" },
    );
  } finally {
    db.close();
  }
  // Nothing left to do on a second run.
  await step.run(context);
});

void test("rules naming the removed launch tool drop it from overlays and rule sets, reported once each", async () => {
  const { paths, context, put } = home();
  const losses: string[] = [];
  const reporting = {
    ...context,
    loss: (reason: string) => losses.push(reason),
  };
  const rule = (id: string, toolNames: string[]) => ({
    id,
    enforcement: "ask",
    when: { toolNames },
  });
  const overlay = {
    schemaVersion: 2,
    overlays: [
      {
        id: "o",
        rules: [
          rule("only", ["launch"]),
          rule("shared", ["launch", "bash"]),
          rule("other", ["bash"]),
        ],
      },
    ],
  };
  put(paths.configPath, "permissions.json", JSON.stringify(overlay));
  put(
    join(paths.configPath, "rule-sets"),
    "mine.json",
    JSON.stringify({ rules: [rule("set-only", ["launch"])] }),
  );
  put(
    join(paths.conversationsPath, "conv_1", "config"),
    "permissions.json",
    JSON.stringify({
      schemaVersion: 2,
      overlays: [{ id: "c", rules: [rule("c1", ["launch"])] }],
    }),
  );
  await step.run(reporting);
  const read = (path: string) =>
    JSON.parse(readFileSync(path, "utf8")) as {
      overlays?: { rules: { id: string; when: { toolNames: string[] } }[] }[];
      rules?: unknown[];
    };
  const user = read(paths.permissionsConfigPath).overlays![0].rules;
  assert.deepEqual(
    user.map((entry) => [entry.id, entry.when.toolNames]),
    [
      ["shared", ["bash"]],
      ["other", ["bash"]],
    ],
  );
  assert.deepEqual(
    read(join(paths.configPath, "rule-sets", "mine.json")).rules,
    [],
  );
  assert.deepEqual(
    read(join(paths.conversationsPath, "conv_1", "config", "permissions.json"))
      .overlays![0].rules,
    [],
  );
  assert.equal(losses.length, 4);
  assert.match(
    losses.join("\n"),
    /Permission rule "only" named only the removed launch tool/,
  );
  await step.verify!(context);
  await step.run(reporting);
  assert.equal(losses.length, 4);
});

void test("launch rule cleanup skips unparseable files and disables rules with launch-shaped matchers", async () => {
  const { paths, context, put } = home();
  const losses: string[] = [];
  const reporting = {
    ...context,
    loss: (reason: string) => losses.push(reason),
  };
  put(join(paths.configPath, "rule-sets"), "broken.json", "{ nope");
  put(
    paths.configPath,
    "permissions.json",
    JSON.stringify({
      overlays: [
        {
          id: "o",
          rules: [
            {
              id: "scoped",
              enabled: true,
              when: {
                toolNames: ["launch", "bash"],
                primaryArgument: { operator: "glob", value: "start" },
              },
            },
          ],
        },
      ],
    }),
  );
  await step.run(reporting);
  await step.verify!(context);
  const rule = JSON.parse(readFileSync(paths.permissionsConfigPath, "utf8"))
    .overlays[0].rules[0];
  assert.equal(rule.enabled, false);
  assert.deepEqual(rule.when.toolNames, ["bash"]);
  assert.match(losses[0], /disabled/);
  assert.equal(
    readFileSync(join(paths.configPath, "rule-sets", "broken.json"), "utf8"),
    "{ nope",
  );
});
