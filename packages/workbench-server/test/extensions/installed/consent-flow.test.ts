import assert from "node:assert/strict";
import {
  readdir,
  readFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { sandbox } from "@nervekit/native";
import { allOperationDefinitions } from "@nervekit/contracts/operations";
import {
  scopedToolDefinitions,
  toolDefinitionByName,
  toolManifest,
} from "@nervekit/tools/catalog";
import { quickScriptDescription } from "@nervekit/tools/quick-script";
import {
  createSdkEnvironment,
  findSdkMethod,
} from "@nervekit/tools/quick-script/testing";
import {
  createHostExtensionCatalog,
  hostRegistry,
} from "../../../src/core-host/host-tools.js";
import { agentTextLimits } from "../../../src/core-host/extension-catalog/agent-text-limits.js";
import { extensionMethodHandlers } from "../../../src/adapters/protocol/handlers/extension-method-handlers.js";
import {
  fixtureBackend,
  writeExtension,
  createTestCatalog,
} from "./fixtures.js";

const skip = !sandbox.isPersistentAvailable();
let root = "";
let counter = 0;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "consent-flow-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function world() {
  const base = join(root, `w${counter++}`);
  const home = join(base, "home");
  const userRoot = join(home, "agent", "extensions");
  await mkdir(userRoot, { recursive: true });
  const project = async (name: string) => {
    const dir = join(base, name);
    await mkdir(join(dir, ".nerve", "extensions"), { recursive: true });
    return { dir, root: join(dir, ".nerve", "extensions") };
  };
  return { home, userRoot, project };
}

void test(
  "consent through the catalog: pending, grant, revoke; each reload publishes a change",
  { skip },
  async () => {
    const { home, userRoot } = await world();
    await writeExtension(userRoot, { id: "flow" });
    const catalog = createTestCatalog({ home });
    let changes = 0;
    catalog.subscribe(() => changes++);
    const entryOf = async () =>
      (await catalog.entries()).find((entry) => entry.id === "flow")!;
    const pending = await entryOf();
    assert.equal(pending.state, "pending_consent");
    assert.ok(pending.consent?.text.includes("Adds agent tools: probe_echo"));
    assert.ok(
      !(await catalog.registryFor()).extensions.some((e) => e.id === "flow"),
    );
    const ref = { source: "user" as const, id: "flow" };
    assert.equal(await catalog.grantConsent(ref, "stale"), "changed");
    assert.equal((await entryOf()).state, "pending_consent");
    assert.equal(
      await catalog.grantConsent(ref, pending.consent!.contentHash),
      "granted",
    );
    assert.equal((await entryOf()).state, "enabled");
    assert.ok(
      (await catalog.registryFor()).extensions.some((e) => e.id === "flow"),
    );
    assert.equal(await catalog.revokeConsent(ref), true);
    assert.equal((await entryOf()).state, "pending_consent");
    assert.equal(
      await catalog.grantConsent({ source: "user", id: "nope" }, "x"),
      "not_found",
    );
    assert.ok(changes >= 2, `reloads notify subscribers (${changes})`);
  },
);

