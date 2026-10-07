import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { INTERRUPTED_TOOL_ERROR_CODE } from "@nervekit/contracts/events";
import { WorkbenchRunCancellation } from "../../../src/domains/runs/adapters/workbench-run-cancellation.js";
import { RUN_CANCELLED_TOOL_OUTCOME } from "../../../src/domains/tools/execution/tool-termination.js";
import { agent, buildToolService } from "./tool-service-test-fixture.js";

for (const winningStatus of ["completed", "failed", "cancelled"] as const) {
  test(`late run cancellation preserves an in-lock ${winningStatus} tool settlement and leaves replacement work alone`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-terminal-race-"));
    const owner = agent("autonomous");
    const { service, journal, journalCommit, events } = buildToolService(
      home,
      owner,
    );
    t.after(async () => {
      await journal.close();
      await rm(home, { recursive: true, force: true });
    });
    const runId = "run_original";
    const draft = await service.requestTool(
      owner,
      "todos_set",
      { todos: [{ todo: "original", done: false }] },
      { runId, forceApproval: true, durableSuspend: true },
    );
    await service.projectApprovalDecision(
      {
        toolCallId: draft.toolCall.id,
        ordinal: 0,
        decision: "allow",
        resolutionRequestId: "allow-original",
      },
      journalCommit,
    );
    const claimed = await service.claimApprovedExecution(draft.toolCall.id);
    const replacement = await service.requestTool(
      owner,
      "todos_set",
      { todos: [{ todo: "replacement", done: false }] },
      { runId: "run_replacement", forceApproval: true, durableSuspend: true },
    );
    const replacementBefore = await service.getToolCallDetails(
      replacement.toolCall.id,
    );

    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commit = journal.commit.bind(journal);
    journal.commit = async (...args) => {
      if (
        args[1].events.some(
          (event) =>
            event.kind === "tool_call.upserted" &&
            event.toolCall.id === claimed.id &&
            event.toolCall.status === winningStatus,
        )
      ) {
        enter();
        await gate;
      }
      return commit(...args);
    };
    // Hold a real terminal commit inside the repository mutation lock. The
    // cancellation snapshot still sees the active revision, then queues behind it.
    const winning =
      winningStatus === "completed"
        ? service.completeToolCall(claimed.id, { content: "original result" })
        : service
            .terminateNonTerminalToolCallsForRun(
              runId,
              winningStatus === "cancelled"
                ? RUN_CANCELLED_TOOL_OUTCOME
                : {
                    status: "failed",
                    code: INTERRUPTED_TOOL_ERROR_CODE,
                    message: "original execution failed",
                  },
            )
            .then((records) => records[0]!);
    await entered;
    assert.equal(service.getToolCall(claimed.id).status, "running");
    const fencedRuns: string[] = [];
    const cancellation = new WorkbenchRunCancellation(
      {} as never,
      service,
      {} as never,
      {} as never,
      {} as never,
      {
        fenceCancelledRunToolWork: async (input: { runId: string }) => {
          fencedRuns.push(input.runId);
          return [];
        },
      } as never,
    );
    const cancelling = cancellation.cancelTools({ runId } as never);
    release();
    const original = await winning;
    assert.equal(await cancelling, "confirmed");
    assert.equal(original.status, winningStatus);
    assert.equal(original.revision, claimed.revision + 1);
    assert.deepEqual(await service.getToolCallDetails(claimed.id), original);
    assert.deepEqual(
      await service.getToolCallDetails(replacement.toolCall.id),
      replacementBefore,
    );
    assert.equal(
      await cancellation.cancelTools({ runId } as never),
      "not_running",
    );
    assert.deepEqual(fencedRuns, [runId, runId]);
    assert.deepEqual(await service.getToolCallDetails(claimed.id), original);
    const terminalPublications = events.filter((event) => {
      const record = (event.data as { toolCall?: ToolCallRecord }).toolCall;
      return (
        event.type === "toolCall.updated" &&
        record?.id === claimed.id &&
        record.status === winningStatus
      );
    });
    assert.equal(
      terminalPublications.length,
      1,
      "losing cancellation must not republish or overwrite the terminal result",
    );
  });
}
