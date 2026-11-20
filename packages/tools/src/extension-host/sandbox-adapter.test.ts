import assert from "node:assert/strict";
import { test } from "node:test";
import { sandbox } from "@nervekit/native";
import {
  ExtensionError,
  type ExtensionContext,
  type ExtensionDefinition,
} from "@nervekit/extension-api";
import { createFakeContext } from "@nervekit/extension-api/testing";
import { ToolExecutionError } from "../execution/index.js";
import type { CodeCall, CodeTarget, ExtensionCode } from "./code-adapter.js";
import { sandboxExtensionCode } from "./sandbox-adapter.js";

const available = sandbox.isPersistentAvailable();

/** The extension's code as the sandbox receives it: a classic script over the runtime's API. */
const BUNDLE = String.raw`
const { ExtensionError, defineExtension, defineNamespace, method } = globalThis.__nerveExtensionApi;
let sessionsOpened = 0;
globalThis.__nerveExtension = defineExtension({
  id: "probe",
  name: "Probe",
  description: "",
  settings: { version: 1, fields: { greeting: { type: "string", label: "Greeting", default: "hi" } } },
  namespaces: [defineNamespace({
    id: "probe",
    summary: "",
    types: "",
    session: () => ({ id: ++sessionsOpened }),
    configuration: (ctx) => "greeting " + ctx.settings.get("greeting"),
    methods: {
      echo: method({
        risk: "external_read",
        signature: "echo(text: string)",
        parse: (args) => {
          if (typeof args[0] !== "string")
            throw new ExtensionError("BAD_REQUEST", "echo needs a string.", { fix: "Pass a string." });
          return { text: args[0] };
        },
        authorize: ({ text }) => [{ targets: ["probe:text/" + text], summary: "echo " + text }],
        resource: ({ text }) => "the text " + text,
        run: async (session, { text }, ctx) => ({
          greeting: ctx.settings.get("greeting"),
          text,
          session: session.id,
          unset: ctx.settings.get("missing") === undefined,
        }),
      }),
      bytes: method({
        risk: "external_read",
        signature: "bytes(data: Uint8Array)",
        parse: (args) => ({ data: args[0] }),
        run: async (_session, { data }, ctx) => {
          const written = await ctx.artifacts.write("out.bin", data, "application/octet-stream");
          const back = await ctx.artifacts.read(written.handle);
          return { isBytes: back.bytes instanceof Uint8Array, bytes: back.bytes.map((b) => 255 - b), written };
        },
      }),
      fail: method({
        risk: "external_read",
        signature: "fail()",
        parse: () => ({}),
        run: async (_session, _input, ctx) => {
          try {
            await ctx.http.request({ url: "https://example.test/" });
          } catch (error) {
            if (!(error instanceof ExtensionError) || error.code !== "FORBIDDEN") throw error;
            throw new ExtensionError("NOT_FOUND", "wrapped: " + error.message, { fix: error.fix });
          }
        },
      }),
      boom: method({
        risk: "external_read",
        signature: "boom()",
        parse: () => ({}),
        run: async () => { throw new TypeError("plain failure"); },
      }),
      notify: method({
        risk: "external_read",
        signature: "notify()",
        parse: () => ({}),
        run: async (_session, _input, ctx) => {
          ctx.progress("answer", "a");
          ctx.progress("answer", "b");
          ctx.report.note("noted");
          ctx.log.warn("careful", { n: 1 });
          return "done";
        },
      }),
      check: method({
        risk: "external_read",
        signature: "check()",
        parse: () => ({}),
        run: async (_session, _input, ctx) => {
          await ctx.authorize({ operation: "probe.check", targets: [], risk: "external_read" });
          return "ok";
        },
      }),
      store: method({
        risk: "external_read",
        signature: "store()",
        parse: () => ({}),
        run: async (_session, _input, ctx) => {
          const first = await ctx.extensionStore.set("doc", { n: 1 }, { ifRevision: 0 });
          let conflict;
          try {
            await ctx.extensionStore.set("doc", { n: 2 }, { ifRevision: 0 });
          } catch (error) {
            conflict = error instanceof ExtensionError ? error.code : "other";
          }
          let invalid;
          try {
            await ctx.extensionStore.set("doc", 1, { ifRevision: -1 });
          } catch (error) {
            invalid = error instanceof ExtensionError ? error.code : "other";
          }
          return {
            first,
            conflict,
            invalid,
            got: await ctx.extensionStore.get("doc"),
            missing: await ctx.extensionStore.get("nope"),
            keys: await ctx.extensionStore.keys({ prefix: "d" }),
          };
        },
      }),
      slow: method({
        risk: "external_read",
        signature: "slow(label: string)",
        parse: (args) => ({ label: args[0] }),
        run: async (_session, { label }, ctx) => {
          const seen = [];
          for (let step = 0; step < 3; step++) seen.push(await ctx.artifacts.freshName(label, "." + step));
          return seen;
        },
      }),
    },
  })],
});
`;

