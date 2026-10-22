import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { StepContext } from "../../framework/step.js";
import { json, safePath } from "./files.js";
import {
  frozenAppliedSchema,
  frozenCapabilitiesSchema,
  frozenProfileFileSchema,
  record,
  type Data,
} from "./phase5-format.js";
import { phaseProgress } from "./progress.js";

const optional = (path: string): Data | undefined => {
  safePath(path);
  return existsSync(path) ? record(json(path)) : undefined;
};

export async function verifyPhase5(
  ctx: StepContext,
  projects: readonly string[],
  conversations: readonly string[],
) {
  const receipts = readdirSync(ctx.scratchDir).filter(
    (name) => name.startsWith("phase5-") && name.endsWith(".json"),
  );
  const receiptsProgress = phaseProgress(
    ctx,
    "verify-receipts",
    "Verifying conversion receipts",
    receipts.length,
  );
  await receiptsProgress();
  let receiptsDone = 0;
  for (const name of receipts) {
    const receipt = record(json(join(ctx.scratchDir, name)));
    const targets = receipt.targets ?? receipt.outputs;
    if (targets)
      for (const [path, expected] of Object.entries(targets))
        assert.deepEqual(
          json(path),
          expected,
          `Changed phase-5 output: ${path}`,
        );
    await receiptsProgress(++receiptsDone);
  }
  await phaseProgress(
    ctx,
    "verify-settings",
    "Verifying agent settings and templates",
  )();
  for (const root of [ctx.paths.home, ...projects]) {
    const aggregate = join(root, "config/agent-profiles.json");
    if (ctx.discarded.has(aggregate)) continue;
    assert(
      !existsSync(aggregate),
      `Aggregate profile document remains: ${aggregate}`,
    );
    const directory =
      root === ctx.paths.home
        ? join(root, "data/agent-profiles")
        : join(root, "agent-profiles");
    safePath(directory);
    if (existsSync(directory))
      for (const name of readdirSync(directory).filter((name) =>
        name.endsWith(".json"),
      )) {
        const profile = frozenProfileFileSchema.parse(
          json(join(directory, name)),
        );
        assert.equal(name, `${profile.name}.json`);
      }
    const harness = optional(join(root, "config/harness.json"));
    if (harness) {
      assert.equal(harness.version, 4);
      assert(!harness.execution);
      if (root !== ctx.paths.home) assert(!harness.tools && !harness.skills);
      else frozenCapabilitiesSchema.shape.tools.parse(harness.tools);
    }
    const capabilities = optional(join(root, "config/capabilities.json"));
    if (capabilities) frozenCapabilitiesSchema.parse(capabilities);
  }
  const conversationProgress = phaseProgress(
    ctx,
    "verify-conversations",
    "Verifying conversation profiles",
    conversations.length,
  );
  await conversationProgress();
  let conversationsDone = 0;
  for (const id of conversations) {
    if (!ctx.discarded.has(id)) {
      const root = join(ctx.paths.home, "data/conversations", id, "config");
      assert(
        !existsSync(join(root, "agent-profiles.json")) &&
          !existsSync(join(root, "subagents.json")),
        `Conversation template catalogs remain: ${id}`,
      );
      frozenAppliedSchema.parse(json(join(root, "applied-agent-profile.json")));
      frozenCapabilitiesSchema.parse(json(join(root, "capabilities.json")));
    }
    await conversationProgress(++conversationsDone);
  }
}
