import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { sandbox } from "@nervekit/native";
import { builtinExtensions } from "@nervekit/extensions";
import type { ExtensionCatalogEntry } from "@nervekit/contracts/extensions";
import { createHostExtensionCatalog } from "../../../src/core-host/host-tools.js";
import {
  overrideTrustGate,
  pendingConsentGate,
  type InstalledExtensionCandidate,
} from "../../../src/core-host/extension-catalog/trust-gate.js";
import { fixtureBackend, writeExtension } from "./fixtures.js";

const skip = !sandbox.isPersistentAvailable();
let root = "";
let counter = 0;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "installed-catalog-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A fresh NERVE_HOME and a project directory, with their extension roots created. */
async function world() {
  const base = join(root, `world-${counter++}`);
  const home = join(base, "home");
  const project = join(base, "project");
  const userRoot = join(home, "agent", "extensions");
  const projectRoot = join(project, ".nerve", "extensions");
  await mkdir(userRoot, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  return { base, home, project, userRoot, projectRoot };
}
const entry = (entries: ExtensionCatalogEntry[], id: string, source?: string) =>
  entries.find(
    (candidate) =>
      candidate.id === id &&
      (source === undefined || candidate.source === source),
  )!;
const text = (candidate: ExtensionCatalogEntry) =>
  candidate.diagnostics.map((diagnostic) => diagnostic.message).join("\n");

void test("by default nothing installed runs: valid extensions are pending consent and never opened", async () => {
  const { home, userRoot } = await world();
  // Not even a backend exists: a pending extension's code is never touched.
  await writeExtension(
    userRoot,
    { id: "pending-one" },
    undefined,
    "throw new Error('opened')",
  );
  const catalog = createHostExtensionCatalog({ home });
  const registry = await catalog.registryFor();
  const pending = entry(await catalog.entries(), "pending-one");
  assert.equal(pending.state, "pending_consent");
  assert.equal(pending.source, "user");
  assert.match(pending.path!, /pending-one$/);
  assert.equal(pending.name, "Probe pending-one");
  assert.ok(
    !registry.extensions.some((extension) => extension.id === "pending-one"),
  );
  assert.ok(!registry.namespaces.some((namespace) => namespace.id === "probe"));
  // The built-ins are listed too.
  assert.deepEqual(
    (await catalog.entries())
      .filter((e) => e.source === "builtin")
      .map((e) => e.id),
    builtinExtensions.map((definition) => definition.id),
  );
});

void test("the test gates answer per extension; the pending gate never trusts", async () => {
  const candidate = { id: "x" } as InstalledExtensionCandidate;
  assert.equal(await pendingConsentGate.decide(candidate), "pending");
  assert.equal(await overrideTrustGate().decide(candidate), "trusted");
  assert.equal(
    await overrideTrustGate(() => "disabled").decide(candidate),
    "disabled",
  );
});

void test(
  "trusted extensions load in the sandbox and join the registry with their source",
  { skip },
  async () => {
    const { home, userRoot, project, projectRoot } = await world();
    await writeExtension(userRoot, {
      id: "user-ext",
      namespace: "userns",
      toolPrefix: "userext",
    });
    await writeExtension(projectRoot, {
      id: "proj-ext",
      namespace: "projns",
      toolPrefix: "projext",
    });
    const catalog = createHostExtensionCatalog({
      home,
      trustGate: overrideTrustGate(),
    });

    const noProject = await catalog.registryFor();
    assert.ok(noProject.namespaces.some((n) => n.id === "userns"));
    assert.ok(!noProject.namespaces.some((n) => n.id === "projns"));

    const inProject = await catalog.registryFor(project);
    const sources = Object.fromEntries(
      inProject.extensions.map((e) => [e.id, e.source]),
    );
    assert.equal(sources["user-ext"], "user");
    assert.equal(sources["proj-ext"], "project");
    assert.equal(sources.diagram, "builtin");
    assert.ok(
      inProject.tools.some((tool) => tool.definition.name === "projext_echo"),
    );
    // Another project does not see it.
    const other = await catalog.registryFor(join(project, "..", "elsewhere"));
    assert.ok(!other.namespaces.some((n) => n.id === "projns"));
    assert.ok(other.namespaces.some((n) => n.id === "userns"));
    const entries = await catalog.entries(project);
    assert.equal(entry(entries, "user-ext").state, "enabled");
    assert.equal(entry(entries, "proj-ext").source, "project");
  },
);

void test(
  "the project root is the only project root: no ancestor walk",
  { skip },
  async () => {
    const { home, project, base } = await world();
    const parentRoot = join(base, ".nerve", "extensions");
    await mkdir(parentRoot, { recursive: true });
    await writeExtension(parentRoot, {
      id: "parent-ext",
      namespace: "parentns",
      toolPrefix: "parentext",
    });
    const catalog = createHostExtensionCatalog({
      home,
      trustGate: overrideTrustGate(),
    });
    const registry = await catalog.registryFor(project);
    assert.ok(!registry.extensions.some((e) => e.id === "parent-ext"));
  },
);

void test(
  "first id wins: a project extension shadows the user's, which stays listed",
  { skip },
  async () => {
    const { home, userRoot, project, projectRoot } = await world();
    await writeExtension(userRoot, {
      id: "same-id",
      namespace: "userver",
      toolPrefix: "userver",
    });
    await writeExtension(projectRoot, {
      id: "same-id",
      namespace: "projver",
      toolPrefix: "projver",
    });
    const catalog = createHostExtensionCatalog({
      home,
      trustGate: overrideTrustGate(),
    });
    const registry = await catalog.registryFor(project);
    assert.deepEqual(
      registry.namespaces.filter((n) => n.id.endsWith("ver")).map((n) => n.id),
      ["projver"],
    );
    const entries = await catalog.entries(project);
    const shadowed = entry(entries, "same-id", "user");
    assert.equal(shadowed.state, "shadowed");
    assert.equal(shadowed.shadowedBy, "project");
    assert.equal(entry(entries, "same-id", "project").state, "enabled");
    // Without the project the user's one is the winner.
    assert.equal(entry(await catalog.entries(), "same-id").state, "enabled");
  },
);

void test(
  "a user or project extension cannot take a built-in id",
  { skip },
  async () => {
    const { home, userRoot } = await world();
    await writeExtension(userRoot, {
      id: "atlassian",
      namespace: "fakeatlassian",
      toolPrefix: "fakeatl",
    });
    const catalog = createHostExtensionCatalog({
      home,
      trustGate: overrideTrustGate(),
    });
    const registry = await catalog.registryFor();
    const failed = entry(await catalog.entries(), "atlassian", "user");
    assert.equal(failed.state, "invalid");
    assert.match(text(failed), /belongs to a built-in extension/);
    assert.ok(!registry.namespaces.some((n) => n.id === "fakeatlassian"));
    assert.equal(
      registry.extensions.filter((e) => e.id === "atlassian").length,
      1,
    );
  },
);

void test(
  "account kinds, namespaces and tool names are unique across scopes; the later one fails",
  { skip },
  async () => {
    const { home, userRoot, project, projectRoot } = await world();
    const builtinKind = builtinExtensions.flatMap((d) =>
      Object.keys(d.accounts ?? {}),
    )[0]!;
    await writeExtension(userRoot, {
      id: "kind-owner",
      namespace: "kindowner",
      toolPrefix: "kindowner",
      accountKind: "owned-kind",
    });
    await writeExtension(userRoot, {
      id: "kind-builtin",
      namespace: "kindbuiltin",
      toolPrefix: "kindbuiltin",
      accountKind: builtinKind,
    });
    await writeExtension(projectRoot, {
      id: "kind-thief",
      namespace: "kindthief",
      toolPrefix: "kindthief",
      accountKind: "owned-kind",
    });
    await writeExtension(projectRoot, {
      id: "ns-thief",
      namespace: "kindowner",
      toolPrefix: "nsthief",
    });
    await writeExtension(projectRoot, {
      id: "reserved-ns",
      namespace: "files",
      toolPrefix: "reservedns",
    });
    await writeExtension(
      projectRoot,
      { id: "core-tool", namespace: "coretool", toolPrefix: "bash" },
      (manifest) => {
        (manifest.tools as { name: string }[])[0]!.name = "bash";
      },
      fixtureBackend({
        id: "core-tool",
        namespace: "coretool",
        toolPrefix: "bash",
      }).replace('name: "bash_echo"', 'name: "bash"'),
    );
    const catalog = createHostExtensionCatalog({
      home,
      trustGate: overrideTrustGate(),
    });
    const registry = await catalog.registryFor(project);
    const entries = await catalog.entries(project);
    assert.equal(entry(entries, "kind-owner").state, "enabled");
    assert.match(
      text(entry(entries, "kind-builtin")),
      /account kind '.*' is already defined/,
    );
    assert.match(
      text(entry(entries, "kind-thief")),
      /account kind 'owned-kind' is already defined/,
    );
    assert.match(
      text(entry(entries, "ns-thief")),
      /namespace 'kindowner' is already defined/,
    );
    assert.match(text(entry(entries, "reserved-ns")), /'files' is reserved/);
    assert.match(
      text(entry(entries, "core-tool")),
      /tool name 'bash' is already used/,
    );
    for (const id of [
      "kind-builtin",
      "kind-thief",
      "ns-thief",
      "reserved-ns",
      "core-tool",
    ])
      assert.equal(entry(entries, id).state, "invalid", id);
    assert.deepEqual(
      registry.extensions
        .filter((e) => e.source !== "builtin")
        .map((e) => e.id),
      ["kind-owner"],
    );
  },
);

void test(
  "a backend that registers something other than manifest.json is refused",
  { skip },
  async () => {
    const { home, userRoot } = await world();
    // The manifest understates the code: the code's tool description differs and it adds a risk.
    await writeExtension(
      userRoot,
      { id: "liar", namespace: "liar", toolPrefix: "liar" },
      (manifest) => {
        (
          manifest.namespaces as { methods: { echo: { risk: string } } }[]
        )[0]!.methods.echo.risk = "read";
      },
    );
    await writeExtension(
      userRoot,
      { id: "crash", namespace: "crash", toolPrefix: "crash" },
      undefined,
      "throw new Error('boom at load');",
    );
    await writeExtension(
      userRoot,
      { id: "silent", namespace: "silent", toolPrefix: "silent" },
      undefined,
      "// registers nothing",
    );
    const catalog = createHostExtensionCatalog({
      home,
      trustGate: overrideTrustGate(),
    });
    const registry = await catalog.registryFor();
    const entries = await catalog.entries();
    assert.equal(entry(entries, "liar").state, "invalid");
    assert.match(
      text(entry(entries, "liar")),
      /registers a different definition.*namespaces\[0\]\.methods\.echo\.risk: manifest\.json says "read", the code says "external_read"/,
    );
    assert.match(text(entry(entries, "crash")), /did not load.*boom at load/);
    assert.match(
      text(entry(entries, "silent")),
      /did not register its definition/,
    );
    assert.ok(
      !registry.namespaces.some((n) =>
        ["liar", "crash", "silent"].includes(n.id),
      ),
    );
  },
);

void test(
  "incompatible SDK versions are not loaded and say what to do",
  { skip },
  async () => {
    const { home, userRoot } = await world();
    await writeExtension(userRoot, {
      id: "old-sdk",
      namespace: "oldsdk",
      toolPrefix: "oldsdk",
      sdkVersion: "0.38.0",
    });
    const catalog = createHostExtensionCatalog({
      home,
      trustGate: overrideTrustGate(),
      nerveVersion: "0.41.1",
    });
    const registry = await catalog.registryFor();
    const old = entry(await catalog.entries(), "old-sdk");
    assert.equal(old.state, "incompatible");
    assert.equal(old.sdkVersion, "0.38.0");
    assert.match(
      text(old),
      /Ask the agent to upgrade it with the extension-creator skill/,
    );
    assert.ok(!registry.namespaces.some((n) => n.id === "oldsdk"));
  },
);

void test(
  "project extension themes are ignored with a diagnostic; user extension themes are not flagged",
  { skip },
  async () => {
    const { home, userRoot, project, projectRoot } = await world();
    await writeExtension(userRoot, {
      id: "user-themed",
      namespace: "userthemed",
      toolPrefix: "userthemed",
      themes: ["dark.json"],
    });
    await writeExtension(projectRoot, {
      id: "proj-themed",
      namespace: "projthemed",
      toolPrefix: "projthemed",
      themes: ["dark.json"],
    });
    const catalog = createHostExtensionCatalog({
      home,
      trustGate: overrideTrustGate(),
    });
    const entries = await catalog.entries(project);
    assert.equal(entry(entries, "proj-themed").state, "enabled");
    assert.match(
      text(entry(entries, "proj-themed")),
      /Themes of project extensions are ignored/,
    );
    assert.equal(text(entry(entries, "user-themed")), "");
  },
);

void test(
  "the trust gate decides per extension, before any code is opened; disabled stays out",
  { skip },
  async () => {
    const { home, userRoot } = await world();
    await writeExtension(userRoot, {
      id: "gate-on",
      namespace: "gateon",
      toolPrefix: "gateon",
    });
    await writeExtension(userRoot, {
      id: "gate-off",
      namespace: "gateoff",
      toolPrefix: "gateoff",
    });
    await writeExtension(
      userRoot,
      { id: "gate-wait", namespace: "gatewait", toolPrefix: "gatewait" },
      undefined,
      "throw new Error('opened')",
    );
    const asked: string[] = [];
    const catalog = createHostExtensionCatalog({
      home,
      trustGate: overrideTrustGate((candidate) => {
        asked.push(candidate.id);
        assert.equal(candidate.source, "user");
        assert.equal(candidate.manifest.id, candidate.id);
        return candidate.id === "gate-on"
          ? "trusted"
          : candidate.id === "gate-off"
            ? "disabled"
            : "pending";
      }),
    });
    const entries = await catalog.entries();
    assert.deepEqual(asked.sort(), ["gate-off", "gate-on", "gate-wait"]);
    assert.equal(entry(entries, "gate-on").state, "enabled");
    assert.equal(entry(entries, "gate-off").state, "disabled");
    assert.equal(entry(entries, "gate-wait").state, "pending_consent");
  },
);

void test(
  "reload applies to the next request; one id reloads only that folder; reload never grants consent",
  { skip },
  async () => {
    const { home, userRoot } = await world();
    await writeExtension(userRoot, {
      id: "stable",
      namespace: "stable",
      toolPrefix: "stable",
    });
    await writeExtension(userRoot, {
      id: "changing",
      namespace: "changing",
      toolPrefix: "changing",
    });
    let decisions = 0;
    let trustChanging = true;
    const catalog = createHostExtensionCatalog({
      home,
      trustGate: overrideTrustGate((candidate) => {
        decisions++;
        return candidate.id === "changing" && !trustChanging
          ? "pending"
          : "trusted";
      }),
    });
    let changes = 0;
    catalog.subscribe(() => changes++);
    const first = await catalog.registryFor();
    assert.equal(await catalog.registryFor(), first, "cached until reload");
    assert.equal(decisions, 2);

    // Edit one extension on disk: nothing changes before the reload.
    await writeExtension(
      userRoot,
      { id: "changing", namespace: "changing", toolPrefix: "changing" },
      (manifest) => {
        (manifest.tools as { description: string }[])[0]!.description =
          "Changed description.";
      },
      fixtureBackend({
        id: "changing",
        namespace: "changing",
        toolPrefix: "changing",
      }).replace(
        "Echo text through the probe namespace.",
        "Changed description.",
      ),
    );
    assert.equal(await catalog.registryFor(), first);

    await catalog.reload("changing");
    assert.equal(changes, 1);
    assert.equal(decisions, 3, "only the reloaded id asked the gate again");
    const second = await catalog.registryFor();
    assert.notEqual(second, first);
    assert.equal(
      second.tools.find((t) => t.definition.name === "changing_echo")!
        .definition.description,
      "Changed description.",
    );
    assert.ok(second.namespaces.some((n) => n.id === "stable"));

    // Withdrawn consent applies on reload.
    trustChanging = false;
    await catalog.reload();
    assert.equal(
      entry(await catalog.entries(), "changing").state,
      "pending_consent",
    );
    assert.ok(
      !(await catalog.registryFor()).namespaces.some(
        (n) => n.id === "changing",
      ),
    );
  },
);

void test(
  "settings definitions and account kinds follow the composed registries",
  { skip },
  async () => {
    const { home, userRoot, project, projectRoot } = await world();
    await writeExtension(userRoot, {
      id: "with-kind",
      namespace: "withkind",
      toolPrefix: "withkind",
      accountKind: "probe-kind",
    });
    await writeExtension(projectRoot, {
      id: "proj-settings",
      namespace: "projsettings",
      toolPrefix: "projsettings",
    });
    const catalog = createHostExtensionCatalog({
      home,
      trustGate: overrideTrustGate(),
    });
    await catalog.compose();
    await catalog.compose(project);
    assert.ok(
      catalog
        .accountKinds()
        .some((kind) => kind.kind === "probe-kind" && kind.test === true),
    );
    const ids = (projectDir?: string) =>
      catalog.settingsDefinitions(projectDir).map((d) => d.id);
    assert.ok(ids(project).includes("proj-settings"));
    assert.ok(!ids(join(project, "other")).includes("proj-settings"));
    assert.ok(ids().includes("with-kind"));
    // Make sure a text file where a folder is expected does not break discovery.
    await writeFile(join(userRoot, "README.md"), "not an extension");
    await catalog.reload();
    assert.equal(entry(await catalog.entries(), "with-kind").state, "enabled");
  },
);
