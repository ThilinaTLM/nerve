import {
  CONVERSATION_TITLE_IMAGE_MARKER,
  conversationTitleToPlainText,
  splitConversationTitle,
} from "@nervekit/contracts/core";
import type { ConversationActivity } from "./conversation-activity";
import { idleConversationActivity } from "./conversation-activity";
import { conversationStatusLabel } from "./conversation-row-state";
import { compareConversationsByLastUserPromptDesc } from "@nervekit/contracts/core";
import type { ConversationListRow } from "./conversation-list";

export type ConversationTermMatch = {
  score: number;
  indexes?: number[];
  referenceKey?: string;
};
export type ConversationSearchHit<R> = {
  row: R;
  score: number;
  titleIndexes: number[];
  referenceKey?: string;
};

function statusWords(
  row: ConversationListRow,
  activity: ConversationActivity,
): string[] {
  const words = [conversationStatusLabel(activity)?.toLowerCase() ?? ""];
  if (row.conversation.completedAt) words.push("done");
  if (row.conversation.pinned) words.push("pinned");
  if (
    ["needs-user", "error", "aborted", "result-ready"].includes(
      activity.indicator,
    )
  )
    words.push("needs", "attention");
  if (activity.indicator === "error") words.push("error");
  if (activity.indicator === "result-ready") words.push("ready", "review");
  return words;
}

/** Subsequence match with bonuses for word starts and consecutive runs. */
function fuzzy(text: string, term: string): ConversationTermMatch | undefined {
  const lower = text.toLowerCase();
  const at = lower.indexOf(term);
  if (at >= 0) {
    const wordStart = at === 0 || /[\s\-_/.(]/.test(lower[at - 1] ?? "");
    return {
      score: wordStart ? 55 : 45,
      indexes: Array.from({ length: term.length }, (_, i) => at + i),
    };
  }
  if (term.length < 3) return undefined;
  const isStart = (i: number) =>
    i === 0 || /[\s\-_/.(]/.test(lower[i - 1] ?? "");
  // Try every start position; prefer consecutive letters, then word starts.
  let bestIndexes: number[] | undefined;
  let bestScore = -Infinity;
  for (
    let start = lower.indexOf(term[0] ?? "");
    start >= 0;
    start = lower.indexOf(term[0] ?? "", start + 1)
  ) {
    const indexes = [start];
    let score = isStart(start) ? 4 : 0;
    for (const ch of term.slice(1)) {
      const prev = indexes[indexes.length - 1] ?? 0;
      let i = lower[prev + 1] === ch ? prev + 1 : -1;
      if (i >= 0) score += 3;
      else {
        const next = lower.indexOf(ch, prev + 1);
        let wordStart = -1;
        for (let j = next; j >= 0; j = lower.indexOf(ch, j + 1))
          if (isStart(j)) {
            wordStart = j;
            break;
          }
        i = wordStart >= 0 ? wordStart : next;
        if (i >= 0 && isStart(i)) score += 4;
      }
      if (i < 0) {
        score = -Infinity;
        break;
      }
      indexes.push(i);
    }
    const spread = (indexes[indexes.length - 1] ?? 0) - start;
    if (spread > term.length * 6) continue;
    score -= spread / 4;
    if (score > bestScore) {
      bestScore = score;
      bestIndexes = indexes;
    }
  }
  if (!bestIndexes) return undefined;
  const indexes = bestIndexes;
  const score = bestScore;
  // Spread-out matches rank low; cap below substring scores.
  const fuzzyScore = Math.min(35, 10 + score);
  // Scattered letters are noise, not a lazy match.
  return fuzzyScore >= 15 ? { score: fuzzyScore, indexes } : undefined;
}

/** Every term must match. Additional fields (references/images) can supply candidates. */
export function searchConversations<R extends ConversationListRow>(
  rows: R[],
  query: string,
  options: {
    activityById?: Readonly<Record<string, ConversationActivity>>;
    matchField?: (row: R, term: string) => ConversationTermMatch | undefined;
  } = {},
): ConversationSearchHit<R>[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: ConversationSearchHit<R>[] = [];
  for (const row of rows) {
    const words = statusWords(
      row,
      options.activityById?.[row.conversation.id] ?? idleConversationActivity,
    );
    const title = conversationTitleToPlainText(row.conversation.title);
    const hasImage = splitConversationTitle(row.conversation.title).some(
      (segment) => segment.type === "image",
    );
    const indexes = new Set<number>();
    let score = 0;
    let referenceKey: string | undefined;
    let referenceScore = 0;
    for (const term of terms) {
      const candidates = [fuzzy(title, term), options.matchField?.(row, term)];
      if (hasImage && (term === "image" || term === "screenshot"))
        candidates.push({ score: 60 });
      if (term.length >= 2 && words.some((word) => word.startsWith(term)))
        candidates.push({ score: 60 });
      const best = candidates
        .filter((value): value is ConversationTermMatch => Boolean(value))
        .sort((a, b) => b.score - a.score)[0];
      if (!best) {
        score = 0;
        break;
      }
      score += best.score;
      if (best.referenceKey && best.score > referenceScore) {
        referenceKey = best.referenceKey;
        referenceScore = best.score;
      }
      for (const index of best.indexes ?? []) indexes.add(index);
    }
    if (score)
      hits.push({
        row,
        score,
        titleIndexes: [...indexes].sort((a, b) => a - b),
        referenceKey,
      });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      compareConversationsByLastUserPromptDesc(
        a.row.conversation,
        b.row.conversation,
      ),
  );
  const floor = (hits[0]?.score ?? 0) * 0.35;
  return hits.filter((hit) => hit.score >= floor);
}

/** Contiguous runs keep highlighted letters readable without per-letter markup.
 * Indexes and offset use UTF-16 positions in the plain-text title. */
export function conversationTitleRuns(
  title: string,
  indexes: readonly number[],
  offset = 0,
): { text: string; hit: boolean }[] {
  const marks = new Set(indexes);
  const runs: { text: string; hit: boolean }[] = [];
  for (let index = 0; index < title.length; index++) {
    const hit = marks.has(offset + index);
    const last = runs[runs.length - 1];
    if (last?.hit === hit) last.text += title[index];
    else runs.push({ text: title[index] ?? "", hit });
  }
  return runs;
}

/** Display segments retain search offsets even though an icon replaces "(image)". */
export function conversationTitleDisplaySegments(
  title: string,
  indexes: readonly number[],
): (
  | { type: "text"; runs: { text: string; hit: boolean }[] }
  | { type: "image" }
)[] {
  let offset = 0;
  return splitConversationTitle(title).map((segment) => {
    if (segment.type === "image") {
      offset += conversationTitleToPlainText(
        CONVERSATION_TITLE_IMAGE_MARKER,
      ).length;
      return segment;
    }
    const runs = conversationTitleRuns(segment.text, indexes, offset);
    offset += segment.text.length;
    return { type: "text", runs };
  });
}
