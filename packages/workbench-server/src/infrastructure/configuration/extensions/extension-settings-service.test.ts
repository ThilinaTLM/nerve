import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { extensionSettingsDefinitions } from "@nervekit/extensions";
import type { ExtensionSettingsDefinition } from "@nervekit/contracts/extensions";
import { ProjectMigrationService } from "../project-migration/project-migration.js";
import { AgentConfigurationPaths } from "../agent-configuration/document-adapters.js";
import { digestBytes } from "../scoped-store/scoped-document-store.js";
import { ExtensionSettingsService } from "./extension-settings-service.js";

const userOnly: ExtensionSettingsDefinition = {
  id: "private",
  settingsVersion: 1,
  enabledByDefault: true,
  settings: {
    fields: {
      token: {
        type: "string",
        label: "Name",
        default: "none",
        scopes: ["user"],
      },
    },
  },
};

async function fixture(t: TestContext) {
  const home = await mkdtemp(join(tmpdir(), "extension-settings-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const project = join(home, "project");
  const paths = new AgentConfigurationPaths({
    home,
    projectDirectory: (id) => (id === "p" ? project : undefined),
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
  });
  let trusted = false;
  const service = new ExtensionSettingsService({
    paths,
    projectMigration: new ProjectMigrationService({ home }),
    definitions: [...extensionSettingsDefinitions, userOnly],
    isProjectTrusted: () => trusted,
  });
  const user = { scope: "user" as const };
  const projectScope = { scope: "project" as const, projectId: "p" };
  const conversation = { scope: "conversation" as const, conversationId: "c1" };
  const put = async (file: string, value: unknown) => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  };
  return {
    service,
    paths,
    user,
    projectScope,
    conversation,
    put,
    trust: (value: boolean) => (trusted = value),
    expected: async (scope: Parameters<typeof service.read>[0]) => {
      const read = await service.read(scope);
      return { revision: read.revision, digest: read.digest };
    },
  };
}
const field = (
  resolution: Awaited<ReturnType<ExtensionSettingsService["resolve"]>>,
  id: string,
  key: string,
) => resolution.extensions[id].fields[key];

void test("saves are revisioned, replace one entry and keep the others", async (t) => {
  const f = await fixture(t);
  const first = await f.service.save(f.user, await f.expected(f.user), {
    id: "web",
    entry: { enabled: true, settings: { searchAccount: "tav" } },
  });
  assert.equal(first.status, "saved");
  assert.equal(first.status === "saved" && first.value.revision, 1);
  // A stale revision conflicts.
  assert.equal(
    (
      await f.service.save(
        f.user,
        { revision: 0, digest: "missing" },
        { id: "web", entry: { enabled: false } },
      )
    ).status,
    "conflict",
  );
  await f.service.save(f.user, await f.expected(f.user), {
    id: "diagram",
    entry: { settings: { server: "https://kroki.internal" } },
  });
  const written = JSON.parse(
    await readFile(f.paths.extensions(f.user), "utf8"),
  );
  assert.equal(written.revision, 2);
  assert.deepEqual(Object.keys(written.extensions).sort(), ["diagram", "web"]);
  assert.equal(
    written.extensions.diagram.settings.server,
    "https://kroki.internal/",
  );
  // Resetting a field keeps the rest; an emptied entry disappears.
  await f.service.reset(f.user, await f.expected(f.user), "web", ["enabled"]);
  const reset = await f.service.resolve({ role: "lead" }, "user");
  assert.equal(reset.extensions.web.enabled.value, false);
  assert.equal(field(reset, "web", "searchAccount").value, "tav");
  await f.service.reset(f.user, await f.expected(f.user), "web", [
    "searchAccount",
  ]);
  assert.equal(
    JSON.parse(await readFile(f.paths.extensions(f.user), "utf8")).extensions
      .web,
    undefined,
  );
});

void test("invalid entries are refused with issues; field scopes and locks apply", async (t) => {
  const f = await fixture(t);
  const bad = await f.service.save(f.user, await f.expected(f.user), {
    id: "diagram",
    entry: { settings: { server: "ftp://nope", extra: 1 } },
  });
  assert.deepEqual(
    bad.status === "invalid" && bad.issues.map((issue) => issue.field).sort(),
    ["extra", "server"],
  );
  const scoped = await f.service.save(
    f.projectScope,
    { revision: 0, digest: "missing" },
    { id: "private", entry: { settings: { token: "x" } } },
  );
  assert.equal(scoped.status, "invalid");
  const locked = await f.service.save(
    f.conversation,
    { revision: 0, digest: "missing" },
    {
      id: "web",
      entry: { settings: { searchAccount: "mine" } },
      locked: ["searchAccount"],
    },
  );
  assert.equal(locked.status, "invalid");
});

void test("a project file is used only when trusted; its fields override the user's", async (t) => {
  const f = await fixture(t);
  await f.put(f.paths.extensions(f.user), {
    schemaVersion: 1,
    revision: 1,
    extensions: {
      atlassian: {
        version: 1,
        enabled: true,
        settings: { account: "mine", jira: true },
      },
    },
  });
  const file = f.paths.extensions(f.projectScope);
  await f.put(file, {
    schemaVersion: 1,
    revision: 1,
    extensions: {
      atlassian: { version: 1, settings: { account: "team", jira: false } },
    },
  });
  const ignored = await f.service.resolve({ projectId: "p" }, "project");
  assert.equal(field(ignored, "atlassian", "account").value, "mine");
  assert.ok(
    ignored.diagnostics.some((issue) => issue.code === "untrusted-project"),
  );
  f.trust(true);
  const used = await f.service.resolve({ projectId: "p" }, "project");
  assert.deepEqual(field(used, "atlassian", "account").source, {
    layer: "project",
  });
  assert.equal(field(used, "atlassian", "jira").value, false);
  assert.equal(used.extensions.atlassian.enabled.source.layer, "user");
  // The digest the host trusts is the exact file content.
  const read = await f.service.read(f.projectScope);
  assert.equal(read.digest, digestBytes(await readFile(file)));
  // A corrupted project file falls back to user settings with a diagnostic.
  await writeFile(file, "{broken");
  await f.service.reload(f.projectScope);
  const broken = await f.service.resolve({ projectId: "p" }, "project");
  assert.equal(field(broken, "atlassian", "account").value, "mine");
  assert.ok(
    broken.diagnostics.some((issue) => issue.code === "file-unavailable"),
  );
});

void test("profiles recommend below the conversation and require above it", async (t) => {
  const f = await fixture(t);
  await f.put(f.paths.extensions(f.conversation), {
    schemaVersion: 1,
    revision: 1,
    extensions: {
      web: { version: 1, settings: { searchAccount: "chosen" } },
      atlassian: { version: 1, settings: { account: "chosen" } },
    },
  });
  const resolution = await f.service.resolve({
    projectId: "p",
    conversationId: "c1",
    role: "lead",
    appliedProfile: {
      name: "planning",
      extensions: {
        recommendations: {
          web: { version: 1, settings: { searchAccount: "recommended" } },
          diagram: { version: 1, settings: { server: "https://kroki.rec/" } },
        },
        requirements: {
          atlassian: { version: 1, settings: { account: "required" } },
        },
      },
    },
  });
  assert.equal(field(resolution, "web", "searchAccount").value, "chosen");
  assert.equal(
    field(resolution, "diagram", "server").value,
    "https://kroki.rec/",
  );
  assert.deepEqual(field(resolution, "atlassian", "account").source, {
    layer: "profile",
    profile: "planning",
    locked: true,
  });
  assert.deepEqual(
    f.service.lockedFields(
      {
        name: "planning",
        extensions: {
          requirements: {
            atlassian: {
              version: 1,
              enabled: true,
              settings: { account: "x" },
            },
          },
        },
      },
      "atlassian",
    ),
    ["enabled", "account"],
  );
});

void test("sub-agents resolve from their frozen file alone, written once", async (t) => {
  const f = await fixture(t);
  await f.put(f.paths.extensions(f.user), {
    schemaVersion: 1,
    revision: 1,
    extensions: {
      web: { version: 1, enabled: true, settings: { searchAccount: "u" } },
    },
  });
  const parent = await f.service.resolve({ projectId: "p", role: "lead" });
  await f.service.freezeForChild("child", f.service.freezeEntries(parent));
  // The user's settings change afterwards; the child keeps its frozen values.
  await f.service.save(f.user, await f.expected(f.user), {
    id: "web",
    entry: { enabled: true, settings: { searchAccount: "changed" } },
  });
  const child = await f.service.resolve({
    projectId: "p",
    conversationId: "child",
    role: "child",
  });
  assert.equal(field(child, "web", "searchAccount").value, "u");
  assert.equal(child.extensions.web.enabled.value, true);
  await assert.rejects(
    f.service.freezeForChild("child", { web: { version: 1 } }),
  );
});

void test("newer entries are read-only and never overwritten; unknown extensions survive saves", async (t) => {
  const f = await fixture(t);
  await f.put(f.paths.extensions(f.user), {
    schemaVersion: 1,
    revision: 1,
    extensions: {
      web: { version: 9, settings: { searchAccount: "future" } },
      installed: { version: 1, settings: { anything: true } },
    },
  });
  const read = await f.service.save(f.user, await f.expected(f.user), {
    id: "web",
    entry: { settings: { searchAccount: "mine" } },
  });
  assert.equal(read.status, "read-only");
  await f.service.save(f.user, await f.expected(f.user), {
    id: "diagram",
    entry: { enabled: false },
  });
  const written = JSON.parse(
    await readFile(f.paths.extensions(f.user), "utf8"),
  );
  assert.equal(written.extensions.web.version, 9);
  assert.deepEqual(written.extensions.installed, {
    version: 1,
    settings: { anything: true },
  });
  const resolution = await f.service.resolve({ role: "lead" }, "user");
  assert.deepEqual(resolution.diagnostics.map((issue) => issue.code).sort(), [
    "newer-version",
    "unknown-extension",
  ]);
});
