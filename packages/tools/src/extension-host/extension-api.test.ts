import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { AccountInfo } from "@nervekit/extension-api";
import { quickScriptDescription } from "../quick-script/runtime/description.js";
import { executeQuickScript } from "../quick-script/runtime/quick-script.js";
import type { QuickScriptContext } from "../quick-script/runtime/sdk-types.js";
import type { QuickScriptNestedRequest } from "../execution/index.js";
import { createQuickScriptRegistry } from "../quick-script/registry.js";
import { deriveAvailability } from "./availability.js";
import { inProcessExtensionCode } from "./code-adapter.js";
import { createExtensionToolDefinitions } from "./direct-tools.js";
import { demoExtension, demoSessions } from "./test-extension.js";

const registry = createQuickScriptRegistry([demoExtension]);

let server: Server;
let baseUrl = "";
const seen: {
  method: string;
  url: string;
  authorization?: string;
  body: string;
}[] = [];
let rejectToken = false;

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

before(async () => {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- the handler reads the body first
  server = createServer(async (request, response) => {
    const body = await readBody(request);
    seen.push({
      method: request.method ?? "",
      url: request.url ?? "",
      authorization: request.headers.authorization,
      body,
    });
    if (rejectToken) return void response.writeHead(401).end("no");
    const url = request.url ?? "";
    if (request.method === "POST" && url === "/items") {
      response.writeHead(201, { "content-type": "application/json" });
      return void response.end(
        JSON.stringify({ id: "7", ...JSON.parse(body) }),
      );
    }
    if (url === "/items/404") return void response.writeHead(404).end();
    if (url.endsWith("/export")) {
      response.writeHead(200, { "content-type": "text/plain" });
      return void response.end("exported");
    }
    if (url.startsWith("/items/")) {
      response.writeHead(200, { "content-type": "application/json" });
      return void response.end(
        JSON.stringify({ id: url.slice(7), name: "Widget" }),
      );
    }
    response.writeHead(204).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => void server.close());

const account = (): AccountInfo => ({
  id: "acc1",
  name: "Acme",
  kind: "demo",
  fields: { baseUrl },
  level: "user",
});

async function setup(settings: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), "extension-api-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const conversationDir = join(root, "conversation");
  const authorized: QuickScriptNestedRequest[] = [];
  const context: QuickScriptContext = {
    cwd,
    conversationDir,
    registry,
    authorizeNested: async (request) => void authorized.push(request),
    extensionPorts: {
      settings: () => ({
        account: "acc1",
        items: true,
        prefix: "item",
        maintenance: false,
        ...settings,
      }),
      accounts: {
        get: async (kind, id) =>
          kind === "demo" && id === "acc1" ? account() : undefined,
        state: async () => "ready",
        apply: async () => ({
          ok: true,
          headers: { authorization: "Bearer secret-1" },
          query: {},
        }),
      },
    },
  };
  return { context, authorized, cwd, conversationDir };
}

void test("a script calls an extension method: settings, injected bearer auth, one session per run", async () => {
  seen.length = 0;
  demoSessions.created = 0;
  const { context, authorized } = await setup();
  const result = await executeQuickScript(
    {
      code: `const a = await demo.items.get("A1"); const b = await demo.items.get("A2"); return [a.id, b.name, typeof demo.items.get];`,
    },
    context,
  );
  assert.equal(result.exitCode, 0, result.content);
  assert.match(result.content ?? "", /A1/);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].authorization, "Bearer secret-1");
  assert.equal(
    demoSessions.created,
    1,
    "one session for the run, created on first use",
  );
  assert.deepEqual(
    authorized.map((request) =>
      "operation" in request ? request.operation : request.toolName,
    ),
    ["demo.items.get", "demo.items.get"],
  );
  assert.deepEqual((authorized[0] as { targets: string[] }).targets, [
    "demo:item/A1",
  ]);
});

void test("report entries, notes and a session shared by the run's calls", async () => {
  demoSessions.created = 0;
  const { context } = await setup({ prefix: "x" });
  const result = await executeQuickScript(
    {
      code: `await demo.items.create("a"); const item = await demo.items.create("b"); return item.name;`,
    },
    context,
  );
  assert.equal(result.exitCode, 0, result.content);
  assert.match(result.content ?? "", /x-b/);
  assert.match(result.content ?? "", /Created: item 7, item 7/);
  assert.equal(demoSessions.created, 1);
  // Identical notes of one run are shown once with their count.
  assert.match(result.content ?? "", /\nsession 1 \(×2\)$/);
});

void test("a response can stream into an artifact", async () => {
  const { context, conversationDir } = await setup();
  const result = await executeQuickScript(
    { code: `return await demo.items.export("9");` },
    context,
  );
  assert.equal(result.exitCode, 0, result.content);
  assert.match(result.content ?? "", /artifact:item-9\.txt/);
  assert.match(result.content ?? "", /Artifacts: artifact:item-9\.txt/);
  assert.equal(
    await readFile(join(conversationDir, "quick-script", "item-9.txt"), "utf8"),
    "exported",
  );
});

