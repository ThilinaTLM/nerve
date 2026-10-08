import assert from "node:assert/strict";
import { it } from "node:test";
import { buildConversationRenderProjection } from "./render";
import { emptyConversationRenderState } from "./conversation-render-state";
import { conversationAttentionRows } from "./conversation-attention";
import { systemEventNoticeModel } from "../transcript/notice/system-event-notice";

it("snapshot restrictions become scrolling notices without hiding history", () => {
  const projection = buildConversationRenderProjection({
    ...emptyConversationRenderState("conv_one"),
    entries: [
      {
        id: "entry_one",
        conversationId: "conv_one",
        role: "user",
        kind: "message",
        text: "hello",
        createdAt: "2026-10-08T00:00:00.000Z",
      },
    ],
    activeEntryIds: ["entry_one"],
    readOnly: true,
    fallbackReason: "Snapshot could not be refreshed",
  });
  assert.equal(projection.timeline[0]?.kind, "message");
  const notice = projection.timeline.at(-1);
  assert.equal(notice?.kind, "system_event");
  if (notice?.kind !== "system_event") throw new Error("notice missing");
  assert.match(
    notice.notice.text,
    /Read-only snapshot.*could not be refreshed/,
  );
  assert.equal(systemEventNoticeModel(notice.notice).tone, "warning");
});

it("recovery attention has stable timeline identity and retains non-replay guidance", () => {
  const input = {
    recoveryIssues: [
      {
        id: "recovery_one",
        conversationId: "conv_one",
        code: "outcome_unknown" as const,
        message: "Unknown write",
        actions: ["inspect", "authorize_retry"] as const,
        createdAt: "2026-10-08T00:00:00.000Z",
      },
    ],
  };
  const rows = conversationAttentionRows({
    recoveryIssues: input.recoveryIssues.map((issue) => ({
      ...issue,
      actions: [...issue.actions],
    })),
  });
  const row = rows[0];
  if (row?.kind !== "system_event") throw new Error("notice missing");
  assert.match(row.notice.text, /did not repeat.*explicitly authorize/);
  assert.equal(row.key, "recovery:recovery_one");
});

it("request failures stay visible inside the scrolling transcript rather than a top-level alert", () => {
  const projection = buildConversationRenderProjection({
    ...emptyConversationRenderState("conv_one"),
    error: "Prompt could not be sent",
  });
  const row = projection.timeline[0];
  if (row?.kind !== "system_event") throw new Error("notice missing");
  assert.equal(row.notice.text, "Prompt could not be sent");
  assert.equal(systemEventNoticeModel(row.notice).tone, "destructive");
});
