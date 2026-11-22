import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defineExtension,
  defineNamespace,
  defineTool,
  ExtensionError,
  method,
} from "../src/index.js";
import { createFakeContext } from "../src/testing.js";

void test("a method's input flows from parse into authorize and run", async () => {
  const echo = defineNamespace<{ prefix: string }>({
    id: "echo",
    summary: "echo",
    types: "",
    session: () => ({ prefix: ">" }),
    methods: {
      say: method({
        risk: "none",
        signature: "say(text: string): Promise<string>",
        parse: (args) => String(args[0]),
        authorize: (text) => ({
          targets: [`echo:text/${text}`],
          summary: text,
        }),
        run: (session, text) => `${session.prefix} ${text}`,
      }),
    },
  });
  const { ctx } = createFakeContext();
  const session = await echo.session!(ctx);
  const say = echo.methods.say!;
  assert.equal(await say.run(session, say.parse(["hi"]), ctx), "> hi");
});

void test("the fake context records reports, artifacts and requests", async () => {
  const { ctx, record } = createFakeContext({
    settings: { server: "https://x.test" },
    http: async () => ({
      status: 200,
      ok: true,
      headers: {},
      url: "u",
      body: {},
    }),
  });
  assert.equal(ctx.settings.get<string>("server"), "https://x.test");
  ctx.report.created("ISSUE-1");
  const artifact = await ctx.artifacts.write("a.txt", "x", "text/plain");
  assert.equal((await ctx.artifacts.read(artifact.handle)).bytes.byteLength, 1);
  await ctx.http.request({ url: "https://x.test" });
  // `body` follows the response mode at compile time.
  const text = (
    await ctx.http.request({ url: "https://x.test", response: "text" })
  ).body satisfies string;
  const bytes = (await ctx.http.request({ url: "u", response: "bytes" }))
    .body satisfies Uint8Array;
  void [text, bytes];
  assert.deepEqual(record.created, ["ISSUE-1"]);
  assert.equal(record.requests.length, 3);
  assert.equal(ctx.models.image, undefined);
});

void test("definitions are returned unchanged and errors carry their fix", () => {
  const tool = defineTool({
    name: "t",
    method: "echo.say",
    description: "d",
    parameters: { type: "object" },
  });
  assert.equal(tool.method, "echo.say");
  const error = new ExtensionError("NOT_FOUND", "gone", {
    fix: "Ask the user.",
  });
  assert.equal(error.fix, "Ask the user.");
  assert.equal(
    defineExtension({
      id: "x",
      name: "X",
      description: "",
      icon: "box",
      enabledByDefault: false,
      settings: { version: 1, fields: {} },
      namespaces: [],
    }).id,
    "x",
  );
});

void test("the fake extensionStore keeps revisions and rejects stale writes", async () => {
  const { ctx, record } = createFakeContext({ store: { seed: { a: 1 } } });
  const store = ctx.extensionStore;
  assert.deepEqual(await store.get("seed"), { value: { a: 1 }, revision: 1 });
  assert.equal(await store.get("missing"), undefined);
  assert.deepEqual(await store.set("new", [1], { ifRevision: 0 }), {
    revision: 1,
  });
  await assert.rejects(
    store.set("new", [2], { ifRevision: 0 }),
    (error: ExtensionError) => error.code === "CONFLICT",
  );
  assert.deepEqual(await store.set("new", [2], { ifRevision: 1 }), {
    revision: 2,
  });
  assert.deepEqual(await store.keys({ prefix: "n" }), [
    { key: "new", revision: 2, size: 3 },
  ]);
  await assert.rejects(
    store.delete("new", { ifRevision: 1 }),
    (error: ExtensionError) => error.code === "CONFLICT",
  );
  await store.delete("new", { ifRevision: 2 });
  await store.delete("new");
  await assert.rejects(
    store.get(".bad"),
    (error: ExtensionError) => error.code === "BAD_REQUEST",
  );
  assert.deepEqual([...record.store.keys()], ["seed"]);
});
