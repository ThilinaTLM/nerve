import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { sandbox } from "@nervekit/native";
import { resolveExtensions } from "@nervekit/contracts/extensions";
import { toolDefinitionByName } from "@nervekit/tools/catalog";
import {
  accountKindIsTestable,
  configuredNamespaces,
  testExtensionAccount,
} from "@nervekit/tools/extension-host";
import {
  classifyQuickScriptScript,
  executeQuickScript,
  quickScriptDescription,
} from "@nervekit/tools/quick-script";
import type { AccountsReader } from "../../../src/domains/accounts/accounts.service.js";
import { fakeAccountsReader } from "../../../src/domains/accounts/test-support.js";
import { hostRegistry } from "../../../src/core-host/host-tools.js";
import { overrideTrustGate } from "../../../src/core-host/extensions/extension-catalog/trust-gate.js";
import { extensionAvailability } from "../../../src/core-host/extensions/extension-availability.js";
import { createExtensionPorts } from "../../../src/core-host/extensions/extension-ports.js";
import { writeExtension, createTestCatalog } from "./fixtures.js";

/*
 * An installed user extension, trusted through the gate's override, used the way a conversation
 * uses it: quick_script, its direct tools, availability, the script scan and an account test.
 * All of its code runs in the sandbox.
 */

const skip = !sandbox.isPersistentAvailable();
const accounts: AccountsReader = fakeAccountsReader({
  get: async (kind, id) =>
    kind === "e2e-probe-account"
      ? {
          id,
          kind,
          name: id,
          fields: { site: id === "bad" ? "bad" : "https://probe.test" },
          level: "user",
        }
      : undefined,
});

