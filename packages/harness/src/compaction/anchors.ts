import type {
  AnchorOverflow,
  CheckpointAnchor,
  CheckpointDetails,
} from "@nervekit/contracts/conversations";
import type { ConversationTreeEntry } from "../conversation/entries.js";
import { estimateRetainedContextTokens } from "./usage.js";
import { createCompactionSummaryMessage } from "../messages/messages.js";

export function selectCheckpointAnchors(
  entries: ConversationTreeEntry[],
  cutIndex: number,
  budget: number,
  previous?: CheckpointDetails,
) {
  const candidates = new Map<string, CheckpointAnchor>();
  for (const anchor of previous?.anchors ?? [])
    candidates.set(anchor.sourceEntryId, anchor);
  for (const entry of entries.slice(0, cutIndex)) {
    const provenance = entry.compactionAnchor;
    if (!provenance) continue;
    const message = entry.type === "message" ? entry.message : undefined;
    if (message?.role === "harness") continue;
    const text =
      provenance.text ??
      (message?.role === "user"
        ? typeof message.content === "string"
          ? message.content
          : message.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("")
        : entry.type === "custom_message" && typeof entry.content === "string"
          ? entry.content
          : undefined);
    if (text)
      candidates.set(entry.id, {
        sourceEntryId: entry.id,
        kind: provenance.kind,
        text,
      });
  }
  // Anchors already retained verbatim must not be rendered a second time.
  const retainedIds = new Set(entries.slice(cutIndex).map((e) => e.id));
  const all = [...candidates.values()].filter(
    (a) => !retainedIds.has(a.sourceEntryId),
  );
  // Copied parent histories may contain a root request; the child's explicit assignment owns its scope.
  const initial =
    all.find((a) => a.kind === "assignment") ??
    all.find((a) => a.kind === "request");
  const ordered = [
    initial,
    ...all.filter((a) => a.kind === "plan"),
    ...all.filter((a) => a.kind === "steering").reverse(),
  ].filter((a): a is CheckpointAnchor => !!a);
  const selected = new Set<string>();
  const overflow = new Map(
    (previous?.anchorOverflow ?? []).map((a) => [a.sourceEntryId, a]),
  );
  const tokens = (anchors: CheckpointAnchor[]) =>
    estimateRetainedContextTokens([
      createCompactionSummaryMessage("", 0, new Date(0).toISOString(), anchors),
    ]) -
    estimateRetainedContextTokens([
      createCompactionSummaryMessage("", 0, new Date(0).toISOString()),
    ]);
  let chosen: CheckpointAnchor[] = [];
  for (const anchor of ordered) {
    if (selected.has(anchor.sourceEntryId)) continue;
    if (tokens([...chosen, anchor]) > budget) {
      if (anchor === initial || anchor.kind === "plan")
        overflow.set(anchor.sourceEntryId, {
          sourceEntryId: anchor.sourceEntryId,
          kind: anchor.kind,
        });
      continue;
    }
    chosen.push(anchor);
    selected.add(anchor.sourceEntryId);
    overflow.delete(anchor.sourceEntryId);
  }
  chosen = all.filter((a) => selected.has(a.sourceEntryId));
  return {
    anchors: chosen,
    anchorTokens: tokens(chosen),
    checkpointOverheadTokens: estimateRetainedContextTokens([
      createCompactionSummaryMessage("", 0, new Date(0).toISOString(), chosen),
    ]),
    anchorOverflow: [...overflow.values()] as AnchorOverflow[],
  };
}
