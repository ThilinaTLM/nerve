import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { InstalledExtensionManifest } from "@nervekit/contracts/extensions";
import { version } from "../../../src/app/version.js";
import { hashExtensionContent } from "../../../src/core-host/extensions/extension-catalog/content-hash.js";
import {
  buildConsent,
  grantSnapshot,
  isEmptyGrant,
  newGrants,
} from "../../../src/core-host/extensions/extension-catalog/consent-summary.js";
import { ExtensionConsentRepository } from "../../../src/core-host/extensions/extension-catalog/extension-consent.js";
import type {
  ExtensionTrustVerdict,
  InstalledExtensionCandidate,
} from "../../../src/core-host/extensions/extension-catalog/trust-gate.js";
import { readFolder } from "../../../src/core-host/extensions/extension-catalog/read-installed.js";
import { testConsent, writeExtension } from "./fixtures.js";

let root = "";
let counter = 0;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "installed-trust-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

async function world() {
  const base = join(root, `w${counter++}`);
  const extensions = join(base, "extensions");
  await mkdir(extensions, { recursive: true });
  const consent = testConsent();
  return {
    base,
    extensions,
    consent,
    trust: new ExtensionConsentRepository(consent),
  };
}

async function candidate(
  extensions: string,
  id: string,
  source: "user" | "project" = "user",
): Promise<InstalledExtensionCandidate> {
  const read = await readFolder(id, join(extensions, id), version);
  assert.ok(read.manifest, read.diagnostics.map((d) => d.message).join("\n"));
  return {
    id,
    source,
    folder: read.folder,
    ...(source === "project" ? { projectDir: join(extensions, "..") } : {}),
    manifest: read.manifest,
  };
}

const verdict = (value: unknown) =>
  typeof value === "string"
    ? ({ decision: value } as ExtensionTrustVerdict)
    : (value as ExtensionTrustVerdict);

const withTool = (manifest: Json) => {
  (manifest.tools as Json[]).push({
    name: "usr_extra",
    description: "Another tool.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    risk: "none",
    parse: true,
    run: true,
  });
};

void test("the content hash covers every file of dist/ in a stable order", async () => {
  const { extensions } = await world();
  const folder = await writeExtension(extensions, { id: "hash-me" });
  const first = await hashExtensionContent(folder);
  assert.equal(await hashExtensionContent(folder), first);
  await mkdir(join(folder, "dist", "docs"), { recursive: true });
  await writeFile(join(folder, "dist", "docs", "a.md"), "A");
  const withDoc = await hashExtensionContent(folder);
  assert.notEqual(withDoc, first);
  await writeFile(join(folder, "dist", "docs", "a.md"), "B");
  assert.notEqual(await hashExtensionContent(folder), withDoc);
  // Files outside dist/ are not what runs.
  const stable = await hashExtensionContent(folder);
  await writeFile(join(folder, "README.md"), "notes");
  assert.equal(await hashExtensionContent(folder), stable);
});

void test("nothing runs before consent; consent is bound to the reviewed files", async () => {
  const { extensions, trust, consent } = await world();
  await writeExtension(extensions, { id: "first" });
  const pending = verdict(
    await trust.decide(await candidate(extensions, "first")),
  );
  assert.equal(pending.decision, "pending");
  assert.equal(pending.consent?.update, false);
  // A stale review is refused.
  assert.equal(
    await trust.grant(await candidate(extensions, "first"), "not-the-hash"),
    false,
  );
  assert.equal(
    verdict(await trust.decide(await candidate(extensions, "first"))).decision,
    "pending",
  );
  assert.equal(
    await trust.grant(
      await candidate(extensions, "first"),
      pending.consent!.contentHash,
    ),
    true,
  );
  assert.equal(
    await trust.decide(await candidate(extensions, "first")),
    "trusted",
  );
  // The decision is a trusted_resource row: a new repository over the same database sees it.
  const candidateFirst = await candidate(extensions, "first");
  assert.equal(
    await new ExtensionConsentRepository(consent).decide(candidateFirst),
    "trusted",
  );
  const row = consent.trust().find("extension", null, candidateFirst.folder)!;
  assert.equal(row.name, "first");
  assert.equal(row.status, "trusted");
  assert.equal(row.contentDigest, `sha256:${pending.consent!.contentHash}`);
  assert.deepEqual(row.grants?.tools, ["first_echo", "first_ping"]);
  // Revoking keeps the row as rejected, and the extension is pending review again.
  await trust.revoke(await candidate(extensions, "first"));
  assert.equal(
    consent.trust().find("extension", null, candidateFirst.folder)?.status,
    "rejected",
  );
  assert.equal(
    verdict(await trust.decide(await candidate(extensions, "first"))).decision,
    "pending",
  );
  // A rejected extension with unchanged files is not silently allowed again.
  assert.equal(
    verdict(await trust.decide(await candidate(extensions, "first"))).consent
      ?.update,
    false,
  );
});

