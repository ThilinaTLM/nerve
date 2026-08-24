import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { conversationJournalCommitSchema } from "@nervekit/contracts";
import { ConversationJournalRepository } from "../src/domains/conversations/conversation-journal.repository.js";
import { migration0016 } from "../src/infrastructure/migrations/migrations/0016-permission-rules.js";
import { migrateLegacyPermissionValue } from "../src/infrastructure/storage/legacy-permission-rules.js";

describe("legacy permission rule migration", () => {
  it("expands cross-tool selectors into canonical tool rules", () => {
    const migrated = migrateLegacyPermissionValue({
      version: 1,
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
          risk: "command",
          selector: {
            kind: "command_prefix",
            tokens: ["pnpm", "test"],
          },
        },
      ],
      scope: "always_global",
    }) as {
      version: number;
      exceptions: Array<Record<string, unknown>>;
      scope: string;
    };

    assert.equal(migrated.version, 2);
    assert.equal(migrated.scope, "always_user");
    assert.deepEqual(
      migrated.exceptions.slice(0, 6).map(({ tool, effect, rule }) => ({
        tool,
        effect,
        rule,
      })),
      ["read", "grep", "find", "ls", "edit", "write"].map((tool) => ({
        tool,
        effect: "deny",
        rule: "secrets/**",
      })),
    );
    assert.deepEqual(
      (({ tool, effect, rule }) => ({ tool, effect, rule }))(
        migrated.exceptions[6] ?? {},
      ),
      { tool: "bash", effect: "allow", rule: "pnpm test{, *}" },
    );
    assert.match(
      String(migrated.exceptions[0]?.id),
      /^exception_[a-f0-9]{24}$/,
    );
  });

  it("rehashes conversation journals after migrating embedded permissions", async (t) => {
    const home = await mkdtemp(join(tmpdir(), "nerve-permission-journal-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const conversationId = "conv_permission_migration";
    const repository = new ConversationJournalRepository({ paths: { home } });
    const first = await repository.commit(conversationId, {
      kind: "model_context.entry_appended",
      committedAt: "2026-08-23T00:00:00.000Z",
      events: [
        {
          kind: "model_context.entry_appended",
          conversationId,
          entry: {
            type: "permission_snapshot",
            id: "entry_permission_snapshot",
            parentId: null,
            timestamp: "2026-08-23T00:00:00.000Z",
            permissions: {
              version: 1,
              scope: "always_global",
              exceptions: [
                {
                  id: "exception_legacy",
                  effect: "allow",
                  selector: { kind: "tool", toolName: "web_fetch" },
                },
              ],
            },
          },
        },
      ],
    });
    const second = await repository.commit(conversationId, {
      kind: "model_context.leaf_changed",
      committedAt: "2026-08-23T00:00:01.000Z",
      events: [
        {
          kind: "model_context.leaf_changed",
          conversationId,
          entryId: "entry_permission_snapshot",
        },
      ],
    });

    const legacyPath = repository.journalPath(conversationId);
    await mkdir(join(home, "conversations", conversationId), {
      recursive: true,
    });
    await writeFile(
      legacyPath,
      `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
    );

    await migration0016.up({
      paths: { home },
      now: () => new Date("2026-08-23T00:00:02.000Z"),
    } as never);

    const commits = (
      await readFile(repository.journalPath(conversationId), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => conversationJournalCommitSchema.parse(JSON.parse(line)));
    assert.notEqual(commits[0]?.checksum, first.checksum);
    assert.notEqual(commits[1]?.checksum, second.checksum);
    assert.equal(commits[1]?.previousChecksum, commits[0]?.checksum);
    const migratedEvent = commits[0]?.events[0];
    assert.ok(migratedEvent?.kind === "model_context.entry_appended");
    const permissions = migratedEvent.entry.permissions as {
      version: number;
      scope: string;
      exceptions: Array<Record<string, unknown>>;
    };
    assert.equal(permissions.version, 2);
    assert.equal(permissions.scope, "always_user");
    assert.deepEqual(
      permissions.exceptions.map(({ tool, effect, rule }) => ({
        tool,
        effect,
        rule,
      })),
      [{ tool: "web_fetch", effect: "allow", rule: "*" }],
    );
    assert.match(
      String(permissions.exceptions[0]?.id),
      /^exception_[a-f0-9]{24}$/,
    );
    assert.equal(
      (
        await new ConversationJournalRepository({ paths: { home } }).load(
          conversationId,
        )
      ).revision,
      2,
    );
  });

  it("converts host and whole-tool selectors without retaining legacy fields", () => {
    const migrated = migrateLegacyPermissionValue([
      {
        id: "exception_web",
        effect: "allow",
        risk: "network",
        selector: { kind: "web_host", pattern: "*.example.com" },
      },
      {
        id: "exception_tool",
        effect: "deny",
        selector: { kind: "tool", toolName: "python_exec" },
      },
    ]);

    assert.deepEqual(
      JSON.parse(JSON.stringify(migrated), (_key, value) =>
        typeof value === "string" && value.startsWith("exception_")
          ? "exception_id"
          : value,
      ),
      [
        {
          tool: "web_fetch",
          effect: "allow",
          rule: "*://*.example.com/**",
          id: "exception_id",
        },
        {
          tool: "python_exec",
          effect: "deny",
          rule: "*",
          id: "exception_id",
        },
      ],
    );
  });
});
