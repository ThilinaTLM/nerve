import {
  QUICK_SCRIPT_CALLS_STREAM,
  quickScriptLiveCallSchema,
  type QuickScriptHostCall,
} from "@nervekit/contracts/tools";
import type { ConversationLiveToolOutputSnapshot } from "$lib/presentation/view-models/conversation";

/** A quick_script SDK call row: a settled call, or one still running (live only). */
export type QuickScriptCallRow =
  | QuickScriptHostCall
  | { method: string; summary?: string; outcome: "running" };

/**
 * The SDK-call rows of a running script, from its live `sdk_calls` stream
 * (one JSON event per line), in call order. Unparseable lines are skipped: the
 * client keeps only the stream's tail, so the first line may be cut.
 */
export function liveQuickScriptCalls(
  liveOutput: ConversationLiveToolOutputSnapshot | undefined,
): QuickScriptCallRow[] {
  const text = (liveOutput?.chunks ?? [])
    .filter((chunk) => chunk.stream === QUICK_SCRIPT_CALLS_STREAM)
    .map((chunk) => chunk.text)
    .join("");
  const rows = new Map<number, QuickScriptCallRow>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const event = quickScriptLiveCallSchema.safeParse(json);
    if (!event.success) continue;
    const { phase, seq, ...call } = event.data;
    if (phase === "started") {
      if (!rows.has(seq)) rows.set(seq, { ...call, outcome: "running" });
    } else rows.set(seq, call as QuickScriptHostCall);
  }
  return [...rows].sort(([a], [b]) => a - b).map(([, row]) => row);
}
