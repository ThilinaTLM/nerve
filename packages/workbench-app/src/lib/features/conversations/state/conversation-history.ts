import type { TransferredConversationEvent } from "@nervekit/contracts/core";

export type HistoryPageRequest = {
  beforeEventId?: string;
  limit: number;
};

export type FetchedHistory = {
  /** The complete selected path, oldest first. */
  events: TransferredConversationEvent[];
  /** Older history may remain unloaded (a page failed or made no progress). */
  hasOlder: boolean;
  /** Newest event of the selected path, as reported by the first page. */
  headEventId: string | null;
  error?: string;
};

/**
 * The original transcript and usage views consume the complete selected path.
 * Every page is fetched before anything is published, so opening a
 * conversation renders its transcript once instead of re-rendering (and
 * re-anchoring the scroll position) for each prepended older page.
 */
export async function fetchCompleteHistory(
  requestPage: (
    page: HistoryPageRequest,
  ) => Promise<TransferredConversationEvent[]>,
  pageSize: number,
  cancelled: () => boolean = () => false,
): Promise<FetchedHistory> {
  const newest = await requestPage({ limit: pageSize });
  let events = chronological(newest);
  let hasOlder = newest.length > 0;
  let error: string | undefined;
  while (hasOlder && !cancelled()) {
    const first = events[0];
    if (!first) break;
    try {
      const older = await requestPage({
        beforeEventId: first.id,
        limit: pageSize,
      });
      const ids = new Set(events.map((event) => event.id));
      events = [
        ...chronological(older).filter((event) => !ids.has(event.id)),
        ...events,
      ];
      hasOlder = older.length > 0;
      // A page that adds nothing must not spin on the same cursor.
      if (events[0]?.id === first.id) break;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      break;
    }
  }
  return { events, hasOlder, headEventId: newest[0]?.id ?? null, error };
}

function chronological(
  events: TransferredConversationEvent[],
): TransferredConversationEvent[] {
  return [...events].sort((a, b) => a.sequence - b.sequence);
}