void test("project extensions need consent again after any content change", async () => {
  const { extensions, trust } = await world();
  const folder = await writeExtension(extensions, { id: "proj" });
  const first = verdict(
    await trust.decide(await candidate(extensions, "proj", "project")),
  );
  await trust.grant(
    await candidate(extensions, "proj", "project"),
    first.consent!.contentHash,
  );
  assert.equal(
    await trust.decide(await candidate(extensions, "proj", "project")),
    "trusted",
  );
  // A code-only change.
  await writeFile(join(folder, "dist", "backend.js"), "// changed\n");
  const changed = verdict(
    await trust.decide(await candidate(extensions, "proj", "project")),
  );
  assert.equal(changed.decision, "pending");
  assert.equal(changed.consent?.update, true);
  assert.deepEqual(
    changed.consent?.items.map((item) => item.kind),
    ["code"],
  );
});

void test("user extensions keep consent through code-only changes and ask again for new grants, listing only what is new", async () => {
  const { extensions, trust } = await world();
  const folder = await writeExtension(extensions, { id: "usr" });
  const first = verdict(await trust.decide(await candidate(extensions, "usr")));
  await trust.grant(
    await candidate(extensions, "usr"),
    first.consent!.contentHash,
  );

  await writeFile(join(folder, "dist", "backend.js"), "// code only\n");
  assert.equal(
    await trust.decide(await candidate(extensions, "usr")),
    "trusted",
  );

  // A new tool: pending, and the review lists only the tool.
  await writeExtension(extensions, { id: "usr" }, withTool);
  const grew = verdict(await trust.decide(await candidate(extensions, "usr")));
  assert.equal(grew.decision, "pending");
  assert.equal(grew.consent?.update, true);
  assert.deepEqual(
    grew.consent?.items.map((item) => item.text),
    ["Adds agent tools: usr_extra"],
  );
  await trust.grant(
    await candidate(extensions, "usr"),
    grew.consent!.contentHash,
  );
  assert.equal(
    await trust.decide(await candidate(extensions, "usr")),
    "trusted",
  );

  // Removing a grant needs no consent; adding it back does.
  await writeExtension(extensions, { id: "usr" });
  assert.equal(
    await trust.decide(await candidate(extensions, "usr")),
    "trusted",
  );
  await writeExtension(extensions, { id: "usr" }, withTool);
  assert.equal(
    verdict(await trust.decide(await candidate(extensions, "usr"))).decision,
    "pending",
  );
});

void test("trust is per folder: the same id elsewhere has no consent", async () => {
  const { extensions, trust } = await world();
  await writeExtension(extensions, { id: "sw" });
  const first = verdict(await trust.decide(await candidate(extensions, "sw")));
  await trust.grant(
    await candidate(extensions, "sw"),
    first.consent!.contentHash,
  );
  assert.equal(
    await trust.decide(await candidate(extensions, "sw")),
    "trusted",
  );
  const other = await world();
  await writeExtension(other.extensions, { id: "sw" });
  assert.equal(
    verdict(await trust.decide(await candidate(other.extensions, "sw")))
      .decision,
    "pending",
  );
});

void test("a user extension that was revoked stays pending through a code-only change", async () => {
  const { extensions, trust } = await world();
  const folder = await writeExtension(extensions, { id: "revoked" });
  const first = verdict(
    await trust.decide(await candidate(extensions, "revoked")),
  );
  await trust.grant(
    await candidate(extensions, "revoked"),
    first.consent!.contentHash,
  );
  await trust.revoke(await candidate(extensions, "revoked"));
  await writeFile(join(folder, "dist", "backend.js"), "// code only\n");
  assert.equal(
    verdict(await trust.decide(await candidate(extensions, "revoked")))
      .decision,
    "pending",
  );
});

