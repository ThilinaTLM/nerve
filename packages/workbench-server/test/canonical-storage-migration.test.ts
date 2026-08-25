import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { defaultSettings, settingsSchema } from "@nervekit/contracts";
import {
  CANONICAL_SCHEMA_VERSION,
  CANONICAL_V2_SCHEMA_CHECKSUM,
} from "../src/infrastructure/canonical-store/schema.js";
import { encode } from "../src/infrastructure/canonical-store/payload-codecs.js";
import { initializeStorage } from "../src/infrastructure/storage/initialize.js";
import { runStorageMigrations } from "../src/infrastructure/migrations/runner.js";
import { migrateLegacyPermissionValue } from "../src/infrastructure/migrations/legacy/permission-rules.js";
import { storageMigrationRegistry } from "../src/infrastructure/migrations/registry.js";

describe("canonical storage migration", () => {
  it("has one post-v0.26 migration targeting the final schema", () => {
    assert.equal(storageMigrationRegistry.at(-2)?.id, "0012-remove-workers");
    assert.equal(storageMigrationRegistry.at(-1)?.id, "0013-canonical-storage");
    assert.equal(CANONICAL_SCHEMA_VERSION, 3);
  });

  it("migrates canonical v2 data and removes compatibility files idempotently", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-canonical-v3-"));
    try {
      const storage = await initializeStorage(home);
      const conversation = {
        id: "conv_01HN0000000000000000000000",
        projectId: "proj_01HN0000000000000000000000",
        title: "Implement resilient protocol…",
        mode: "coding" as const,
        permissionLevel: "autonomous" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      await storage.canonicalStore.writeDocument({
        namespace: "conversation",
        scopeId: "global",
        documentId: conversation.id,
        data: conversation,
        expectedRevision: 0,
      });
      await storage.canonicalStore.writeDocument({
        namespace: "conversation_state",
        scopeId: conversation.id,
        documentId: "state",
        data: {
          conversationId: conversation.id,
          revision: 1,
          conversation,
          entries: [
            {
              id: "entry_01HN0000000000000000000000",
              conversationId: conversation.id,
              role: "user",
              kind: "message",
              text: "Implement resilient protocol heartbeat validation.",
              createdAt: "2026-01-02T00:00:00.000Z",
            },
          ],
          modelEntries: [],
          modelLeafId: null,
          agentModelEntries: [],
          agentModelLeafIds: [],
          toolCalls: [],
          runProjections: [],
          interactions: [],
          suspensions: [],
          idempotencyKeys: [],
          intentConversationRevisions: [],
        },
        expectedRevision: 0,
      });
      await storage.canonicalStore.close();

      const database = new DatabaseSync(join(home, "state.sqlite"));
      database.exec("DELETE FROM schema_migrations");
      database
        .prepare(
          `INSERT INTO schema_migrations
           (version, name, checksum, applied_at_ms, duration_ms)
           VALUES (2, 'canonical-storage-baseline', ?, 0, 0)`,
        )
        .run(CANONICAL_V2_SCHEMA_CHECKSUM);
      database
        .prepare("UPDATE settings_store SET data = ? WHERE id = 'settings'")
        .run(encode({ ...defaultSettings, notifications: undefined }));
      database.close();
      await writeFile(join(home, "config.json"), "{}\n");
      await writeFile(join(home, "providers.json"), "{}\n");
      await mkdir(join(home, "cache"), { recursive: true });
      await writeFile(join(home, "cache", "legacy-index.sqlite"), "old");

      const first = await runStorageMigrations(home);
      assert.equal(first.executions.length, 1);
      const reopened = await initializeStorage(home);
      assert.deepEqual(
        settingsSchema.parse(reopened.settings),
        reopened.settings,
      );
      const migrated = await reopened.canonicalStore.readDocument<
        typeof conversation & { lastUserMessageAt?: string }
      >("conversation", "global", conversation.id);
      assert.equal(
        migrated?.data.title,
        "Implement resilient protocol heartbeat validation",
      );
      assert.equal(
        migrated?.data.lastUserMessageAt,
        "2026-01-02T00:00:00.000Z",
      );
      await reopened.canonicalStore.close();
      await assert.rejects(readFile(join(home, "config.json")));
      await assert.rejects(readFile(join(home, "providers.json")));
      await assert.rejects(
        readFile(join(home, "cache", "legacy-index.sqlite")),
      );
      const second = await runStorageMigrations(home);
      assert.equal(second.executions.length, 0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("normalizes released permission selectors without retaining legacy fields", () => {
    const migrated = migrateLegacyPermissionValue({
      version: 1,
      scope: "always_global",
      exceptions: [
        {
          id: "exception_paths",
          effect: "deny",
          selector: {
            kind: "path_glob",
            access: "read_write",
            pattern: "secrets/**",
          },
        },
        {
          id: "exception_command",
          effect: "allow",
          selector: { kind: "command_prefix", tokens: ["pnpm", "test"] },
        },
      ],
    }) as {
      version: number;
      scope: string;
      exceptions: Array<Record<string, unknown>>;
    };

    assert.equal(migrated.version, 2);
    assert.equal(migrated.scope, "always_user");
    assert.deepEqual(
      migrated.exceptions.map(({ tool, effect, rule }) => ({
        tool,
        effect,
        rule,
      })),
      [
        ...["read", "grep", "find", "ls", "edit", "write"].map((tool) => ({
          tool,
          effect: "deny",
          rule: "secrets/**",
        })),
        { tool: "bash", effect: "allow", rule: "pnpm test{, *}" },
      ],
    );
    assert.equal(JSON.stringify(migrated).includes("selector"), false);
  });
});
