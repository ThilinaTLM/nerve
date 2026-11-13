import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { extensionSettingsDefinitions } from "@nervekit/quick-script";
import { ProjectMigrationService } from "../infrastructure/configuration/project-migration/project-migration.js";
import { AgentConfigurationPaths } from "../infrastructure/configuration/agent-configuration/document-adapters.js";
import { ExtensionSettingsService } from "../infrastructure/configuration/extensions/extension-settings-service.js";
import { createExtensionViews } from "./extension-views.js";

void test("the user view lists every built-in extension with sources, availability and read-only entries", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "extension-views-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = new AgentConfigurationPaths({
    home,
    projectDirectory: () => undefined,
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
  });
  const extensions = new ExtensionSettingsService({
    paths,
    projectMigration: new ProjectMigrationService({ home }),
    definitions: extensionSettingsDefinitions,
    isProjectTrusted: () => true,
  });
  const file = paths.extensions({ scope: "user" });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      revision: 3,
      extensions: {
        atlassian: {
          version: 1,
          enabled: true,
          settings: { account: "acme", jira: true },
        },
        web: { version: 7, settings: { searchAccount: "future" } },
      },
    }),
  );
  const views = createExtensionViews({
    extensions,
    agents: {} as never,
    accounts: () => ({
      atlassianProfiles: [{ id: "acme" }],
      tavilyProfiles: [],
    }),
    hasCredential: async () => false,
  });
  const view = await views.view({ scope: "user" });
  assert.deepEqual(
    view.extensions.map((extension) => extension.metadata.id),
    ["atlassian", "web", "diagram"],
  );
  assert.equal(view.file.revision, 3);
  const atlassian = view.extensions[0];
  assert.deepEqual(atlassian.fields.account?.source, { layer: "user" });
  assert.deepEqual(atlassian.stored, {
    enabled: true,
    settings: { account: "acme", jira: true },
  });
  // The account exists but has no saved token: the namespace says how to fix it.
  assert.equal(atlassian.availability.jira?.available, false);
  assert.match(
    JSON.stringify(atlassian.availability.jira),
    /Settings → Extensions → Atlassian/,
  );
  assert.equal(atlassian.availability.confluence?.configured, false);
  const web = view.extensions[1];
  assert.equal(web.readOnly, true);
  assert.equal(web.stored, null);
  assert.deepEqual(
    view.diagnostics.map((diagnostic) => diagnostic.code),
    ["newer-version"],
  );
  assert.equal(view.extensions[2].enabled.value, true);
});
