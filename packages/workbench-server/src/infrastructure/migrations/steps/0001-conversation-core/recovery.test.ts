import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runMigrations } from "../../framework/runner.js";
import {
  discardFailedItems,
  rollbackFailedMigration,
} from "../../framework/recovery.js";
import { fixture, registry, timestamp } from "./step-fixture.js";

/** One unreadable document and one that fails inside the importer. */
async function addBrokenConversations(home: string): Promise<void> {
  await mkdir(join(home, "data/conversations/broken/tool-calls/call"), {
    recursive: true,
  });
  await writeFile(
    join(home, "data/conversations/broken/tool-calls/call/result.json"),
    "{}",
  );
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
  try {
    const insert = db.prepare(
      "INSERT INTO domain_documents VALUES ('conversation', 'global', ?, ?)",
    );
    insert.run("conv_corrupt", Buffer.from("{not json"));
    insert.run(
      "conv_broken",
      Buffer.from(
        JSON.stringify({
          id: "conv_broken",
          title: "Broken conversation",
          projectId: "proj_missing",
          createdAt: timestamp,
        }),
      ),
    );
  } finally {
    db.close();
  }
}

const report = async (home: string) =>
  JSON.parse(
    await readFile(join(home, "migrations/last-failure.json"), "utf8"),
  ) as {
    discardable?: {
      kind: string;
      id: string;
      title?: string;
      reason: string;
    }[];
    rollbackAvailable?: boolean;
  };

void test("0001 reports every failed conversation and completes once they are discarded", async (t) => {
  const home = await fixture(t);
  await addBrokenConversations(home);
  await assert.rejects(
    runMigrations(home, { registry }),
    /2 conversations could not be upgraded/,
  );
  const failure = await report(home);
  assert.equal(failure.rollbackAvailable, true);
  assert.deepEqual(
    failure.discardable?.map(({ kind, id, title }) => ({ kind, id, title })),
    [
      { kind: "conversation", id: "conv_corrupt", title: undefined },
      { kind: "conversation", id: "conv_broken", title: "Broken conversation" },
    ],
  );
  assert.match(failure.discardable[0].reason, /^Unreadable conversation/);

  await assert.rejects(
    discardFailedItems(home, ["conv_one"]),
    /Only items reported/,
  );
  await discardFailedItems(home, ["conv_corrupt", "conv_broken"]);
  // Both failed during import, so the previous import is verified as is.
  const phases = new Set<string>();
  await runMigrations(home, {
    registry,
    onProgress: ({ phase }) => phases.add(phase),
  });
  assert.equal(phases.has("import"), false);
  assert(phases.has("verify-history-and-assets"));

  const db = new DatabaseSync(join(home, "data/nerve.sqlite"), {
    readOnly: true,
  });
  try {
    assert.deepEqual(
      db
        .prepare(
          "SELECT id FROM conversation WHERE parent_conversation_id IS NULL ORDER BY id",
        )
        .all()
        .map((row) => row.id),
      ["conv_one", "conv_two"],
    );
  } finally {
    db.close();
  }
  const upgrade = JSON.parse(
    await readFile(
      join(home, "migrations/reports/0001-conversation-core.json"),
      "utf8",
    ),
  );
  const broken = upgrade.setAside.find(
    (item: { id: string }) => item.id === "conv_broken",
  );
  assert(
    existsSync(
      join(broken.quarantinePath, "payload/broken/tool-calls/call/result.json"),
    ),
  );
  const rows = await readFile(
    join(broken.quarantinePath, "payload/records.jsonl"),
    "utf8",
  );
  assert(rows.includes("conv_broken"));
  assert(!rows.includes("conv_two"));
  // Set-aside conversations leave no active legacy or new-layout files behind.
  assert.equal(existsSync(join(home, "data/conversations/broken")), false);
  assert.equal(existsSync(join(home, "data/conversations/conv_broken")), false);
  assert.equal(existsSync(join(home, "migrations/last-failure.json")), false);
  assert.deepEqual(await readdir(join(home, "migrations/work")), []);
});

void test("0001 rollback restores the 0.34.1 home after a failed attempt", async (t) => {
  const home = await fixture(t);
  await addBrokenConversations(home);
  await mkdir(join(home, "data/launches/task_one"), { recursive: true });
  const watched = [
    "manifest.json",
    "config/harness.json",
    "config/settings.json",
    "agent/suggestions/fixture.md",
    "project/.nerve/subagents/reviewer.md",
  ];
  const before = new Map(
    await Promise.all(
      watched.map(
        async (path) =>
          [path, await readFile(join(home, path), "utf8")] as const,
      ),
    ),
  );
  const conversationsBefore = await readdir(join(home, "data/conversations"));
  const databaseBefore = await readFile(join(home, "data/nerve.sqlite"));

  await assert.rejects(runMigrations(home, { registry }));
  // The attempt converted files in place; the rollback must undo all of it.
  assert.notEqual(
    await readFile(join(home, "config/harness.json"), "utf8"),
    before.get("config/harness.json"),
  );
  assert(existsSync(join(home, "data/launches/launch_one")));
  await rollbackFailedMigration(home, { registry });

  for (const [path, content] of before)
    assert.equal(await readFile(join(home, path), "utf8"), content, path);
  assert.equal(existsSync(join(home, "config/subagents.json")), false);
  assert.equal(existsSync(join(home, "data/launches/launch_one")), false);
  assert(existsSync(join(home, "data/launches/task_one")));
  assert.deepEqual(
    (await readdir(join(home, "data/conversations"))).sort(),
    conversationsBefore.sort(),
  );
  assert.deepEqual(
    await readFile(join(home, "data/nerve.sqlite")),
    databaseBefore,
  );
  assert.equal(existsSync(join(home, "data/nerve.sqlite.migrating")), false);
  assert.equal(existsSync(join(home, "migrations/last-failure.json")), false);
  assert.deepEqual(await readdir(join(home, "migrations/work")), []);
  await assert.rejects(
    rollbackFailedMigration(home, { registry }),
    /cannot be rolled back/,
  );
});

