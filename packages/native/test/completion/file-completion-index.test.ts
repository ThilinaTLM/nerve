import assert from "node:assert/strict";
import test from "node:test";
import {
  createFileCompletionIndex,
  type FileCompletionCandidateInput,
} from "../../src/index.js";
function candidate(
  relativePath: string,
  kind: "file" | "directory" = "file",
): FileCompletionCandidateInput {
  const segments = relativePath.split("/");
  const name = segments.at(-1)!;
  const stem =
    kind === "file" && name.includes(".")
      ? name.slice(0, name.lastIndexOf("."))
      : name;
  return { relativePath, segments, name, stem, depth: segments.length, kind };
}
test("public boundary preserves JS casing, UTF16 labels and exact scores", async () => {
  const index = await createFileCompletionIndex([
    candidate("😀/hello"),
    candidate("İx"),
    candidate("x/\ud800"),
  ]);
  try {
    assert.deepEqual(await index.query("@hello"), [
      { candidateIndex: 0, score: 18178, matchRanges: [[4, 9]] },
    ]);
    assert.deepEqual(await index.query("i"), [
      { candidateIndex: 1, score: 16053.9, matchRanges: [[1, 2]] },
    ]);
    assert.deepEqual(await index.query("\ud800"), [
      { candidateIndex: 2, score: 18178, matchRanges: [[3, 4]] },
    ]);
    assert.deepEqual(await index.query("..\\secret"), []);
    assert.deepEqual(await index.query("/absolute"), []);
  } finally {
    await index.close();
  }
});
test("locale ordering is host JS ordering, stable for comparator equivalents", async () => {
  const paths = ["é", "e\u0301", "a", "A", "ß", "z"];
  const candidates = paths.map((p) => candidate(p));
  const index = await createFileCompletionIndex(candidates);
  try {
    const expected = candidates
      .map((c, i) => ({ c, i }))
      .sort(
        (a, b) =>
          a.c.relativePath.length - b.c.relativePath.length ||
          a.c.relativePath.localeCompare(b.c.relativePath),
      )
      .map((x) => x.i);
    assert.deepEqual(
      (await index.query("")).map((m) => m.candidateIndex),
      expected,
    );
  } finally {
    await index.close();
  }
});
test("bounded limits, explicit close and no unbounded concurrent tasks", async () => {
  const index = await createFileCompletionIndex(
    Array.from({ length: 10000 }, (_, i) => candidate(`src/item-${i}.ts`)),
  );
  for (const limit of [-1, 9, 0.5, NaN, Infinity])
    await assert.rejects(index.query("", { limit }), /limit/);
  assert.deepEqual(await index.query("", { limit: 0 }), []);
  assert.equal((await index.query("")).length, 8);
  const first = index.query("src/itm");
  const waiting = Array.from({ length: 32 }, () => index.query("second"));
  await assert.rejects(index.query("overflow"), /queue is full/);
  const queuedRejections = waiting.map((p) => assert.rejects(p, /closed/));
  const rejected = assert.rejects(first, /closed/);
  await index.close();
  await rejected;
  await Promise.all(queuedRejections);
  await index.close();
  await assert.rejects(index.query(""), /closed/);
});
test("cancel build cooperatively and reject invalid inputs explicitly", async () => {
  const controller = new AbortController();
  const building = createFileCompletionIndex(
    Array.from({ length: 2000 }, (_, i) => candidate(`item-${i}`)),
    { signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(building, /abort/i);
  await assert.rejects(
    createFileCompletionIndex([{ ...candidate("x"), depth: -1 }]),
    /Invalid/,
  );
  await assert.rejects(
    createFileCompletionIndex(new Array(1_000_001)),
    /count/,
  );
});
test("ordered, unordered, fuzzy, folder intent and stem matches", async () => {
  const index = await createFileCompletionIndex([
    candidate("src/fooBar.ts"),
    candidate("fooBar/src.ts"),
    candidate("src", "directory"),
  ]);
  try {
    assert.equal((await index.query("sr/fb"))[0]?.candidateIndex, 0);
    assert.equal((await index.query("fb sr")).length, 2);
    assert.deepEqual((await index.query("fooBar"))[0], {
      candidateIndex: 0,
      score: 18178,
      matchRanges: [[5, 11]],
    });
    assert.ok(!(await index.query("src/")).some((m) => m.candidateIndex === 2));
    assert.deepEqual((await index.query("sr/fb"))[0]?.matchRanges, [
      [1, 3],
      [5, 6],
      [8, 9],
    ]);
  } finally {
    await index.close();
  }
});

test("supplementary-plane fuzzy matching and contextual casing stay in JS UTF16 coordinates", async () => {
  const index = await createFileCompletionIndex([
    candidate("a/😀FooBar.txt"),
    candidate("ΟΣ.txt"),
  ]);
  try {
    const [fuzzy] = await index.query("😀b");
    assert.equal(fuzzy?.candidateIndex, 0);
    assert.deepEqual(fuzzy?.matchRanges, [
      [3, 5],
      [8, 9],
    ]);
    assert.equal((await index.query("ος"))[0]?.candidateIndex, 1);
    assert.equal((await index.query("ΟΣ"))[0]?.candidateIndex, 1);
  } finally {
    await index.close();
  }
});

test("batched locale merge preserves stable comparator-equivalent ties", async () => {
  const index = await createFileCompletionIndex(
    Array.from({ length: 2050 }, (_, i) =>
      candidate(i % 2 ? "é/e\u0301" : "e\u0301/é"),
    ),
  );
  try {
    assert.deepEqual(
      (await index.query("")).map((m) => m.candidateIndex),
      [0, 1, 2, 3, 4, 5, 6, 7],
    );
    await assert.rejects(index.query("x".repeat(4097)), /4096/);
  } finally {
    await index.close();
  }
});

test("global build admission rejects overload and releases canceled waiting/active slots", async () => {
  const controllers = Array.from({ length: 18 }, () => new AbortController());
  const builds = controllers.map((controller) =>
    createFileCompletionIndex([candidate("src/file.ts")], {
      signal: controller.signal,
    }).then(
      async (index) => {
        await index.close();
        return undefined;
      },
      (error) => error,
    ),
  );
  await assert.rejects(createFileCompletionIndex([]), /build queue is full/);
  for (const controller of controllers) controller.abort();
  const outcomes = await Promise.all(builds);
  assert.ok(
    outcomes.every(
      (error) => error instanceof Error && error.name === "AbortError",
    ),
  );
  const index = await createFileCompletionIndex([]);
  assert.deepEqual(await index.query(""), []);
  await index.close();
});

test("FIFO queue serializes concurrent calls without dropping ordinary requests", async () => {
  const index = await createFileCompletionIndex([candidate("src/file.ts")]);
  try {
    const results = await Promise.all(
      ["src", "file", "ts", ""].map((q) => index.query(q)),
    );
    assert.ok(results.every((r) => r.length === 1));
  } finally {
    await index.close();
  }
});