void test("a project extension of an unregistered project can never be consented", async () => {
  const { extensions } = await world();
  await writeExtension(extensions, { id: "orphan" });
  const trust = new ExtensionConsentRepository({
    trust: () => testConsent().trust(),
    projectIdOf: () => undefined,
  });
  const found = await candidate(extensions, "orphan", "project");
  const pending = verdict(await trust.decide(found));
  assert.equal(pending.decision, "pending");
  assert.equal(await trust.grant(found, pending.consent!.contentHash), false);
});

const manifestOf = async (edit?: (manifest: Json) => void) => {
  const { extensions } = await world();
  await writeExtension(
    extensions,
    { id: "summary", accountKind: "summary-account" },
    (m) => {
      m.permissions = {
        network: ["api.github.com"],
        models: ["vision"],
      };
      edit?.(m);
    },
  );
  return (await candidate(extensions, "summary")).manifest;
};

void test("the consent summary is plain language from the manifest", async () => {
  const manifest = await manifestOf();
  const consent = buildConsent({ manifest, contentHash: "h" });
  assert.deepEqual(
    consent.items.map((item) => item.text),
    [
      "Connects to api.github.com",
      "Uses your Probe account (account kind summary-account)",
      "Uses a vision model",
      "Adds agent tools: summary_echo, summary_ping",
      "Adds SDK namespace probe (operations echo)",
    ],
  );
  assert.equal(consent.text.split("\n").length, 5);
  assert.ok(consent.text.startsWith("- Connects to api.github.com"));
  assert.equal(consent.update, false);
});

void test("broad network grants are called out; themes are described", async () => {
  const manifest = await manifestOf((m) => {
    m.permissions = { network: ["*"] };
    m.ui = {
      themes: [
        {
          id: "night",
          label: "Night",
          kind: "dark",
          file: "themes/night.json",
        },
      ],
    };
  });
  const consent = buildConsent({ manifest, contentHash: "h" });
  const network = consent.items.find((item) => item.kind === "network")!;
  assert.equal(network.broad, true);
  assert.match(network.text, /any host.*broad/);
  assert.ok(
    consent.items.some((item) => /color theme "Night"/.test(item.text)),
  );
});

void test("previews, pages and panels are grants described in plain language", async () => {
  const ui = {
    previews: [
      {
        id: "table",
        label: "Table",
        match: { extensions: [".csv", ".tsv"] },
        edit: "custom",
        entry: "ui/table/index.html",
      },
    ],
    pages: [
      {
        id: "explorer",
        label: "Explorer",
        icon: "chart-bar",
        entry: "ui/explorer/index.html",
      },
    ],
    panels: [
      {
        id: "summary",
        label: "Summary",
        icon: "table",
        entry: "ui/summary/index.html",
      },
    ],
  } as NonNullable<InstalledExtensionManifest["ui"]>;
  const manifest = await manifestOf((m) => {
    m.ui = ui;
  });
  const items = buildConsent({ manifest, contentHash: "h" })
    .items.filter((item) => item.kind === "ui")
    .map((item) => item.text);
  assert.deepEqual(items, [
    'Adds a page "Explorer" to the workbench',
    'Adds a side panel "Summary"',
    'Opens .csv, .tsv files as "Table"; can change the file you open it with',
  ]);
  // Widening what a preview opens or how it edits is new; unchanged contributions are not.
  const before = grantSnapshot(manifest);
  const widened = grantSnapshot({
    ...manifest,
    ui: {
      ...ui,
      previews: [
        {
          ...ui.previews![0]!,
          match: { extensions: [".csv", ".tsv", ".psv"] },
        },
      ],
    },
  });
  assert.equal(newGrants(before, widened).ui.length, 1);
  assert.ok(isEmptyGrant(newGrants(widened, before)));
});

void test("grant diffs list only what is new; shrinking is empty", async () => {
  const manifest = await manifestOf();
  const full = grantSnapshot(manifest);
  const smaller = grantSnapshot({
    ...manifest,
    permissions: { network: ["api.github.com"] },
    tools: [],
  } as InstalledExtensionManifest);
  assert.ok(isEmptyGrant(newGrants(full, smaller)));
  const added = newGrants(smaller, full);
  assert.deepEqual(added.tools, ["summary_echo", "summary_ping"]);
  assert.deepEqual(added.models, ["vision"]);
  assert.deepEqual(added.network, []);
  // A new operation of an existing namespace is new; the namespace is not.
  const more = {
    ...full,
    namespaces: { probe: [...(full.namespaces.probe ?? []), "other"] },
  };
  assert.deepEqual(newGrants(full, more).namespaces, { probe: ["other"] });
});
