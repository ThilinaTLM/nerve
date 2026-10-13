import assert from "node:assert/strict";
import { test } from "node:test";
import type { AsyncBash } from "@nervekit/contracts/core";
import {
  AsyncBashLogSession,
  asyncBashLogLines,
  mergeLogWindow,
  PAGE_BYTES,
  WINDOW_BYTES,
  type LogResult,
  type LogParams,
  type LogStream,
} from "./async-bash-log-window";
const bash = { id: "bash1", status: "completed" } as AsyncBash;
const chunk = (
  text: string,
  offset = 0,
  totalBytes = offset + Buffer.byteLength(text),
): LogStream => ({
  stream: "combined",
  text,
  offset,
  nextOffset: offset + Buffer.byteLength(text),
  totalBytes,
});

test("append and earlier merge byte windows without duplicate UTF-8", () => {
  const current = [chunk("αβγ", 2, 10)];
  assert.equal(mergeLogWindow(current, [chunk("γδ", 6, 10)])[0].text, "αβγδ");
  assert.equal(
    mergeLogWindow(current, [chunk("xαβ", 1, 10)], true)[0].text,
    "xαβγ",
  );
  assert.deepEqual(mergeLogWindow(current, [chunk("new")]), [chunk("new")]);
});

test("bounds display bytes and trims at UTF-8 boundaries in either direction", () => {
  const text = "α".repeat(WINDOW_BYTES);
  for (const earlier of [false, true]) {
    const [window] = mergeLogWindow([], [chunk(text)], earlier);
    assert.ok(Buffer.byteLength(window.text) <= WINDOW_BYTES);
    assert.equal(window.text.includes("�"), false);
    assert.equal(
      window.nextOffset - window.offset,
      Buffer.byteLength(window.text),
    );
  }
  const windows = mergeLogWindow(
    [],
    [
      { ...chunk(text), stream: "stdout" },
      { ...chunk(text), stream: "stderr" },
    ],
  );
  assert.ok(
    windows.reduce((sum, stream) => sum + Buffer.byteLength(stream.text), 0) <=
      WINDOW_BYTES,
  );
});

test("tail, append, earlier use bounded byte offsets; completed sessions do not poll", async () => {
  const requests: unknown[] = [];
  const session = new AsyncBashLogSession(
    "conv",
    "bash1",
    async (params) => {
      requests.push(params);
      return { bash, streams: [chunk("α", PAGE_BYTES)] };
    },
    () => {},
    5,
  );
  session.start();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(requests.length, 1);
  await session.load("append");
  await session.load("earlier");
  assert.deepEqual(requests, [
    {
      conversationId: "conv",
      bashId: "bash1",
      offsets: undefined,
      limit: PAGE_BYTES,
    },
    {
      conversationId: "conv",
      bashId: "bash1",
      offsets: { combined: PAGE_BYTES + 2 },
      limit: PAGE_BYTES,
    },
    {
      conversationId: "conv",
      bashId: "bash1",
      offsets: { combined: 0 },
      limit: PAGE_BYTES,
    },
  ]);
  session.stop();
});

test("load earlier splits the page budget across separate streams without gaps", async () => {
  const requests: LogParams[] = [];
  const session = new AsyncBashLogSession(
    "conv",
    "bash1",
    async (params) => {
      requests.push(params);
      return {
        bash,
        streams: [
          { ...chunk("out", PAGE_BYTES), stream: "stdout" },
          { ...chunk("err", PAGE_BYTES), stream: "stderr" },
        ],
      };
    },
    () => {},
  );
  session.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await session.load("earlier");
  assert.deepEqual(requests[1].offsets, {
    stdout: PAGE_BYTES / 2,
    stderr: PAGE_BYTES / 2,
  });
  session.stop();
});

test("earlier inspection pauses live append until tail refresh resumes", async () => {
  let count = 0;
  const tail = chunk("x".repeat(WINDOW_BYTES), WINDOW_BYTES * 2);
  const session = new AsyncBashLogSession(
    "conv",
    "bash1",
    async (params) => {
      count++;
      const stream =
        params.offsets?.combined === undefined
          ? tail
          : chunk(
              "x".repeat(PAGE_BYTES),
              params.offsets.combined,
              tail.totalBytes,
            );
      return { bash: { ...bash, status: "running" }, streams: [stream] };
    },
    () => {},
    5,
  );
  session.start();
  await new Promise((done) => setTimeout(done, 0));
  await session.load("earlier");
  const earlier = session.streams[0];
  assert.equal(session.following, false);
  assert.ok(earlier.nextOffset < tail.nextOffset);
  assert.ok(Buffer.byteLength(earlier.text) <= WINDOW_BYTES);
  await session.load("append");
  await new Promise((done) => setTimeout(done, 15));
  assert.equal(count, 2);
  assert.equal(session.streams[0], earlier);
  await session.load("tail");
  assert.equal(session.following, true);
  assert.equal(session.streams[0].nextOffset, tail.nextOffset);
  await new Promise((done) => setTimeout(done, 15));
  assert.ok(count >= 4);
  session.stop();
});

test("earlier requested during an in-flight append queues once and cancels live scheduling", async () => {
  let count = 0;
  let resolve!: (result: LogResult) => void;
  const session = new AsyncBashLogSession(
    "conv",
    "bash1",
    () => {
      count++;
      if (count === 1)
        return new Promise((done) => {
          resolve = done;
        });
      return Promise.resolve({
        bash: { ...bash, status: "running" },
        streams: [chunk("earlier")],
      });
    },
    () => {},
    5,
  );
  session.start();
  await session.load("earlier");
  resolve({
    bash: { ...bash, status: "running" },
    streams: [chunk("latest", PAGE_BYTES)],
  });
  await new Promise((done) => setTimeout(done, 15));
  assert.equal(count, 2);
  assert.equal(session.following, false);
  session.stop();
});