const definition = {
  id: "probe",
  name: "Probe",
  description: "",
  settings: {
    version: 1,
    fields: { greeting: { type: "string", label: "Greeting", default: "hi" } },
  },
  namespaces: [],
} as unknown as ExtensionDefinition;

const method = (path: string): CodeTarget => ({
  kind: "method",
  namespace: "probe",
  path,
});
const call = (path: string): CodeCall => ({
  name: `probe.${path}`,
  risk: "external_read",
});

function open(options: Parameters<typeof createFakeContext>[0] = {}) {
  const fake = createFakeContext({
    settings: { greeting: "hello" },
    ...options,
  });
  const contexts: { call?: CodeCall }[] = [];
  const code = sandboxExtensionCode({
    bundle: () => BUNDLE,
    limits: { hostCallsPerInvocation: 50 },
  }).open(definition, {
    context: (bound): ExtensionContext => {
      contexts.push({ call: bound });
      return fake.ctx;
    },
  }) as ExtensionCode;
  return { code, fake, contexts };
}

void test(
  "parse, authorize, resource and run round-trip with the settings snapshot and a session kept per runtime",
  { skip: !available },
  async () => {
    const { code } = open();
    try {
      const input = await code.parse(method("echo"), ["x"]);
      assert.deepEqual(input, { text: "x" });
      assert.deepEqual(await code.authorize(method("echo"), input), [
        { targets: ["probe:text/x"], summary: "echo x" },
      ]);
      assert.equal(await code.resource(method("echo"), input), "the text x");
      assert.deepEqual(await code.run(method("echo"), input, call("echo")), {
        greeting: "hello",
        text: "x",
        session: 1,
        unset: true,
      });
      assert.equal(
        (
          (await code.run(method("echo"), input, call("echo"))) as {
            session: number;
          }
        ).session,
        1,
      );
      assert.equal(await code.configuration("probe"), "greeting hello");
    } finally {
      await code.dispose();
    }
  },
);

void test(
  "bytes cross both ways as binary and ArtifactRef stays plain data",
  { skip: !available },
  async () => {
    const { code, fake } = open();
    try {
      const data = Uint8Array.from([0, 1, 2, 250, 255]);
      const parsed = await code.parse(method("bytes"), [data]);
      const result = (await code.run(
        method("bytes"),
        parsed,
        call("bytes"),
      )) as {
        isBytes: boolean;
        bytes: Uint8Array;
        written: { handle: string; name: string };
      };
      assert.deepEqual(
        [...fake.record.artifacts.get("artifact:out.bin")!.bytes],
        [0, 1, 2, 250, 255],
      );
      assert.equal(result.isBytes, true);
      assert.deepEqual([...result.bytes], [255, 254, 253, 5, 0]);
      assert.equal(result.written.handle, "artifact:out.bin");
    } finally {
      await code.dispose();
    }
  },
);

void test(
  "ExtensionError with a fix round-trips in both directions as the same host error",
  { skip: !available },
  async () => {
    const { code } = open({
      http: async () => {
        throw new ExtensionError("FORBIDDEN", "denied by server", {
          fix: "Ask the user.",
        });
      },
    });
    try {
      await assert.rejects(
        code.parse(method("echo"), [1]),
        (error: unknown) =>
          error instanceof ExtensionError &&
          error.code === "BAD_REQUEST" &&
          error.message === "echo needs a string." &&
          error.fix === "Pass a string.",
      );
      await assert.rejects(
        code.run(method("fail"), {}, call("fail")),
        (error: unknown) =>
          error instanceof ExtensionError &&
          error.code === "NOT_FOUND" &&
          error.message === "wrapped: denied by server" &&
          error.fix === "Ask the user.",
      );
      await assert.rejects(
        code.run(method("boom"), {}, call("boom")),
        (error: unknown) =>
          error instanceof Error &&
          !(error instanceof ExtensionError) &&
          error.message === "plain failure",
      );
    } finally {
      await code.dispose();
    }
  },
);

