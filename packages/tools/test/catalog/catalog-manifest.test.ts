import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Check } from "typebox/value";
import { toolNameSchema } from "@nervekit/contracts/tools";
import {
  toolManifest,
  requireToolDefinition,
} from "../../src/catalog/manifest.js";

describe("model-facing tool schema compatibility", () => {
  it("declares a reviewed agent-result policy for every active tool", () => {
    // `quick_script` is defined in @nervekit/quick-script and registered by the host.
    assert.deepEqual(
      toolManifest.map((definition) => definition.name).sort(),
      toolNameSchema.options.filter((name) => name !== "quick_script").sort(),
    );
    assert.deepEqual(
      toolManifest.filter((definition) => !definition.agentResult),
      [],
    );
    assert.equal(
      new Set(toolManifest.map((definition) => definition.name)).size,
      toolManifest.length,
    );

    it("locks the simplified model-facing property sets and schema budget", () => {
      const expectedProperties: Record<string, string[]> = {
        edit: ["path", "edits"],
        async_bash: ["action", "all", "id", "offset", "limit"],
        launch: ["action", "name", "runId", "offset", "limit"],
      };
      for (const [name, expected] of Object.entries(expectedProperties)) {
        const schema = requireToolDefinition(name as never).parameters as {
          properties?: Record<string, unknown>;
        };
        assert.deepEqual(Object.keys(schema.properties ?? {}), expected, name);
      }

      const editSchemaSize = JSON.stringify(
        requireToolDefinition("edit").parameters,
      ).length;
      const catalogSchemaSize = toolManifest.reduce(
        (total, definition) =>
          total + JSON.stringify(definition.parameters).length,
        0,
      );
      assert.ok(
        editSchemaSize <= 800,
        `edit schema is ${editSchemaSize} chars`,
      );
      assert.ok(
        catalogSchemaSize <= 6_500,
        `catalog schemas total ${catalogSchemaSize} chars`,
      );
    });
  });

  it("uses a JSON object root for every tool definition", () => {
    for (const definition of toolManifest) {
      const serialized = JSON.parse(JSON.stringify(definition.parameters)) as {
        type?: unknown;
      };
      assert.equal(serialized.type, "object", definition.name);
    }
  });

  it("excludes removed plan tools from active schemas and the catalog", () => {
    for (const name of ["plan_mode_enter", "plan_mode_force_exit"]) {
      assert.equal(toolNameSchema.safeParse(name).success, false, name);
      assert.equal(
        toolManifest.some((definition) => definition.name === name),
        false,
        name,
      );
    }
  });

  it("selects launches by name with optional execution IDs, not definition IDs", () => {
    const schema = requireToolDefinition("launch").parameters;
    assert.equal(Check(schema, { action: "status" }), true);
    assert.equal(Check(schema, { action: "start", name: "Dev server" }), true);
    for (const action of ["logs", "stop", "restart"]) {
      assert.equal(
        Check(schema, { action, name: "Dev server", runId: "run_1" }),
        true,
      );
    }
    for (const args of [
      { action: "start", id: "launchdef_dev" },
      { action: "start", name: "" },
      { action: "logs", name: "Dev server", runId: "" },
    ]) {
      assert.equal(Check(schema, args), false);
    }
  });

  it("keeps plan_present limited to the plan file path", () => {
    const schema = requireToolDefinition("plan_present").parameters;
    assert.equal(Check(schema, { file_path: "/tmp/plan.md" }), true);
    assert.equal(
      Check(schema, { file_path: "/tmp/plan.md", summary: "override" }),
      false,
    );
    assert.equal(
      Check(schema, { file_path: "/tmp/plan.md", title: "override" }),
      false,
    );
  });
});
