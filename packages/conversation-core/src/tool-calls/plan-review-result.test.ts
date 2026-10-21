import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssetStore } from "../assets/asset-store.js";
import { prepareToolResult } from "./tool-result.service.js";
import {
  toolCallSchema,
  storedToolResultSchema,
} from "@nervekit/contracts/core";
import { buildUserProjection } from "@nervekit/tools/result-projection";
import { planReviewDisplayResult } from "./plan-review-result.js";

function call(decision: "approve" | "reject") {
  return toolCallSchema.parse({
    id: "tool_plan",
    conversationId: "conv_1",
    turnId: "turn_1",
    providerCallId: "provider_1",
    assistantEventId: "event_1",
    contentIndex: 0,
    origin: "model",
    toolName: "plan_present",
    arguments: { file_path: "/plans/original.md" },
    state: "awaiting_input",
    supervision: null,
    executionClaim: null,
    updatedAt: "2026-10-14T00:00:00Z",
    interaction: {
      kind: "plan_review",
      request: {
        assetId: "asset_1",
        path: "/snapshot/plan.md",
        title: "Plan",
        summary: "Reviewed summary",
        content: "# Reviewed snapshot\n\nImplement this approach.",
      },
      resolution: {
        kind: "plan_review",
        decision,
        feedback: "Review feedback",
      },
    },
  });
}

for (const decision of ["approve", "reject"] as const) {
  test(`${decision} preserves the reviewed snapshot in completed display data`, () => {
    const source = call(decision);
    const result = {
      content:
        decision === "approve"
          ? "Plan approved. Switched to the default profile."
          : "Plan rejected.",
      details: { decision },
    };
    const display = planReviewDisplayResult(source, "completed", result);
    const review = JSON.parse(JSON.stringify(display)).details.review;
    assert.equal(
      review.content,
      source.interaction?.kind === "plan_review"
        ? source.interaction.request.content
        : undefined,
    );
    assert.equal(
      review.status,
      decision === "approve" ? "accepted" : "changes_requested",
    );
    assert.equal(review.planPath, "/snapshot/plan.md");
    assert.equal(review.feedback, "Review feedback");
    const projection = buildUserProjection(
      source.toolName,
      source.arguments,
      display,
    );
    const reconstructed = JSON.parse(JSON.stringify(projection.resultPreview));
    assert.equal(reconstructed.review.content, review.content);
    assert.equal(reconstructed.review.status, review.status);
    assert.deepEqual(result.details, { decision });
  });
}

test("does not mark cancellations, failures, pending reviews or unrelated tools as resolved plans", () => {
  const source = call("approve");
  const result = { content: "Stopped" };
  for (const outcome of [
    "cancelled",
    "failed",
    "denied",
    "indeterminate",
  ] as const) {
    assert.equal(planReviewDisplayResult(source, outcome, result), result);
  }
  assert.equal(
    planReviewDisplayResult(
      { ...source, toolName: "ask_user" },
      "completed",
      result,
    ),
    result,
  );
  assert.ok(source.interaction?.kind === "plan_review");
  const pending = {
    ...source,
    interaction: { ...source.interaction, resolution: undefined },
  };
  assert.equal(planReviewDisplayResult(pending, "completed", result), result);
});

test("long snapshots stay complete in the payload and bounded in transcript previews", () => {
  const source = call("approve");
  assert.ok(source.interaction?.kind === "plan_review");
  source.interaction.request.content = Array.from(
    { length: 300 },
    (_, i) => `Plan line ${i}`,
  ).join("\n");
  const display = planReviewDisplayResult(source, "completed", {
    content: "Plan approved.",
  });
  const stored = JSON.parse(JSON.stringify(display));
  assert.equal(
    stored.details.review.content,
    source.interaction.request.content,
  );
  const projection = buildUserProjection(
    source.toolName,
    source.arguments,
    display,
  );
  const preview = JSON.parse(JSON.stringify(projection.resultPreview));
  assert.ok(
    preview.review.content.length < stored.details.review.content.length,
  );
  assert.equal(preview.review.status, "accepted");
  assert.equal(preview.details.review, undefined);
  assert.ok(projection.previewOverflow);
});

test("settlement persists display metadata without adding the plan to agent context", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-plan-result-"));
  const payloads: string[] = [];
  const assets = {
    path: (path: string) => join(root, path),
    async write(input: { content: string; logicalPath: string }) {
      payloads.push(input.content);
      return {
        id: "asset_payload",
        logicalPath: input.logicalPath,
        byteLength: Buffer.byteLength(input.content),
      };
    },
  } as unknown as AssetStore;
  try {
    const prepared = await prepareToolResult(
      assets,
      call("approve"),
      "completed",
      {
        content: "Plan approved. Switched to the default profile.",
        details: { decision: "approve" },
      },
    );
    const persisted = JSON.parse(
      JSON.stringify(storedToolResultSchema.parse(JSON.parse(payloads[0]))),
    );
    assert.equal(persisted.details.review.status, "accepted");
    assert.match(persisted.details.review.content, /Reviewed snapshot/);
    const preview = JSON.parse(
      JSON.stringify(prepared.userProjection.resultPreview),
    );
    assert.equal(preview.review.content, persisted.details.review.content);
    assert.doesNotMatch(
      JSON.stringify(prepared.agentProjection),
      /Reviewed snapshot|Implement this approach/,
    );
    assert.match(JSON.stringify(prepared.agentProjection), /Plan approved/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