void test(
  "ctx.extensionStore calls reach the host with checked arguments and keep their error codes",
  { skip: !available },
  async () => {
    const { code } = open();
    try {
      assert.deepEqual(await code.run(method("store"), {}, call("store")), {
        first: { revision: 1 },
        conflict: "CONFLICT",
        invalid: "BAD_REQUEST",
        got: { value: { n: 1 }, revision: 1 },
        keys: [{ key: "doc", revision: 1, size: 7 }],
      });
    } finally {
      await code.dispose();
    }
  },
);

void test(
  "host failures that are not ExtensionErrors keep their code",
  { skip: !available },
  async () => {
    const { code } = open({
      authorize: () => {
        throw new ToolExecutionError("SOME_CODE", "refused");
      },
    });
    try {
      await assert.rejects(
        code.run(method("check"), {}, call("check")),
        (error: unknown) =>
          error instanceof ToolExecutionError && error.code === "SOME_CODE",
      );
    } finally {
      await code.dispose();
    }
  },
);

void test(
  "progress, report and log are delivered before the call completes",
  { skip: !available },
  async () => {
    const { code, fake } = open();
    try {
      assert.equal(
        await code.run(method("notify"), {}, call("notify")),
        "done",
      );
      assert.deepEqual(fake.record.progress, [
        { section: "answer", chunk: "a" },
        { section: "answer", chunk: "b" },
      ]);
      assert.deepEqual(fake.record.notes, ["noted"]);
      assert.deepEqual(fake.record.logs, [
        { level: "warn", message: "careful", data: { n: 1 } },
      ]);
    } finally {
      await code.dispose();
    }
  },
);

void test(
  "concurrent invocations keep their own host calls",
  { skip: !available },
  async () => {
    const { code, fake } = open();
    const freshName = fake.ctx.artifacts.freshName;
    let delay = 0;
    fake.ctx.artifacts.freshName = async (base, extension) => {
      await new Promise((resolve) => setTimeout(resolve, (delay += 7) % 20));
      return await freshName(base, extension);
    };
    try {
      const labels = ["a", "b", "c", "d", "e"];
      const results = await Promise.all(
        labels.map((label) =>
          code.run(method("slow"), { label }, call("slow")),
        ),
      );
      results.forEach((result, index) =>
        assert.deepEqual(result, [
          `${labels[index]}-1.0`,
          `${labels[index]}-1.1`,
          `${labels[index]}-1.2`,
        ]),
      );
    } finally {
      await code.dispose();
    }
  },
);

void test(
  "the call's context is bound to its declared risk; dispose ends the runtime and is idempotent",
  { skip: !available },
  async () => {
    const { code, contexts } = open();
    await code.run(method("check"), {}, call("check"));
    assert.deepEqual(contexts.at(-1)?.call, call("check"));
    await code.dispose();
    await code.dispose();
    await assert.rejects(code.parse(method("echo"), ["x"]), /run has ended/);
  },
);

void test(
  "aborting the run cancels invocations in flight",
  { skip: !available },
  async () => {
    const controller = new AbortController();
    const { code, fake } = open({ signal: controller.signal });
    fake.ctx.artifacts.freshName = () => new Promise(() => {});
    try {
      const pending = code.run(method("slow"), { label: "x" }, call("slow"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      controller.abort(new Error("stop"));
      await assert.rejects(pending, /stop/);
    } finally {
      await code.dispose();
    }
  },
);

void test(
  "pure hooks run without a host context and the idle runtime is released",
  { skip: !available },
  async () => {
    const code = await sandboxExtensionCode({ bundle: () => BUNDLE }).open(
      definition,
      {
        context: () => {
          throw new Error("Extensions are not available in this context.");
        },
      },
    );
    const input = await code.parse(method("echo"), ["x"]);
    assert.deepEqual(input, { text: "x" });
    assert.equal((await code.authorize(method("echo"), input)).length, 1);
    // No dispose: the runtime must not keep the process alive once idle.
  },
);
