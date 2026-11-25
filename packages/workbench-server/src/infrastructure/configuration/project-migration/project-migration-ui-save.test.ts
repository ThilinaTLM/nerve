import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import type { TrustedResource } from "@nervekit/contracts/core";
import {
  TrustedResourceService,
  type CoreStorage,
} from "@nervekit/conversation-core";
import { projectPermissionsConfiguration } from "../../../core-host/permissions/project-permission-migrations.js";
import { projectConfigurationTrustKinds } from "./descriptors.js";
import { projectExtensionsConfiguration } from "../extensions/project-extensions.js";
import {
  ProjectMigrationService,
  type ProjectConfigurationType,
} from "./project-migration.js";
import { projectMigrationTrust } from "./project-migration-trust.js";

const digestOf = (bytes: Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Saves from the UI go through `ProjectMigrationService.transact`; these are its trust rules. */
const subjects = [
  {
    name: "project extension settings (extensions.json)",
    type: projectExtensionsConfiguration as ProjectConfigurationType<unknown>,
    edit: (value: unknown) => {
      const document = value as { revision: number };
      return { ...document, revision: document.revision + 1 };
    },
  },
  {
    name: "project permissions (permissions.json)",
    type: projectPermissionsConfiguration as ProjectConfigurationType<unknown>,
    edit: (value: unknown) => {
      const document = value as { overlays: unknown[] };
      return {
        ...document,
        overlays: [
          ...document.overlays,
          { ruleSetId: "supervised", rules: [] },
        ],
      };
    },
  },
];

async function fixture(
  t: TestContext,
  subject: (typeof subjects)[number],
  state: "trusted" | "rejected" | "none",
) {
  const root = await mkdtemp(join(tmpdir(), "ui-save-trust-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = { projectId: "proj_test", directory: join(root, "project") };
  const file = join(context.directory, ".nerve", subject.type.path);
  const kind = projectConfigurationTrustKinds[subject.type.id];
  const rows = new Map<string, TrustedResource>();
  const storage = {
    transaction: (fn: () => void) => fn(),
    trustedResources: {
      find: (_kind: string, _projectId: string, key: string) =>
        rows.get(key) ?? null,
      insert: (row: TrustedResource) => {
        rows.set(row.resourceKey, row);
        return row;
      },
      update: (id: string, patch: Partial<TrustedResource>) => {
        for (const [key, row] of rows)
          if (row.id === id) rows.set(key, { ...row, ...patch });
        return [...rows.values()].find((row) => row.id === id)!;
      },
      delete: () => undefined,
    },
  } as unknown as CoreStorage;
  const trust = new TrustedResourceService(storage, () =>
    new Date().toISOString(),
  );
  const service = new ProjectMigrationService({
    home: join(root, "home"),
    trust: projectMigrationTrust(() => storage, projectConfigurationTrustKinds),
  });
  service.register(subject.type);
  // A file the user already has.
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(subject.type.fallback(), null, 2)}\n`,
  );
  const original = await readFile(file);
  if (state !== "none")
    trust.decide({
      kind,
      projectId: context.projectId,
      resourceKey: file,
      name: null,
      contentDigest: digestOf(original),
      status: state,
    });
  const trustState = async () =>
    trust.state(kind, context.projectId, file, digestOf(await readFile(file)));
  const save = (during?: () => Promise<void>) =>
    service.transact(context, subject.type, async (value) => {
      await during?.();
      return { result: undefined, changed: true, value: subject.edit(value) };
    });
  return { file, original, trustState, save };
}

for (const subject of subjects) {
  void test(`a save from the UI keeps a trusted file trusted at the bytes it wrote: ${subject.name}`, async (t) => {
    const f = await fixture(t, subject, "trusted");
    assert.equal(await f.trustState(), "trusted");
    await f.save();
    assert.notDeepEqual(await readFile(f.file), f.original);
    assert.equal(await f.trustState(), "trusted");
  });

  void test(`a save does not bless bytes changed outside Nerve before it read them: ${subject.name}`, async (t) => {
    const f = await fixture(t, subject, "trusted");
    // A hand edit that still parses, made after the approval.
    await writeFile(f.file, `${f.original.toString().trimEnd()}\n\n`);
    assert.equal(await f.trustState(), "needs_review");
    await f.save();
    assert.equal(await f.trustState(), "needs_review");
  });

  void test(`a change outside Nerve while the save runs is never approved: ${subject.name}`, async (t) => {
    const f = await fixture(t, subject, "trusted");
    await assert.rejects(
      f.save(() => writeFile(f.file, `${f.original.toString()}\n`)),
      /changed during editing/,
    );
    assert.equal(await f.trustState(), "needs_review");
  });

  void test(`a declined file stays declined after a save from the UI, whatever its bytes: ${subject.name}`, async (t) => {
    const f = await fixture(t, subject, "rejected");
    assert.equal(await f.trustState(), "declined");
    await f.save();
    assert.equal(await f.trustState(), "declined");
  });

  void test(`a file that needs review stays so after a save from the UI: ${subject.name}`, async (t) => {
    const f = await fixture(t, subject, "none");
    assert.equal(await f.trustState(), "needs_review");
    await f.save();
    assert.equal(await f.trustState(), "needs_review");
  });
}
