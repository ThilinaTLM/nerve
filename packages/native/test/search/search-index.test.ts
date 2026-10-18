import assert from "node:assert/strict";
import test from "node:test";
import { createSearchIndex, type SearchDocument } from "../../src/index.js";

const document = (
  id: string,
  text: string,
  kind = "opaque",
  key: "name" | "title" | "description" | "path" = "name",
): SearchDocument => ({ id, kind, fields: [{ key, text }] });

test("complete multi-field query coverage excludes strong partial-only matches", async () => {
  const index = await createSearchIndex();
  try {
    assert.deepEqual(
      await index.update({
        upsert: [
          {
            id: "pr:271",
            kind: "opaque-pr",
            fields: [
              { key: "identifier", text: "271" },
              { key: "title", text: "fix memory leak" },
            ],
          },
          {
            id: "pr:partial",
            kind: "opaque-pr",
            fields: [{ key: "identifier", text: "271" }],
          },
          document("skill:partial", "fix", "opaque-skill"),
        ],
        remove: [],
      }),
      { revision: 1 },
    );
    const result = await index.query({ text: "271 fix" });
    assert.equal(result.revision, 1);
    assert.deepEqual(
      result.items.map((i) => i.id),
      ["pr:271"],
    );
    assert.deepEqual(
      result.items[0]!.matches.map((m) => [m.fieldIndex, m.ranges]),
      [
        [0, [[0, 3]]],
        [1, [[0, 3]]],
      ],
    );
    assert.equal(
      result.items[0]!.matches.reduce((sum, m) => sum + m.score, 0),
      result.items[0]!.lexicalScore,
    );
    assert.equal(
      (await index.query({ text: "271 fix", kinds: ["opaque-skill"] })).items
        .length,
      0,
    );
  } finally {
    await index.close();
  }
});

test("updates snapshot input, replace full documents and serialize revision-coherent queries", async () => {
  const index = await createSearchIndex();
  try {
    const input = {
      upsert: Array.from({ length: 2050 }, (_, i) =>
        document(`id:${i}`, "old"),
      ),
      remove: [] as string[],
    };
    const update = index.update(input);
    input.upsert[0]!.fields[0]!.text = "mutated after call";
    const queuedQuery = index.query({ text: "old" });
    assert.deepEqual(await update, { revision: 1 });
    assert.equal((await queuedQuery).revision, 1);
    assert.equal((await index.query({ text: "mutated" })).items.length, 0);
    await assert.rejects(
      index.update({
        upsert: [document("id:0", "new"), document("id:0", "duplicate")],
        remove: [],
      }),
      /Duplicate/,
    );
    assert.equal((await index.query({ text: "old" })).revision, 1);
    assert.deepEqual(
      await index.update({
        upsert: [document("id:0", "new", "other", "title")],
        remove: ["id:0", "missing", "missing"],
      }),
      { revision: 2 },
    );
    assert.deepEqual(
      (await index.query({ text: "new" })).items.map((i) => i.id),
      ["id:0"],
    );
    assert.equal(
      (await index.query({ text: "old", kinds: ["other"] })).items.length,
      0,
    );
    assert.deepEqual(await index.update({ upsert: [], remove: ["id:0"] }), {
      revision: 3,
    });
    assert.deepEqual(await index.update({ upsert: [], remove: ["id:0"] }), {
      revision: 3,
    });
    assert.equal((await index.query({ text: "new" })).items.length, 0);
  } finally {
    await index.close();
  }
});

