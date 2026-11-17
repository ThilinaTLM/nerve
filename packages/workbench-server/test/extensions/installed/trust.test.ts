import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { InstalledExtensionManifest } from "@nervekit/contracts/extensions";
import { version } from "../../../src/app/version.js";
import { hashExtensionContent } from "../../../src/core-host/extension-catalog/content-hash.js";
import {
  buildConsent,
  grantSnapshot,
  isEmptyGrant,
  newGrants,
} from "../../../src/core-host/extension-catalog/consent-summary.js";
import { ExtensionTrust } from "../../../src/core-host/extension-catalog/extension-trust.js";
import type {
  ExtensionTrustVerdict,
  InstalledExtensionCandidate,
} from "../../../src/core-host/extension-catalog/trust-gate.js";
import { readFolder } from "../../../src/core-host/extension-catalog/read-installed.js";
import { writeExtension } from "./fixtures.js";

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
  const configDir = join(base, "config");
  const extensions = join(base, "extensions");
  await mkdir(extensions, { recursive: true });
  return { base, configDir, extensions };
}

async function candidate(
  extensions: string,
  id: string,
  source: "user" | "project" = "user",
): Promise<InstalledExtensionCandidate> {
  const read = await readFolder(id, join(extensions, id), version);
  assert.ok(read.manifest, read.diagnostics.map((d) => d.message).join("\n"));
  return { id, source, folder: read.folder, manifest: read.manifest };
}

const verdict = (value: unknown) =>
  typeof value === "string"
    ? ({ decision: value } as ExtensionTrustVerdict)
    : (value as ExtensionTrustVerdict);

const withTool = (manifest: Json) => {
  (manifest.tools as Json[]).push({
    name: "extra_tool",
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
  const { configDir, extensions } = await world();
  await writeExtension(extensions, { id: "first" });
  const trust = new ExtensionTrust({ configDir });
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
  // The record is a file: a new instance (a restart) sees it.
  assert.equal(
    await new ExtensionTrust({ configDir }).decide(
      await candidate(extensions, "first"),
    ),
    "trusted",
  );
  const stored = JSON.parse(
    await readFile(join(configDir, "extension-trust.json"), "utf8"),
  );
  const [record] = Object.values(stored.records) as Json[];
  assert.equal(record.contentHash, pending.consent!.contentHash);
  assert.ok(record.consentedAt);
  assert.deepEqual((record.grants as Json).tools, ["probe_echo", "probe_ping"]);
  // Revoking makes it pending again.
  await trust.revoke(await candidate(extensions, "first"));
  assert.equal(
    verdict(await trust.decide(await candidate(extensions, "first"))).decision,
    "pending",
  );
});

void test("project extensions need consent again after any content change", async () => {
  const { configDir, extensions } = await world();
  const folder = await writeExtension(extensions, { id: "proj" });
  const trust = new ExtensionTrust({ configDir });
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
  const { configDir, extensions } = await world();
  const folder = await writeExtension(extensions, { id: "usr" });
  const trust = new ExtensionTrust({ configDir });
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
    ["Adds agent tools: extra_tool"],
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
  const { configDir, extensions } = await world();
  await writeExtension(extensions, { id: "sw" });
  const trust = new ExtensionTrust({ configDir });
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

void test("an unreadable trust file means no consent", async () => {
  const { configDir, extensions } = await world();
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "extension-trust.json"), "{ not json");
  await writeExtension(extensions, { id: "bad-file" });
  assert.equal(
    verdict(
      await new ExtensionTrust({ configDir }).decide(
        await candidate(extensions, "bad-file"),
      ),
    ).decision,
    "pending",
  );
});

const manifestOf = async (edit?: (manifest: Json) => void) => {
  const { extensions } = await world();
  await writeExtension(
    extensions,
    { id: "summary", accountKind: "probe-account" },
    (m) => {
      m.permissions = {
        network: ["api.github.com"],
        capabilities: ["models.vision"],
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
      "Uses your Probe account (account kind probe-account)",
      "Uses a vision model",
      "Adds agent tools: probe_echo, probe_ping",
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
    m.ui = { themes: ["night.json"] };
  });
  const consent = buildConsent({ manifest, contentHash: "h" });
  const network = consent.items.find((item) => item.kind === "network")!;
  assert.equal(network.broad, true);
  assert.match(network.text, /any host.*broad/);
  assert.ok(consent.items.some((item) => /night\.json/.test(item.text)));
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
  assert.deepEqual(added.tools, ["probe_echo", "probe_ping"]);
  assert.deepEqual(added.capabilities, ["models.vision"]);
  assert.deepEqual(added.network, []);
  // A new operation of an existing namespace is new; the namespace is not.
  const more = {
    ...full,
    namespaces: { probe: [...(full.namespaces.probe ?? []), "other"] },
  };
  assert.deepEqual(newGrants(full, more).namespaces, { probe: ["other"] });
});
