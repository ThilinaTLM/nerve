import type { SessionEntry } from "../../api";
import type { TranscriptItem } from "./state.svelte";

export function entriesToTranscript(entries: SessionEntry[]): TranscriptItem[] {
  return entries
    .filter(
      (entry) =>
        entry.role === "user" ||
        entry.role === "assistant" ||
        entry.kind !== "message",
    )
    .map((entry) => ({
      id: entry.id,
      role: entry.role,
      kind: entry.kind,
      text: entry.text,
    }));
}