void test("0001 attributes verification failures to their source conversation", async (t) => {
  const home = await fixture(t);
  await assert.rejects(
    runMigrations(home, {
      registry,
      onProgress: ({ phase }) => {
        if (phase !== "verify") return;
        const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
        try {
          db.exec(
            "UPDATE conversation_event SET payload = json_set(payload, '$.text', 'corrupted') WHERE conversation_id = 'conv_one'",
          );
        } finally {
          db.close();
        }
      },
    }),
    /1 conversation could not be upgraded/,
  );
  const failure = await report(home);
  assert.deepEqual(failure.discardable, [
    {
      kind: "conversation",
      id: "conv_one",
      reason: "History verification failed: user messages differ",
    },
  ]);
  assert.equal(failure.rollbackAvailable, true);
  assert(existsSync(join(home, "data/nerve.sqlite.migrating")));
});

/** Two discardable files plus an unreadable runtime-owned document. */
async function corruptConfiguration(home: string) {
  const rules = join(home, "config/rule-sets/custom.json");
  const overlay = join(home, "data/conversations/one/capabilities.json");
  const harness = join(home, "config/harness.json");
  await mkdir(join(home, "config/rule-sets"), { recursive: true });
  await writeFile(rules, "{ truncated");
  await writeFile(overlay, '{"schemaVersion": 1,');
  await writeFile(harness, "not json");
  return { rules, overlay, harness };
}

void test("0001 checks configuration before converting and sets discarded files aside", async (t) => {
  const home = await fixture(t);
  const { rules, overlay, harness } = await corruptConfiguration(home);
  await assert.rejects(
    runMigrations(home, { registry }),
    /2 configuration files could not be upgraded/,
  );
  const failure = await report(home);
  assert.deepEqual(
    failure.discardable?.map(({ kind, id, title }) => ({ kind, id, title })),
    [
      {
        kind: "configuration",
        id: rules,
        title: "User settings: config/rule-sets/custom.json",
      },
      {
        kind: "configuration",
        id: overlay,
        title: "Conversation conv_one: capabilities.json",
      },
    ],
  );
  // The check runs before any conversion.
  assert.equal(existsSync(join(home, "config/subagents.json")), false);

  await discardFailedItems(home, [rules, overlay]);
  await runMigrations(home, { registry });
  const upgrade = JSON.parse(
    await readFile(
      join(home, "migrations/reports/0001-conversation-core.json"),
      "utf8",
    ),
  );
  assert.equal(upgrade.step, "0001-conversation-core");
  assert.equal(upgrade.setAside.length, 2);
  const ruleEntry = upgrade.setAside.find(
    (item: { id: string }) => item.id === rules,
  );
  assert.equal(
    await readFile(
      join(ruleEntry.quarantinePath, "payload/custom.json"),
      "utf8",
    ),
    "{ truncated",
  );
  const reason = JSON.parse(
    await readFile(join(ruleEntry.quarantinePath, "reason.json"), "utf8"),
  );
  assert.equal(reason.originalPath, rules);
  assert.equal(reason.kind, "configuration");
  assert.equal(existsSync(rules), false);
  const overlayEntry = upgrade.setAside.find(
    (item: { id: string }) => item.id === overlay,
  );
  assert(
    existsSync(join(overlayEntry.quarantinePath, "payload/capabilities.json")),
  );
  // Runtime-owned documents are never reported or rewritten by the step.
  assert.equal(await readFile(harness, "utf8"), "not json");
});

void test("0001 rollback returns configuration files that were set aside", async (t) => {
  const home = await fixture(t);
  const { rules, overlay } = await corruptConfiguration(home);
  await addBrokenConversations(home);
  await assert.rejects(runMigrations(home, { registry }), /configuration/);
  await discardFailedItems(home, [rules, overlay]);
  await assert.rejects(runMigrations(home, { registry }), /2 conversations/);
  await rollbackFailedMigration(home, { registry });
  assert.equal(await readFile(rules, "utf8"), "{ truncated");
  assert.equal(existsSync(`${rules}.corrupt`), false);
  assert(existsSync(overlay));
  assert.equal(existsSync(`${overlay}.corrupt`), false);
});

void test("0001 re-imports when a conversation that failed verification is discarded", async (t) => {
  const home = await fixture(t);
  const corrupt = ({ phase }: { phase: string }) => {
    if (phase !== "verify") return;
    const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
    try {
      db.exec(
        "UPDATE conversation_event SET payload = json_set(payload, '$.text', 'corrupted') WHERE conversation_id = 'conv_one'",
      );
    } finally {
      db.close();
    }
  };
  await assert.rejects(runMigrations(home, { registry, onProgress: corrupt }));
  await discardFailedItems(home, ["conv_one"]);
  const phases = new Set<string>();
  await runMigrations(home, {
    registry,
    onProgress: ({ phase }) => phases.add(phase),
  });
  assert(phases.has("import"));
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"), {
    readOnly: true,
  });
  try {
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM conversation WHERE id = 'conv_one'")
        .get()!.n,
      0,
    );
  } finally {
    db.close();
  }
});