void test(
  "tool definitions resolve per project: same id and tool name with different definitions never leak between projects",
  { skip },
  async () => {
    const { home, project } = await world();
    const a = await project("a");
    const b = await project("b");
    for (const [p, description] of [
      [a, "Tool of project A."],
      [b, "Tool of project B."],
    ] as const)
      await writeExtension(
        p.root,
        { id: "same-ext", namespace: "samens", toolPrefix: "same" },
        (manifest) => {
          (manifest.tools as { description: string }[])[1]!.description =
            description;
        },
        fixtureBackend({
          id: "same-ext",
          namespace: "samens",
          toolPrefix: "same",
        }).replace("Ping the probe.", description),
      );
    const catalog = createTestCatalog({
      home,
      trustGate: { decide: () => "trusted" },
    });
    // Composed in this order: B is the last composition.
    await catalog.registryFor(a.dir);
    await catalog.registryFor(b.dir);
    assert.equal(
      toolDefinitionByName("same_ping", a.dir)?.description,
      "Tool of project A.",
    );
    assert.equal(
      toolDefinitionByName("same_ping", b.dir)?.description,
      "Tool of project B.",
    );
    assert.equal(
      toolDefinitionByName("same_ping", `${a.dir}/`)?.description,
      "Tool of project A.",
    );
    // Without a project (or in another one) the tool does not exist, and the global catalog has none.
    assert.equal(toolDefinitionByName("same_ping"), undefined);
    assert.equal(
      toolDefinitionByName("same_ping", join(a.dir, "other")),
      undefined,
    );
    assert.ok(!toolManifest.some((tool) => tool.name === "same_ping"));
    assert.deepEqual(
      scopedToolDefinitions(a.dir)
        .map((tool) => tool.name)
        .sort(),
      ["same_echo", "same_ping"],
    );
    // A reload withdraws what a revoked or changed extension published.
    await catalog.reload();
    assert.equal(toolDefinitionByName("same_ping", a.dir), undefined);
  },
);

