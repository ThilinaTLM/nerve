import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";
import { sandbox } from "@nervekit/native";
import { resolveExtensions } from "@nervekit/contracts/extensions";
import { overrideTrustGate } from "../../../src/core-host/extensions/extension-catalog/trust-gate.js";
import {
  ExtensionStore,
  type ExtensionStoreChange,
} from "../../../src/core-host/extensions/extension-store/extension-store.js";
import { ExtensionUiService } from "../../../src/core-host/extensions/extension-ui/extension-ui-service.js";
import { ExtensionUiError } from "../../../src/core-host/extensions/extension-ui/extension-ui-error.js";
import { createExtensionFrameRoutes } from "../../../src/adapters/http/routes/extension-frame-routes.js";
import { writeExtension, createTestCatalog } from "./fixtures.js";
import { fakeAccountScopes } from "../../../src/domains/accounts/test-support.js";

/** Shared harness of the extension UI service tests. */

export const skip = !sandbox.isPersistentAvailable();
let root = "";
let counter = 0;

/** Creates the temporary root for `world()` before the file's tests and removes it after. */
export function useWorldRoot(): void {
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "extension-ui-"));
  });
  after(async () => {
    await rm(root, { recursive: true, force: true });
  });
}

const ui = {
  previews: [
    { id: "table", extensions: [".csv"], edit: "custom" as const },
    { id: "plain", extensions: [".csv", ".tsv"], edit: "source" as const },
  ],
  pages: ["explorer"],
  panels: ["summary"],
};

/** A home with a user extension, two projects, a project file tree with an escaping symlink, and the UI service over them. */
export async function world(
  options: {
    trusted?: boolean;
    enabled?: boolean;
    themes?: string[];
    lowContrast?: string[];
  } = {},
) {
  const base = join(root, `w${counter++}`);
  const home = join(base, "home");
  const userRoot = join(home, "agent", "extensions");
  await mkdir(userRoot, { recursive: true });
  await writeExtension(userRoot, {
    id: "ui-probe",
    ui,
    themes: options.themes ?? ["night.json"],
    ...(options.lowContrast ? { lowContrastThemes: options.lowContrast } : {}),
  });
  const projects: Record<
    string,
    { id: string; name: string; directory: string }
  > = {};
  for (const id of ["p1", "p2"]) {
    const directory = join(base, id);
    await mkdir(join(directory, ".nerve", "extensions"), { recursive: true });
    projects[id] = { id, name: `Project ${id}`, directory };
  }
  const p1 = projects.p1!.directory;
  await writeFile(join(p1, "data.csv"), "a,b\n1,2\n");
  await writeFile(join(p1, "notes.txt"), "text");
  await writeFile(join(base, "secret.csv"), "secret");
  await symlink(join(base, "secret.csv"), join(p1, "link.csv"));
  const catalog = createTestCatalog({
    home,
    trustGate: overrideTrustGate((candidate) =>
      options.trusted === false && candidate.id === "ui-probe"
        ? "pending"
        : "trusted",
    ),
  });
  let enabled = options.enabled ?? true;
  const changes: ExtensionStoreChange[] = [];
  const store = new ExtensionStore({
    root: join(base, "extension-store"),
    projectExists: (id) => id in projects,
    onChange: (change) => void changes.push(change),
  });
  const service = new ExtensionUiService({
    catalog,
    extensions: {
      resolve: async (context) =>
        resolveExtensions(
          catalog.settingsDefinitions(
            context.projectId
              ? projects[context.projectId]?.directory
              : undefined,
          ),
          [
            {
              layer: "user",
              entries: {
                "ui-probe": {
                  version: 1,
                  ...(enabled ? {} : { enabled: false }),
                },
              },
            },
          ],
        ),
    } as never,
    accounts: fakeAccountScopes(),
    store,
    errors: catalog.errors,
    project: (id) => projects[id],
  });
  await catalog.compose();
  await catalog.compose(p1);
  const assets = join(base, "assets");
  await mkdir(join(assets, "assets"), { recursive: true });
  await writeFile(join(assets, "base.css"), ":root{}");
  await writeFile(join(assets, "assets", "font.woff2"), "font");
  const app = createExtensionFrameRoutes({ extensionUi: service }, assets);
  return {
    base,
    home,
    p1,
    projects,
    catalog,
    changes,
    service,
    app,
    setEnabled: (value: boolean) => void (enabled = value),
    get: (path: string, init?: RequestInit) =>
      app.request(`http://daemon.test${path}`, init),
  };
}

export const call = (
  w: Awaited<ReturnType<typeof world>>,
  method: string,
  contribution: { kind: "preview" | "page" | "panel"; id: string },
  params: unknown = {},
  extra: { filePath?: string; projectId?: string; origin?: string } = {},
) =>
  (w.service.bridge as (m: string, i: unknown) => Promise<unknown>).call(
    w.service,
    method,
    {
      projectId: extra.projectId ?? "p1",
      extensionId: "ui-probe",
      contribution,
      ...(extra.filePath !== undefined ? { filePath: extra.filePath } : {}),
      ...(extra.origin !== undefined ? { origin: extra.origin } : {}),
      params,
    },
  );

export const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error) => {
    assert.ok(error instanceof ExtensionUiError, String(error));
    assert.equal(error.bridgeCode, code, error.message);
    return true;
  });

export const preview = { kind: "preview" as const, id: "table" };