test("a tail refresh queued during an earlier read resumes following and discards the historical window", async () => {
  let resolveEarlier!: (result: LogResult) => void;
  const requests: LogParams[] = [];
  const latest = { bash, streams: [chunk("latest", PAGE_BYTES)] };
  const session = new AsyncBashLogSession(
    "conv",
    "bash1",
    (params) => {
      requests.push(params);
      if (requests.length === 2)
        return new Promise((done) => {
          resolveEarlier = done;
        });
      return Promise.resolve(latest);
    },
    () => {},
  );
  session.start();
  await new Promise((done) => setTimeout(done, 0));
  const earlierRead = session.load("earlier");
  await session.load("tail");
  resolveEarlier({ bash, streams: [chunk("earlier")] });
  await earlierRead;
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(requests.length, 3);
  assert.equal(requests[2].offsets, undefined);
  assert.equal(session.following, true);
  assert.deepEqual(session.streams, latest.streams);
  session.stop();
});

test("failed history reads show an error without polling completed or unknown runs", async () => {
  for (const initial of [bash, undefined]) {
    let count = 0;
    let failure: string | undefined;
    const session = new AsyncBashLogSession(
      "conv",
      "bash1",
      async () => {
        count++;
        throw new Error("Missing logs");
      },
      (_, error) => {
        failure = error;
      },
      5,
      initial,
    );
    session.start();
    await new Promise((done) => setTimeout(done, 15));
    assert.equal(failure, "Missing logs");
    assert.equal(count, 1);
    session.stop();
  }
});

test("hidden/closed session ignores stale success and never schedules another request", async () => {
  let resolve!: (result: LogResult) => void;
  let count = 0;
  let published = 0;
  const session = new AsyncBashLogSession(
    "conv",
    "bash1",
    () => {
      count++;
      return new Promise((done) => {
        resolve = done;
      });
    },
    () => published++,
    5,
  );
  session.start();
  session.stop();
  resolve({ bash: { ...bash, status: "running" }, streams: [chunk("late")] });
  await new Promise((done) => setTimeout(done, 15));
  assert.equal(count, 1);
  assert.equal(published, 0);
});

test("stale errors cannot overwrite a restarted session; running sessions poll only while active", async () => {
  let reject!: (error: Error) => void;
  let count = 0;
  const failures: (string | undefined)[] = [];
  const session = new AsyncBashLogSession(
    "conv",
    "bash1",
    () => {
      count++;
      if (count === 1)
        return new Promise((_, fail) => {
          reject = fail;
        });
      return Promise.resolve({
        bash: { ...bash, status: "running" },
        streams: [chunk("ok")],
      });
    },
    (_, error) => failures.push(error),
    5,
  );
  session.start();
  session.stop();
  session.start();
  reject(new Error("stale"));
  await new Promise((done) => setTimeout(done, 20));
  assert.ok(count >= 2);
  assert.ok(failures.every((error) => error === undefined));
  session.stop();
  const stoppedCount = count;
  await new Promise((done) => setTimeout(done, 15));
  assert.equal(count, stoppedCount);
});

test("earlier output inside the window budget keeps following live output", async () => {
  const requests: LogParams[] = [];
  const tail = chunk("tail\n", PAGE_BYTES, PAGE_BYTES + 5);
  const session = new AsyncBashLogSession(
    "conv",
    "bash1",
    async (params) => {
      requests.push(params);
      const offset = params.offsets?.combined;
      const stream =
        offset === undefined
          ? tail
          : offset === 0
            ? chunk("x".repeat(PAGE_BYTES), 0, tail.totalBytes)
            : chunk("", offset, tail.totalBytes);
      return { bash: { ...bash, status: "running" }, streams: [stream] };
    },
    () => {},
    5,
  );
  session.start();
  await new Promise((done) => setTimeout(done, 0));
  await session.load("earlier");
  assert.equal(session.following, true);
  assert.equal(session.streams[0].offset, 0);
  assert.equal(session.streams[0].nextOffset, tail.nextOffset);
  await new Promise((done) => setTimeout(done, 15));
  assert.ok(requests.length > 2);
  session.stop();
});

test("catches up immediately while the capture is ahead of the window", async () => {
  const total = PAGE_BYTES * 3;
  const requests: LogParams[] = [];
  const session = new AsyncBashLogSession(
    "conv",
    "bash1",
    async (params) => {
      requests.push(params);
      const offset = params.offsets?.combined ?? 0;
      const end = Math.min(total, offset + PAGE_BYTES);
      return {
        bash,
        streams: [chunk("x".repeat(end - offset), offset, total)],
      };
    },
    () => {},
    60_000,
  );
  session.start();
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(session.streams[0].nextOffset, total);
  assert.equal(requests.length, 3);
  session.stop();
});

test("projects byte windows into stable, terminal-like lines", () => {
  const first = asyncBashLogLines([
    chunk("tail of a\nb\r\nprogress 1\rprogress 2\npart", 10),
  ]);
  assert.deepEqual(
    first.map((line) => [line.key, line.text]),
    [
      ["combined:20", "b"],
      ["combined:23", "progress 2"],
      ["combined:45", "part"],
    ],
  );
  const appended = asyncBashLogLines([
    chunk("b\r\nprogress 1\rprogress 2\npartial line\n", 20),
  ]);
  assert.deepEqual(
    appended.map((line) => line.key),
    ["combined:23", "combined:45"],
  );
  assert.equal(appended.at(-1)?.text, "partial line");
  const [error] = asyncBashLogLines([{ ...chunk("boom\n"), stream: "stderr" }]);
  assert.equal(error.tone, "error");
});
