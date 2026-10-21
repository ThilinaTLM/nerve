import assert from "node:assert/strict";
import { it } from "node:test";
import { subagentToolDefinitions } from "../../src/catalog/definitions/orchestration/subagent.tools.js";

// Baseline: the six pre-profiles tools (`explore` + five `subagent_*`) plus the
// old `subagents` guideline. Measured once from git HEAD before this change as the
// UTF-8 bytes of one JSON.stringify({ name, description, parameters }) line per
// tool, joined by "\n" (3766 bytes), plus the old guideline text (735 bytes).
const OLD_DEFINITIONS_BYTES = 3766;
const OLD_GUIDELINE_BYTES = 735;

it("sub-agent definitions stay below the pre-profiles definitions and guideline baseline", () => {
  const definitions = Buffer.byteLength(
    subagentToolDefinitions
      .map((tool) =>
        JSON.stringify({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        }),
      )
      .join("\n"),
  );
  assert.ok(definitions > 0);
  assert.ok(
    definitions < OLD_DEFINITIONS_BYTES + OLD_GUIDELINE_BYTES,
    `${definitions} bytes must be below ${OLD_DEFINITIONS_BYTES} + ${OLD_GUIDELINE_BYTES}`,
  );
  console.log(`sub-agent budget: ${definitions} bytes (no separate guideline)`);
});