test("default 64 / maximum 256, calibrated weights, deterministic opaque IDs and kinds", async () => {
  const index = await createSearchIndex();
  try {
    await index.update({
      upsert: [
        ...Array.from({ length: 300 }, (_, i) =>
          document(`name:${String(299 - i).padStart(3, "0")}`, "same"),
        ),
        document("title:1", "same", "title", "title"),
        document("description:1", "same", "description", "description"),
      ],
      remove: [],
    });
    const first = await index.query({ text: "same" });
    assert.equal(first.items.length, 64);
    assert.equal(first.items[0]!.id, "name:000");
    assert.equal(first.items[63]!.id, "name:063");
    assert.equal(
      (await index.query({ text: "same", limit: 256 })).items.length,
      256,
    );
    assert.deepEqual(
      (await index.query({ text: "same", kinds: [] })).items,
      [],
    );
    const title = (await index.query({ text: "same", kinds: ["title"] }))
      .items[0]!;
    const description = (
      await index.query({ text: "same", kinds: ["description"] })
    ).items[0]!;
    assert.ok(
      first.items[0]!.lexicalScore > title.lexicalScore &&
        title.lexicalScore > description.lexicalScore,
    );
    for (const limit of [-1, 257, 0.5, NaN])
      await assert.rejects(index.query({ text: "", limit }), /limit/);
    assert.deepEqual(await index.query({ text: "", limit: 0 }), {
      revision: 1,
      items: [],
    });
  } finally {
    await index.close();
  }
});

test("field-local UTF16, lone surrogates, opaque UTF16 IDs and JS case expansions", async () => {
  const index = await createSearchIndex();
  try {
    await index.update({
      upsert: [
        document("id:\ud800", "😀FooBar", "opaque", "title"),
        document("id:\ud801", "\ud800", "lone"),
        document("unicode:İ", "İx", "unicode"),
        document("unicode:ΟΣ", "ΟΣ", "greek"),
      ],
      remove: [],
    });
    assert.deepEqual(
      (await index.query({ text: "😀b" })).items[0]!.matches[0]!.ranges,
      [
        [0, 2],
        [5, 6],
      ],
    );
    assert.equal(
      (await index.query({ text: "😀b" })).items[0]!.id,
      "id:\ud800",
    );
    assert.deepEqual(
      (await index.query({ text: "\ud800" })).items[0]!.matches[0]!.ranges,
      [[0, 1]],
    );
    assert.deepEqual(
      (await index.query({ text: "x", kinds: ["unicode"] })).items[0]!
        .matches[0]!.ranges,
      [[1, 2]],
    );
    assert.deepEqual(
      (await index.query({ text: "İx", kinds: ["unicode"] })).items[0]!
        .matches[0]!.ranges,
      [[0, 2]],
    );
    assert.deepEqual(
      (await index.query({ text: "i", kinds: ["unicode"] })).items[0]!
        .matches[0]!.ranges,
      [[0, 1]],
    );
    assert.equal(
      (await index.query({ text: "ος", kinds: ["greek"] })).items[0]!.id,
      "unicode:ΟΣ",
    );
    await index.update({ upsert: [], remove: ["id:\ud800"] });
    assert.deepEqual((await index.query({ text: "😀b" })).items, []);
  } finally {
    await index.close();
  }
});

test("close cancels active staging, rejects waiting work and is idempotent", async () => {
  const index = await createSearchIndex();
  const updating = assert.rejects(
    index.update({
      upsert: Array.from({ length: 10000 }, (_, i) =>
        document(`id:${i}`, "cancel me"),
      ),
      remove: [],
    }),
    /closed|abort/i,
  );
  const queued = Array.from({ length: 32 }, () =>
    assert.rejects(index.query({ text: "cancel" }), /closed/),
  );
  await assert.rejects(index.query({ text: "overflow" }), /queue is full/);
  await index.close();
  await updating;
  await Promise.all(queued);
  await index.close();
  await assert.rejects(index.query({ text: "" }), /closed/);
  await assert.rejects(index.update({ upsert: [], remove: [] }), /closed/);
});

test("invalid field/query data never advances the published revision", async () => {
  const index = await createSearchIndex();
  try {
    await index.update({
      upsert: [document("id:one", "original")],
      remove: [],
    });
    await assert.rejects(
      index.update({
        upsert: [document("id:large", "x".repeat(65537))],
        remove: [],
      }),
      /65536/,
    );
    await assert.rejects(
      index.update({ upsert: [document("", "bad")], remove: [] }),
      /Invalid/,
    );
    await assert.rejects(index.query({ text: "x".repeat(4097) }), /4096/);
    await assert.rejects(
      index.query({ text: Array(33).fill("term").join(" ") }),
      /32 terms/,
    );
    assert.equal((await index.query({ text: "original" })).revision, 1);
  } finally {
    await index.close();
  }
});