void test("the host maps 401 to an error naming the account and the fix, and ends the run", async () => {
  rejectToken = true;
  try {
    const { context } = await setup();
    const result = await executeQuickScript(
      { code: `await demo.items.get("1"); console.log("not reached");` },
      context,
    );
    assert.equal(result.exitCode, 1);
    assert.match(
      result.content ?? "",
      /rejected the credential of the Demo account "Acme"/,
    );
    assert.match(result.content ?? "", /Settings → Extensions → Demo/);
    assert.doesNotMatch(result.content ?? "", /not reached/);
  } finally {
    rejectToken = false;
  }
});

void test("extension errors keep their code for the script", async () => {
  const { context } = await setup();
  const result = await executeQuickScript(
    {
      code: `try { await demo.items.get("404"); } catch (e) { return e.code + ": " + e.message; }`,
    },
    context,
  );
  assert.match(result.content ?? "", /NOT_FOUND: item 404 not found/);
});

void test("ctx.http reaches only manifest origins and sends the credential only to the kind's origins", async () => {
  seen.length = 0;
  const { context } = await setup();
  const result = await executeQuickScript(
    {
      code: `try { await demo.probe("https://example.com/"); } catch (e) { return e.code + ": " + e.message; }`,
    },
    context,
  );
  assert.match(
    result.content ?? "",
    /DENIED: Demo may not reach https:\/\/example\.com/,
  );
  assert.equal(seen.length, 0);
});

void test("reads of workspace files are authorized as reads and opened to ctx.artifacts.read only then", async () => {
  const { context, authorized, cwd } = await setup();
  await writeFile(join(cwd, "a.txt"), "12345");
  const allowed = await executeQuickScript(
    { code: `return await demo.files.size("a.txt");` },
    context,
  );
  assert.equal(allowed.exitCode, 0, allowed.content);
  assert.match(allowed.content ?? "", /5/);
  assert.ok(
    authorized.some(
      (request) =>
        "toolName" in request &&
        request.toolName === "read" &&
        String(request.args.path).endsWith("a.txt"),
    ),
  );
  const sneaked = await executeQuickScript(
    {
      code: `try { await demo.files.sneak("a.txt"); } catch (e) { return e.code + ": " + e.message; }`,
    },
    context,
  );
  assert.match(sneaked.content ?? "", /DENIED: .*not authorized/);
});

