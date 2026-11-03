import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SUBAGENT_REPORT_INLINE_BYTES } from "@nervekit/contracts/subagents";
import { formatByteSize } from "@nervekit/tools/result-projection";
import type { ConversationCore, ExecutionFinished } from "../core.js";

export function finalAssistantText(
  core: ConversationCore,
  result: ExecutionFinished,
): string {
  for (const event of core.getHistory(result.conversationId, {
    limit: Number.MAX_SAFE_INTEGER,
  })) {
    if (event.id === result.executionId) break;
    if (event.sequence > result.event.sequence) continue;
    if (event.type === "assistant_message") {
      const report = event.payload.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      if (report) return report;
    }
  }
  return "";
}

/** Inline report text: capped at the inline limit, with the full text spilled to the child's report file. */
export function inlineReport(
  core: ConversationCore,
  childId: string,
  executionId: string,
  report: string,
): string {
  const bytes = Buffer.from(report, "utf8");
  if (bytes.length <= SUBAGENT_REPORT_INLINE_BYTES) return report;
  const path = join(
    core.dataDir,
    "conversations",
    childId,
    "reports",
    `${executionId}.md`,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, report);
  // A cut inside a multi-byte character decodes to U+FFFD; drop it.
  const head = bytes
    .subarray(0, SUBAGENT_REPORT_INLINE_BYTES)
    .toString("utf8")
    .replace(/\uFFFD+$/u, "");
  const omitted = bytes.length - Buffer.byteLength(head, "utf8");
  return `${head}\n[Showing the first ${formatByteSize(bytes.length - omitted)} of ${formatByteSize(bytes.length)}; ${formatByteSize(omitted)} omitted. Full response: ${path}]`;
}

/**
 * Labels a child's last message. Only a completed execution ends with a report; after a failure,
 * interruption or stop the last message is often mid-task narration and must not read as one.
 */
export function lastMessageLabel(finished: boolean): string {
  return finished ? "Final response:" : "Last message:";
}