let root = "";
before(async () => {
  root = await mkdtemp(join(tmpdir(), "installed-e2e-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function setup(settings: Record<string, unknown> = {}) {
  const home = join(root, `home-${Math.random().toString(36).slice(2)}`);
  const userRoot = join(home, "agent", "extensions");
  await mkdir(userRoot, { recursive: true });
  await writeExtension(userRoot, {
    id: "e2e-probe",
    namespace: "probee2e",
    accountKind: "e2e-probe-account",
  });
  const catalog = createTestCatalog({
    home,
    trustGate: overrideTrustGate(),
  });
  const registry = await catalog.registryFor();
  const resolution = resolveExtensions(catalog.settingsDefinitions(), [
    {
      layer: "user",
      entries: { "e2e-probe": { version: 1, settings } },
    },
  ]);
  const availability = await extensionAvailability(
    registry,
    resolution,
    accounts,
    {
      checkSecrets: true,
      ports: createExtensionPorts({ resolution, accounts }),
    },
  );
  const cwd = join(home, "work");
  await mkdir(cwd, { recursive: true });
  const authorized: unknown[] = [];
  const context = {
    cwd,
    conversationDir: join(home, "conversation"),
    registry,
    namespaces: availability.namespaces,
    signal: new AbortController().signal,
    authorizeNested: async (request: unknown) => void authorized.push(request),
    extensionPorts: createExtensionPorts({ resolution, accounts }),
  };
  return { catalog, registry, resolution, availability, context, authorized };
}

void test(
  "an installed extension appears in the description and the availability of the composed registry",
  { skip },
  async () => {
    const { registry, availability, resolution } = await setup();
    assert.deepEqual(configuredNamespaces(availability.namespaces).sort(), [
      "diagram",
      "probee2e",
    ]);
    assert.equal(availability.namespaces.probee2e.available, true);
    assert.equal(resolution.extensions["e2e-probe"].enabled.value, true);
    const description = quickScriptDescription(
      { namespaces: configuredNamespaces(availability.namespaces) },
      registry,
    );
    assert.match(description, /probee2e/);
    assert.match(description, /Probe namespace: echo\(text\)/);
  },
);

void test(
  "the namespace's availability hook runs in the sandbox",
  { skip },
  async () => {
    const { availability } = await setup({ greeting: "broken" });
    const state = availability.namespaces.probee2e;
    assert.equal(state.available, false);
    assert.deepEqual(
      {
        reason: (state as { reason: string }).reason,
        fix: (state as { fix: string }).fix,
      },
      {
        reason: "The probe is broken.",
        fix: "Ask the user to change the greeting.",
      },
    );
  },
);

void test(
  "quick_script calls the namespace: parse, authorize and run in the sandbox with settings",
  { skip },
  async () => {
    const { context, authorized } = await setup({ greeting: "hello" });
    const result = await executeQuickScript(
      {
        code: `
        console.log(JSON.stringify(await probee2e.echo("x")));
        try { await probee2e.echo(1); } catch (e) { console.log(e.code + "|" + e.message); }
      `,
      },
      context,
    );
    const [first, second] = (result.content ?? "").split("\n");
    assert.deepEqual(JSON.parse(first), { greeting: "hello", text: "x" });
    assert.match(second, /^BAD_REQUEST\|.*echo needs a string/);
    assert.deepEqual(authorized[0], {
      operation: "probee2e.echo",
      targets: ["probe:text/x"],
      risk: "external_read",
    });
  },
);

void test(
  "the permission scan classifies installed namespaces from the composed registry",
  { skip },
  async () => {
    const { registry } = await setup();
    const scan = await classifyQuickScriptScript(
      `await probee2e.echo("x");`,
      registry,
    );
    assert.equal(scan.risk, "external_read");
    assert.deepEqual(
      scan.calls.map((call) => call.operation),
      ["probee2e.echo"],
    );
  },
);

void test(
  "direct tools of an installed extension run through the catalog's definitions",
  { skip },
  async () => {
    const { context, authorized } = await setup({ greeting: "tool" });
    type Executor = (
      args: unknown,
      context: unknown,
    ) => Promise<{
      content: string;
      details: { extension: string; tool: string };
    }>;
    const run = (name: string, args: unknown) => {
      const definition = toolDefinitionByName(name, "") as unknown as {
        executor: Executor;
        extension: { id: string };
      };
      assert.equal(definition.extension.id, "e2e-probe");
      return definition.executor(args, context);
    };
    // Bound to the namespace method.
    const echo = await run("e2e_probe_echo", { text: "via tool" });
    assert.match(echo.content, /"text": "via tool"/);
    assert.equal(echo.details.tool, "e2e_probe_echo");
    assert.ok(
      authorized.some(
        (request) =>
          (request as { operation?: string }).operation === "probee2e.echo",
      ),
    );
    // Own implementation with `present`.
    const ping = await run("e2e_probe_ping", { n: 7 });
    assert.equal(ping.content, "pong 7");
    // A registry without the extension (another project) refuses the call.
    await assert.rejects(
      toolDefinitionByName("e2e_probe_ping", "")!.executor!(
        {},
        { ...context, registry: hostRegistry },
      ),
      /not available in this project/,
    );
  },
);

void test(
  "an account kind's test hook runs in the sandbox",
  { skip },
  async () => {
    const { registry } = await setup();
    assert.equal(accountKindIsTestable(registry, "e2e-probe-account"), true);
    const ports = {
      accounts: {
        get: async () => undefined,
        state: async () => "ready" as const,
        apply: async () => ({
          ok: true as const,
          headers: { authorization: "Bearer secret" },
          query: {},
        }),
      },
      log: () => undefined,
    };
    const ok = await testExtensionAccount({
      registry,
      ports,
      account: {
        id: "good",
        kind: "e2e-probe-account",
        name: "Good",
        fields: { site: "https://probe.test" },
      },
    });
    assert.deepEqual(ok, {
      status: "verified",
      message: "hello Good at https://probe.test",
    });
    const refused = await testExtensionAccount({
      registry,
      ports,
      account: {
        id: "bad",
        kind: "e2e-probe-account",
        name: "Bad",
        fields: { site: "bad" },
      },
    });
    assert.deepEqual(refused, {
      status: "restricted",
      message: "Site rejected.",
    });
  },
);