void test(
  "installed namespaces are attributed in the description, sdk.list and sdk.docs; built-ins are not",
  { skip },
  async () => {
    const { home, userRoot } = await world();
    await mkdir(join(userRoot, "attr", "dist", "docs"), { recursive: true });
    const topic = {
      id: "attrns/intro",
      whenToRead: "Before using attrns.",
      file: "docs/intro.md",
    };
    await writeExtension(
      userRoot,
      { id: "attr", namespace: "attrns" },
      (manifest) => {
        (manifest.namespaces as Record<string, unknown>[])[0]!.docs = [topic];
      },
      fixtureBackend({ id: "attr", namespace: "attrns" }).replace(
        'types: "",',
        `types: "", docs: [${JSON.stringify(topic)}],`,
      ),
    );
    await writeFile(
      join(userRoot, "attr", "dist", "docs", "intro.md"),
      "Intro text.",
    );
    const catalog = createTestCatalog({
      home,
      trustGate: { decide: () => "trusted" },
    });
    const registry = await catalog.registryFor();
    const description = quickScriptDescription(
      { namespaces: ["attrns", "diagram"] },
      registry,
    );
    assert.match(description, /attrns \(attr, user extension: Probe namespace/);
    assert.doesNotMatch(description, /diagram \([^)]*extension:/);
    const namespace = registry.namespaces.find((n) => n.id === "attrns")!;
    assert.equal(namespace.attribution, "attr, user extension");
    assert.equal(
      registry.namespaces.find((n) => n.id === "diagram")?.attribution,
      undefined,
    );
    // sdk.list and sdk.docs say whose text it is.
    const env = createSdkEnvironment({
      registry,
      cwd: process.cwd(),
      namespaces: { attrns: { configured: true, available: true } },
    });
    const sdk = async (method: string, ...args: unknown[]) =>
      String(
        await (
          await findSdkMethod(method, registry)!.prepare(args, env)
        ).run(env),
      );
    assert.match(
      await sdk("sdk.list"),
      /- attrns \(attr, user extension; 1 method/,
    );
    assert.match(await sdk("sdk.list"), /- diagram \(Diagrams extension;/);
    assert.match(
      await sdk("sdk.docs"),
      /attrns\/intro: Before using attrns\. \(attr, user extension\)/,
    );
    assert.match(
      await sdk("sdk.docs", "attrns/intro"),
      /^\[Source: attr, user extension\]\n\nIntro text\./,
    );
  },
);

void test(
  "static agent-facing text over its limit is rejected at load with the limit in the diagnostic",
  { skip },
  async () => {
    const { home, userRoot } = await world();
    const long = (n: number) => "x".repeat(n);
    await writeExtension(userRoot, { id: "wordy" }, (manifest) => {
      const namespace = (manifest.namespaces as Record<string, unknown>[])[0]!;
      namespace.summary = long(agentTextLimits.namespaceSummary + 1);
      namespace.rules = [long(agentTextLimits.rule + 1)];
      (
        (manifest.tools as Record<string, unknown>[])[0] as {
          description: string;
        }
      ).description = long(agentTextLimits.toolDescription + 1);
    });
    await writeExtension(userRoot, { id: "terse" });
    const catalog = createTestCatalog({
      home,
      trustGate: { decide: () => "trusted" },
    });
    const entries = await catalog.entries();
    const wordy = entries.find((e) => e.id === "wordy")!;
    assert.equal(wordy.state, "invalid");
    const text = wordy.diagnostics.map((d) => d.message).join("\n");
    assert.match(
      text,
      /summary is 201 characters; the limit for installed extensions is 200/,
    );
    assert.match(text, /rule 1/);
    assert.match(text, /Tool 'probe_echo': description/);
    assert.equal(entries.find((e) => e.id === "terse")!.state, "enabled");
  },
);

void test(
  "runtime errors of installed extensions are cut; built-in text is untouched",
  { skip },
  async () => {
    const { limitInstalledErrors } =
      await import("../../../src/core-host/extension-catalog/agent-text-limits.js");
    const long = "e".repeat(agentTextLimits.errorMessage * 2);
    const base = {
      open: () => ({
        parse: async () => {
          throw Object.assign(new Error(long), { fix: long });
        },
      }),
    };
    const adapter = limitInstalledErrors(
      base as never,
      (definition) => definition.id === "installed",
    );
    const parse = async (id: string) => {
      const code = await adapter.open({ id } as never, {} as never);
      return code
        .parse({ kind: "tool", name: "x" }, [])
        .catch((e: Error & { fix?: string }) => e);
    };
    const cut = (await parse("installed")) as Error & { fix?: string };
    assert.ok(cut.message.length <= agentTextLimits.errorMessage + 40);
    assert.match(cut.message, /\[cut at 600 characters\]$/);
    assert.ok(cut.fix!.length <= agentTextLimits.errorMessage + 40);
    assert.equal(((await parse("builtin")) as Error).message, long);
  },
);

void test("no agent-reachable surface can grant consent", async () => {
  const names = (list: readonly string[]) => list.join(" ");
  const forbidden = /consent|grantconsent|revoke|trust/i;
  const registry = hostRegistry;
  // quick_script: namespaces, operations and every direct tool.
  assert.doesNotMatch(
    names(
      registry.namespaces.flatMap((n) => [
        n.id,
        ...n.methods.map((m) => m.path),
      ]),
    ),
    forbidden,
  );
  assert.doesNotMatch(names(toolManifest.map((tool) => tool.name)), forbidden);
  assert.doesNotMatch(
    names(registry.tools.map((tool) => tool.definition.name)),
    forbidden,
  );
  // The operations that change consent are addressed to the workbench server only, as app calls.
  const consentOperations = allOperationDefinitions().filter((operation) =>
    /^extensions\.(grantConsent|revokeConsent|reload)$/.test(operation.method),
  );
  assert.equal(consentOperations.length, 3);
  for (const operation of consentOperations)
    assert.deepEqual(operation.allowedTargetRoles, ["workbench_server"]);
  // Every trust decision operation (all kinds) is addressed to the workbench server only.
  const trustOperations = allOperationDefinitions().filter((operation) =>
    operation.method.startsWith("trust."),
  );
  assert.deepEqual(
    trustOperations.map((operation) => operation.method).sort(),
    ["trust.decide", "trust.delete", "trust.list"],
  );
  for (const operation of trustOperations)
    assert.deepEqual(operation.allowedTargetRoles, ["workbench_server"]);
  // The UI bridge operations (frames asking the daemon for files and backend calls) are app calls too.
  const uiOperations = allOperationDefinitions().filter((operation) =>
    operation.method.startsWith("extensions.ui."),
  );
  assert.deepEqual(uiOperations.map((operation) => operation.method).sort(), [
    "extensions.ui.call",
    "extensions.ui.contributions",
    "extensions.ui.extensionStore.delete",
    "extensions.ui.extensionStore.get",
    "extensions.ui.extensionStore.keys",
    "extensions.ui.extensionStore.set",
    "extensions.ui.file.info",
    "extensions.ui.file.read",
    "extensions.ui.file.write",
    "extensions.ui.project.info",
    "extensions.ui.reportFrameError",
    "extensions.ui.settings.get",
    "extensions.ui.themes",
  ]);
  for (const operation of uiOperations)
    assert.deepEqual(operation.allowedTargetRoles, ["workbench_server"]);
  assert.doesNotMatch(
    names(
      registry.namespaces.flatMap((n) => [
        n.id,
        ...n.methods.map((m) => m.path),
      ]),
    ),
    /extensions\.ui/,
  );
  // And the code that tool and sandbox layers are made of never references the catalog's consent methods.
  const packages = join(import.meta.dirname, "../../../../");
  const seen: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist")
          await walk(path);
      } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        const text = await readFile(path, "utf8");
        if (
          /grantConsent|revokeConsent|ExtensionManagement|extensions\.ui\.|TrustedResource|trusted_resource|trust\.decide/.test(
            text,
          )
        )
          seen.push(path);
      }
    }
  };
  await walk(join(packages, "tools", "src"));
  await walk(join(packages, "extension-api", "src"));
  await walk(join(packages, "extensions", "src"));
  assert.deepEqual(seen, []);
});

