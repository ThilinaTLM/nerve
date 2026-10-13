import assert from "node:assert/strict";
import { test } from "node:test";
import type { TransferredConversationEvent } from "@nervekit/contracts/core";
import {
  fetchCompleteHistory,
  type HistoryPageRequest,
} from "./conversation-history";

function event(sequence: number): TransferredConversationEvent {
  return { id: `e${sequence}`, sequence } as TransferredConversationEvent;
}

/** Pages newest-first, like `conversation.getHistory`. */
function pagedHistory(total: number) {
  const all = Array.from({ length: total }, (_, index) => event(index + 1));
  const requests: HistoryPageRequest[] = [];
  const requestPage = async (page: HistoryPageRequest) => {
    requests.push(page);
    const end = page.beforeEventId
      ? all.findIndex((item) => item.id === page.beforeEventId)
      : all.length;
    return all.slice(Math.max(0, end - page.limit), end).reverse();
  };
  return { requestPage, requests };
}

test("fetches every page before returning one chronological path", async () => {
  const { requestPage, requests } = pagedHistory(7);
  const history = await fetchCompleteHistory(requestPage, 3);
  assert.deepEqual(
    history.events.map((item) => item.sequence),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(history.headEventId, "e7");
  assert.equal(history.hasOlder, false);
  assert.deepEqual(
    requests.map((request) => request.beforeEventId),
    [undefined, "e5", "e2", "e1"],
  );
});

test("keeps the loaded path and reports a failed older page", async () => {
  const { requestPage } = pagedHistory(5);
  let calls = 0;
  const history = await fetchCompleteHistory(async (page) => {
    calls += 1;
    if (calls === 2) throw new Error("offline");
    return requestPage(page);
  }, 2);
  assert.deepEqual(
    history.events.map((item) => item.sequence),
    [4, 5],
  );
  assert.equal(history.hasOlder, true);
  assert.equal(history.error, "offline");
});

test("stops when an older page makes no progress", async () => {
  let calls = 0;
  const history = await fetchCompleteHistory(async () => {
    calls += 1;
    return [event(2), event(1)];
  }, 2);
  assert.equal(calls, 2);
  assert.deepEqual(
    history.events.map((item) => item.sequence),
    [1, 2],
  );
});
