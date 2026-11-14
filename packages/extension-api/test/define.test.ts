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
  assert.deepEqual(record.created, ["ISSUE-1"]);
  assert.equal(record.requests.length, 1);
  assert.equal(ctx.models.image, undefined);
});

void test("definitions are returned unchanged and errors carry their fix", () => {
  const tool = defineTool({
    name: "t",
    method: "echo.say",
    description: "d",
    parameters: { type: "object" },
    display: "text",
  });
  assert.equal(tool.method, "echo.say");
  const error = new ExtensionError("NOT_FOUND", "gone", {
    fix: "Ask the user.",
  });
  assert.equal(error.fix, "Ask the user.");
  assert.equal(
    defineExtension({
      id: "x",
      apiVersion: 1,
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