void test(
  "the consent operations resolve project extensions from the target's project and refuse a mismatch",
  { skip },
  async () => {
    const { home, project } = await world();
    const p = await project("api");
    await writeExtension(p.root, { id: "api-ext" });
    const catalog = createTestCatalog({ home });
    const views: unknown[] = [];
    const state = {
      conversationCore: {
        projects: {
          get: (id: string) => (id === "p1" ? { directory: p.dir } : undefined),
        },
      },
      extensionCatalog: catalog,
      extensionViews: {
        view: async (target: unknown) => (views.push(target), { target }),
      },
    } as never;
    const handlers = extensionMethodHandlers as unknown as Record<
      string,
      (state: unknown, input: unknown) => Promise<{ status: string }>
    >;
    const target = { scope: "project", projectId: "p1" };
    const pending = (await catalog.entries(p.dir)).find(
      (e) => e.id === "api-ext",
    )!;
    assert.equal(pending.state, "pending_consent");
    // A project extension cannot be named from the user target, or an unknown project.
    assert.equal(
      (
        await handlers["extensions.grantConsent"]!(state, {
          target: { scope: "user" },
          source: "project",
          id: "api-ext",
          contentHash: pending.consent!.contentHash,
        })
      ).status,
      "not_found",
    );
    assert.equal(
      (
        await handlers["extensions.grantConsent"]!(state, {
          target: { scope: "project", projectId: "nope" },
          source: "project",
          id: "api-ext",
          contentHash: pending.consent!.contentHash,
        })
      ).status,
      "not_found",
    );
    const changed = await handlers["extensions.grantConsent"]!(state, {
      target,
      source: "project",
      id: "api-ext",
      contentHash: "stale",
    });
    assert.equal(changed.status, "changed");
    const granted = await handlers["extensions.grantConsent"]!(state, {
      target,
      source: "project",
      id: "api-ext",
      contentHash: pending.consent!.contentHash,
    });
    assert.equal(granted.status, "saved");
    assert.equal(
      (await catalog.entries(p.dir)).find((e) => e.id === "api-ext")!.state,
      "enabled",
    );
    assert.equal(
      (
        await handlers["extensions.revokeConsent"]!(state, {
          target,
          source: "project",
          id: "api-ext",
        })
      ).status,
      "saved",
    );
    assert.equal(
      (await handlers["extensions.reload"]!(state, { target })).status,
      "saved",
    );
    assert.ok(views.length >= 4);
  },
);

void test("without a consent store nothing installed runs", async () => {
  const { userRoot } = await world();
  await writeExtension(userRoot, { id: "unconsented" });
  const catalog = createHostExtensionCatalog({
    home: join(userRoot, "..", ".."),
  });
  assert.equal(
    (await catalog.entries()).find((e) => e.id === "unconsented")?.state,
    "pending_consent",
  );
});
