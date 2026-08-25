import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_SCHEMA_VERSION } from "../src/infrastructure/canonical-store/schema.js";
import { migrateLegacyPermissionValue } from "../src/infrastructure/migrations/legacy/permission-rules.js";
import { storageMigrationRegistry } from "../src/infrastructure/migrations/registry.js";

describe("canonical storage migration", () => {
  it("has one post-v0.26 migration targeting the final schema", () => {
    assert.equal(storageMigrationRegistry.at(-2)?.id, "0012-remove-workers");
    assert.equal(storageMigrationRegistry.at(-1)?.id, "0013-canonical-storage");
    assert.equal(CANONICAL_SCHEMA_VERSION, 2);
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