void test("the description lists the namespace when its switch is on; unavailability never appears in it", () => {
  const on = quickScriptDescription({ namespaces: ["demo"] }, registry);
  assert.match(on, /demo \(demo items\)/);
  assert.doesNotMatch(on, /maintenance|unavailable/);
  assert.doesNotMatch(quickScriptDescription({}, registry), /demo \(/);
});

void test("availability is derived from switches, the selected account, its secret and the hook", async () => {
  const accounts = (secret: boolean, exists = true) => ({
    get: async () => (exists ? account() : undefined),
    state: async () =>
      secret ? ("ready" as const) : ("needs_sign_in" as const),
  });
  const derive = (
    state: { enabled: boolean; settings: Record<string, unknown> },
    options: {
      secret?: boolean;
      exists?: boolean;
      checkSecrets?: boolean;
    } = {},
  ) =>
    deriveAvailability(registry, {
      extension: () => state,
      accounts: accounts(options.secret ?? true, options.exists ?? true),
      checkSecrets: options.checkSecrets ?? true,
      code: async () =>
        ({
          availability: async () =>
            await (
              await inProcessExtensionCode.open(demoExtension, {
                context: () =>
                  ({
                    settings: { get: (key: string) => state.settings[key] },
                    accounts: {},
                    log: {},
                    models: {},
                  }) as never,
                signal: new AbortController().signal,
              })
            ).availability({ kind: "namespace", id: "demo" }),
          dispose: async () => undefined,
        }) as never,
    });
  const base = { account: "acc1", items: true, maintenance: false };

  assert.deepEqual(
    (await derive({ enabled: true, settings: base })).namespaces.demo,
    {
      configured: true,
      available: true,
    },
  );
  assert.deepEqual(
    (await derive({ enabled: false, settings: base })).namespaces.demo,
    {
      configured: false,
      available: false,
      reason: "the Demo extension is switched off.",
      fix: "Ask the user to enable it in Settings → Extensions → Demo.",
    },
  );
  const switchedOff = (
    await derive({ enabled: true, settings: { ...base, items: false } })
  ).namespaces.demo;
  assert.equal(switchedOff.configured, false);
  assert.match(
    (switchedOff as { reason: string }).reason,
    /Items is switched off in the Demo extension/,
  );

  const noAccount = (
    await derive({ enabled: true, settings: base }, { exists: false })
  ).namespaces.demo;
  assert.deepEqual(
    { configured: noAccount.configured, available: noAccount.available },
    { configured: true, available: false },
  );
  assert.match(
    (noAccount as { fix: string }).fix,
    /choose the Demo account to use, and to sign in to it if needed, in Settings → Extensions → Demo/,
  );

  const noSecret = (
    await derive({ enabled: true, settings: base }, { secret: false })
  ).namespaces.demo;
  assert.match((noSecret as { reason: string }).reason, /needs sign-in/);
  // The tool description only needs `configured`; it skips the secret check.
  assert.equal(
    (
      await derive(
        { enabled: true, settings: base },
        { secret: false, checkSecrets: false },
      )
    ).namespaces.demo.available,
    true,
  );

  const maintenance = (
    await derive({ enabled: true, settings: { ...base, maintenance: true } })
  ).namespaces.demo;
  assert.match((maintenance as { reason: string }).reason, /in maintenance/);
  assert.equal(
    (await derive({ enabled: true, settings: base })).tools.demo_item.available,
    true,
  );
});

void test("an unavailable namespace fails at call time with its reason and fix", async () => {
  const { context } = await setup();
  const result = await executeQuickScript(
    {
      code: `try { await demo.items.get("1"); } catch (e) { return e.code + ": " + e.message; }`,
    },
    {
      ...context,
      namespaces: {
        demo: {
          configured: true,
          available: false,
          reason: "no Demo account is selected.",
          fix: "Ask the user to choose one in Settings → Extensions → Demo.",
        },
      },
    },
  );
  assert.match(
    result.content ?? "",
    /BAD_REQUEST: demo is unavailable: no Demo account is selected\. Ask the user/,
  );
});

void test("a direct tool bound to a method runs the same parse → authorize → run and carries its view", async () => {
  seen.length = 0;
  const [definition] = createExtensionToolDefinitions(registry);
  assert.equal(definition.name, "demo_item");
  assert.equal(definition.extension?.id, "demo");
  assert.equal(definition.executionKind, "local");
  const { context, authorized } = await setup();
  const result = await (
    definition as {
      executor: (
        a: unknown,
        c: unknown,
      ) => Promise<{
        content: string;
        details: {
          extension: string;
          sections: { id: string; value: unknown }[];
        };
      }>;
    }
  ).executor({ id: "Z9" }, context);
  assert.match(result.content ?? "", /"id": "Z9"/);
  assert.equal(result.details.extension, "demo");
  assert.deepEqual(definition.extension?.view.sections, [
    { id: "item", type: "markdown" },
  ]);
  // A text section without `present` shows the agent's text.
  assert.equal(result.details.sections[0].id, "item");
  assert.match(String(result.details.sections[0].value), /"name": "Widget"/);
  assert.equal(seen[0].authorization, "Bearer secret-1");
  assert.deepEqual(authorized, [
    {
      operation: "demo.items.get",
      targets: ["demo:item/Z9"],
      risk: "external_read",
    },
  ]);
});

void test("a platform account setting selects accounts of another extension's definition that covers its origins", async () => {
  const using = {
    ...demoExtension,
    id: "csv-sync",
    name: "CSV sync",
    accounts: undefined,
    uses: [{ platform: "demo-platform", origins: ["https://api.demo.test"] }],
    settings: {
      ...demoExtension.settings,
      fields: {
        ...demoExtension.settings.fields,
        account: {
          type: "account" as const,
          platform: "demo-platform",
          label: "Account",
        },
      },
    },
  };
  const definition = (kind: string, origins: string[]) => ({
    kind,
    label: `${kind} account`,
    platform: "demo-platform",
    fields: {},
    origins,
  });
  const platformRegistry = createQuickScriptRegistry([using]);
  const lookups: string[] = [];
  const derive = (kinds: ReturnType<typeof definition>[], ready = true) =>
    deriveAvailability(platformRegistry, {
      extension: () => ({
        enabled: true,
        settings: { account: "acc1", items: true, maintenance: false },
      }),
      accounts: {
        get: async (kind) => {
          lookups.push(kind);
          return kind === "wide-def" ? account() : undefined;
        },
        state: async () => (ready ? "ready" : "needs_sign_in"),
        problem: async () => "missing scopes: repo",
      },
      platformKinds: () => kinds,
      checkSecrets: true,
    });

  // The account's definition lists the origin the extension declared: offered and ready.
  const ok = await derive([
    definition("narrow-def", ["https://other.test"]),
    definition("wide-def", ["https://api.demo.test", "https://x.test"]),
  ]);
  assert.equal(ok.namespaces.demo.available, true);
  // A definition that does not cover its origins is never even asked for the account.
  assert.ok(lookups.length > 0 && lookups.every((kind) => kind === "wide-def"));

  const none = await derive([definition("narrow-def", ["https://other.test"])]);
  assert.equal(none.namespaces.demo.available, false);

  const signIn = await derive(
    [definition("wide-def", ["https://api.demo.test"])],
    false,
  );
  assert.match(
    (signIn.namespaces.demo as { reason: string }).reason,
    /needs sign-in \(missing scopes: repo\)/,
  );
});
