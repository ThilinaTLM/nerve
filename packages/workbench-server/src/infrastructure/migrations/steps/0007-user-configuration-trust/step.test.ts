import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { migrate, openCoreDatabase } from "@nervekit/conversation-core";
import { createStepContext } from "../../framework/context.js";
import { storagePaths } from "../../../storage-bootstrap/paths.js";
import step from "./step.js";

const digest = (text: string) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;

function setup() {
  // The skill loader reports real paths (macOS tmpdir is a symlink under /private).
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nerve-0007-")));
  process.env.HOME = join(root, "os-home");
  mkdirSync(join(root, "nerve"));
  const paths = storagePaths(join(root, "nerve"));
  const { context } = createStepContext(
    paths,
    step.id,
    step.description,
    () => {},
  );
  const put = (file: string, text: string) => {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
    return file;
  };
  const rows = () => {
    const db = openCoreDatabase(paths.sqlitePath);
    try {
      migrate(db);
      return db.sqlite
        .prepare(
          "SELECT kind, project_id, resource_key, content_digest, status FROM trusted_resource ORDER BY resource_key",
        )
        .all() as Record<string, string | null>[];
    } finally {
      db.close();
    }
  };
  return { paths, context, put, rows };
}

void test("existing user items become trusted at their current content, kinds are renamed, and a rerun changes nothing", async () => {
  const { paths, context, put, rows } = setup();
  const profile = put(join(paths.agentProfilesPath, "reviewer.json"), "{}\n");
  const ruleSet = put(join(paths.configPath, "rule-sets", "mine.json"), "{}\n");
  const overlay = put(paths.permissionsConfigPath, '{"overlays":[]}\n');
  const agent = put(join(paths.configPath, "agent.json"), "{}\n");
  const suggestion = put(
    join(paths.suggestionsPath, "ship.md"),
    "---\n---\nShip\n",
  );
  const skill = join(paths.agentPath, "skills", "deploy");
  put(
    join(skill, "SKILL.md"),
    "---\nname: deploy\ndescription: Deploys.\n---\nDeploy.\n",
  );
  // Rows written by the released schema: old kinds, a stale suggestion digest, a decline.
  mkdirSync(dirname(paths.sqlitePath), { recursive: true });
  const db = openCoreDatabase(paths.sqlitePath);
  migrate(db);
  const now = "2026-11-01T00:00:00.000Z";
  db.sqlite
    .prepare(
      "INSERT INTO project (id, name, directory, created_at, updated_at) VALUES ('p1', 'p', '/tmp/p', ?, ?)",
    )
    .run(now, now);
  const insert = db.sqlite.prepare(
    "INSERT INTO trusted_resource (id, kind, project_id, resource_key, name, content_digest, status, grants, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)",
  );
  insert.run(
    "t1",
    "project_permissions",
    "p1",
    "/tmp/p/perm",
    digest("x"),
    "trusted",
    now,
    now,
  );
  insert.run(
    "t2",
    "project_capabilities",
    "p1",
    "/tmp/p/agent",
    digest("y"),
    "rejected",
    now,
    now,
  );
  insert.run(
    "t3",
    "prompt_suggestion",
    null,
    suggestion,
    digest("predicate"),
    "trusted",
    now,
    now,
  );
  insert.run(
    "t4",
    "prompt_suggestion",
    "p1",
    "/tmp/p/s.md",
    digest("predicate"),
    "trusted",
    now,
    now,
  );
  insert.run(
    "t5",
    "agent_profile",
    null,
    profile,
    digest("declined content"),
    "rejected",
    now,
    now,
  );
  db.close();

  await step.run(context);
  const first = rows();
  const by = (key: string) => first.find((row) => row.resource_key === key)!;
  assert.equal(by("/tmp/p/perm").kind, "permissions");
  assert.equal(by("/tmp/p/agent").kind, "capabilities");
  assert.equal(by("/tmp/p/agent").status, "rejected");
  assert.equal(by(suggestion).content_digest, digest("---\n---\nShip\n"));
  assert.equal(
    first.some((row) => row.resource_key === "/tmp/p/s.md"),
    false,
  );
  // A decision the user already made is never replaced.
  assert.equal(by(profile).status, "rejected");
  for (const [kind, file] of [
    ["permission_rule_set", ruleSet],
    ["permissions", overlay],
    ["capabilities", agent],
    ["skill", skill],
  ] as const) {
    assert.equal(by(file).kind, kind);
    assert.equal(by(file).status, "trusted");
    assert.equal(by(file).project_id, null);
  }
  assert.equal(by(overlay).content_digest, digest('{"overlays":[]}\n'));
  await step.run(context);
  assert.deepEqual(rows(), first);
});

void test("a home without user configuration needs no rows", async () => {
  const { context, rows } = setup();
  await step.run(context);
  assert.deepEqual(rows(), []);
});