test("queued updates share a source budget and release reservations on close", async () => {
  const index = await createSearchIndex();
  const text = "x".repeat(65536);
  const input = {
    upsert: Array.from({ length: 40 }, (_, i) => document(`id:${i}`, text)),
    remove: [],
  };
  const pending = Array.from({ length: 32 }, () =>
    index.update(input).then(
      () => undefined,
      (error: unknown) => error,
    ),
  );
  await index.close();
  const errors = await Promise.all(pending);
  assert.ok(
    errors.some(
      (error) =>
        error instanceof RangeError &&
        /queued update source/.test(error.message),
    ),
  );
  assert.ok(
    errors.every(
      (error) =>
        error instanceof Error &&
        /closed|abort|queued update source/i.test(error.message),
    ),
  );
});

test("factory AbortSignal owns index lifetime after creation, not just preabort", async () => {
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(createSearchIndex({ signal: aborted.signal }), /abort/i);
  const controller = new AbortController();
  const index = await createSearchIndex({ signal: controller.signal });
  await index.update({
    upsert: Array.from({ length: 2050 }, (_, i) =>
      document(`id:${i}`, "lifetime"),
    ),
    remove: [],
  });
  const active = assert.rejects(index.query({ text: "lifetime" }), /closed/);
  const queued = assert.rejects(
    index.update({ upsert: [document("later", "later")], remove: [] }),
    /closed/,
  );
  controller.abort();
  await active;
  await queued;
  await index.close();
  await assert.rejects(index.query({ text: "" }), /closed/);
});

test("bounded ID-filtered retrieval recovers matching seeds outside the main pool without adding nonmatches", async () => {
  const index = await createSearchIndex();
  try {
    await index.update({
      upsert: [
        ...Array.from({ length: 300 }, (_, i) =>
          document(`a:${String(i).padStart(3, "0")}`, "same"),
        ),
        document("z:wanted", "same", "seed"),
        document("z:nonmatch", "unrelated", "seed"),
        document("id:\ud800", "same", "seed"),
      ],
      remove: [],
    });
    const main = await index.query({ text: "same" });
    assert.equal(main.items.length, 64);
    assert.ok(!main.items.some((item) => item.id === "z:wanted"));
    const documentIds = [
      "z:wanted",
      "missing",
      "z:wanted",
      "z:nonmatch",
      "id:\ud800",
    ];
    const pending = index.query({ text: "same", documentIds });
    documentIds.fill("mutated");
    const filtered = await pending;
    assert.equal(filtered.revision, main.revision);
    assert.deepEqual(
      filtered.items.map((item) => item.id),
      ["id:\ud800", "z:wanted"],
    );
    assert.deepEqual(
      (
        await index.query({
          text: "same",
          documentIds: ["z:wanted"],
          kinds: ["other"],
        })
      ).items,
      [],
    );
    assert.deepEqual(
      (await index.query({ text: "", documentIds: [] })).items,
      [],
    );
    assert.deepEqual(
      (await index.query({ text: "", documentIds: ["missing"] })).items,
      [],
    );
    const ids = Array.from(
      { length: 256 },
      (_, i) => `a:${String(i).padStart(3, "0")}`,
    );
    assert.equal(
      (await index.query({ text: "same", documentIds: ids, limit: 256 })).items
        .length,
      256,
    );
    assert.equal(
      (await index.query({ text: "same", documentIds: ids, limit: 1 })).items
        .length,
      1,
    );
    await index.update({
      upsert: [document("z:wanted", "new", "changed")],
      remove: ["id:\ud800"],
    });
    const next = await index.query({
      text: "new",
      kinds: ["changed"],
      documentIds: ["z:wanted", "id:\ud800"],
    });
    assert.equal(next.revision, 2);
    assert.deepEqual(
      next.items.map((item) => item.id),
      ["z:wanted"],
    );
  } finally {
    await index.close();
  }
});
