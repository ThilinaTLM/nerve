import assert from "node:assert/strict";
import { removeTree } from "@nervekit/test-kit";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { openCoreStorage } from "@nervekit/conversation-core";
import { sandbox } from "@nervekit/native";
import { version } from "../../../src/app/version.js";
import {
  grantSnapshot,
  newGrants,
} from "../../../src/core-host/extensions/extension-catalog/consent-summary.js";
import { ExtensionConsentRepository } from "../../../src/core-host/extensions/extension-catalog/extension-consent.js";
import { loadInstalledExtension } from "../../../src/core-host/extensions/extension-catalog/load-installed.js";
import { readFolder } from "../../../src/core-host/extensions/extension-catalog/read-installed.js";
import { overrideTrustGate } from "../../../src/core-host/extensions/extension-catalog/trust-gate.js";
import type {
  ExtensionTrustVerdict,
  InstalledExtensionCandidate,
} from "../../../src/core-host/extensions/extension-catalog/trust-gate.js";
import { AccountsService } from "../../../src/domains/accounts/accounts.service.js";
import {
  createTestCatalog,
  fixtureBackend,
  testConsent,
  writeExtension,
} from "./fixtures.js";

const skip = !sandbox.isPersistentAvailable();
let root = "";
let counter = 0;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "credential-consent-"));
});
after(async () => {
  await removeTree(root);
});

type Json = Record<string, unknown>;

const PROVIDER = (suffix = "") => `{
  signIn: async ({ secrets }) => ({ state: { t: secrets.secret ${suffix ? `+ "${suffix}"` : ""} }, identity: { login: "octo" } }),
  apply: async ({ state }) => ({ headers: { authorization: "Bearer " + state.t } }),
}`;
const bundleOf = (source: string) =>
  `globalThis.__nerveCredentialProvider = (${source});`;

/** An installed extension whose account kind is served by its own credential code. */
async function extensionWithCredentials(
  extensions: string,
  id: string,
  source: string,
  edit?: (manifest: Json) => void,
  options: { omitCredentials?: boolean } = {},
) {
  const bundle = bundleOf(source);
  const kind = `${id}-account`;
  const fixture = { id, accountKind: kind };
  const extra = `provider: "extension", signInOrigins: ["https://login.test"], origins: ["https://api.test"],`;
  const folder = await writeExtension(
    extensions,
    fixture,
    (manifest) => {
      Object.assign((manifest.accounts as Json)[kind] as Json, {
        provider: "extension",
        signInOrigins: ["https://login.test"],
        origins: ["https://api.test"],
      });
      if (!options.omitCredentials)
        manifest.credentials = {
          sha256: createHash("sha256").update(bundle).digest("hex"),
          operations: ["signIn", "apply"],
        };
      edit?.(manifest);
    },
    fixtureBackend(fixture).replace(
      'secret: { label: "Token" },',
      `secret: { label: "Token" }, ${extra}`,
    ),
  );
  if (!options.omitCredentials)
    await writeFile(join(folder, "dist", "credentials.js"), bundle);
  return folder;
}

async function candidate(
  extensions: string,
  id: string,
): Promise<InstalledExtensionCandidate> {
  const read = await readFolder(id, join(extensions, id), version);
  assert.ok(read.manifest, read.diagnostics.map((d) => d.message).join("\n"));
  return { id, source: "user", folder: read.folder, manifest: read.manifest };
}

const verdict = (value: unknown) =>
  typeof value === "string"
    ? ({ decision: value } as ExtensionTrustVerdict)
    : (value as ExtensionTrustVerdict);

async function world() {
  const extensions = join(root, `w${counter++}`, "extensions");
  await mkdir(extensions, { recursive: true });
  return { extensions, trust: new ExtensionConsentRepository(testConsent()) };
}

void test("a first consent says the extension runs its own code with the credentials, where they go, and what it shares", async () => {
  const { extensions, trust } = await world();
  await extensionWithCredentials(extensions, "usr", PROVIDER());
  const pending = verdict(
    await trust.decide(await candidate(extensions, "usr")),
  );
  const texts = pending.consent!.items.map((item) => item.text);
  assert.ok(
    texts.includes(
      "Runs its own code with your Probe account credentials, also in the background to keep you signed in; they are sent only to https://api.test",
    ),
    texts.join("\n"),
  );
  assert.ok(
    texts.some((text) =>
      text.startsWith("Connects to https://login.test to sign in"),
    ),
  );
  assert.ok(
    texts.some((text) =>
      /May share identity details of your Probe account/.test(text),
    ),
  );
  const own = pending.consent!.items.find((item) =>
    /Runs its own code/.test(item.text),
  );
  assert.equal(own?.broad, true);
  const snapshot = grantSnapshot((await candidate(extensions, "usr")).manifest);
  assert.ok(snapshot.credentials?.includes("usr-account|provider|code"));
  assert.ok(
    snapshot.credentials?.some((entry) =>
      entry.startsWith("usr-account|code|"),
    ),
  );
  assert.ok(
    snapshot.credentials?.includes("usr-account|signin|https://login.test"),
  );
});

void test("changing only the credential code asks again, and the review says only that the credential code changed", async () => {
  const { extensions, trust } = await world();
  const folder = await extensionWithCredentials(extensions, "usr", PROVIDER());
  const first = verdict(await trust.decide(await candidate(extensions, "usr")));
  await trust.grant(
    await candidate(extensions, "usr"),
    first.consent!.contentHash,
  );
  assert.equal(
    await trust.decide(await candidate(extensions, "usr")),
    "trusted",
  );

  // A code-only change to the backend asks again (any change outside Nerve does), for nothing new.
  await writeFile(join(folder, "dist", "backend.js"), "// backend only\n");
  const backend = verdict(
    await trust.decide(await candidate(extensions, "usr")),
  );
  assert.equal(backend.decision, "pending");
  assert.deepEqual(
    backend.consent?.items.map((item) => item.kind),
    ["code"],
  );
  await trust.grant(
    await candidate(extensions, "usr"),
    backend.consent!.contentHash,
  );

  // The credential code changed: nothing else did.
  await extensionWithCredentials(extensions, "usr", PROVIDER("-v2"));
  const changed = verdict(
    await trust.decide(await candidate(extensions, "usr")),
  );
  assert.equal(changed.decision, "pending");
  assert.equal(changed.consent?.update, true);
  assert.deepEqual(
    changed.consent?.items.map((item) => [item.kind, item.text]),
    [["code", "The credential code of the Probe account changed"]],
  );
  await trust.grant(
    await candidate(extensions, "usr"),
    changed.consent!.contentHash,
  );
  assert.equal(
    await trust.decide(await candidate(extensions, "usr")),
    "trusted",
  );
});

void test("an oauth2 kind lists the hosts it signs in at, its scopes and the identity it reads", async () => {
  const { extensions, trust } = await world();
  await writeExtension(extensions, { id: "oa" }, (manifest) => {
    manifest.accounts = {
      "oa-account": {
        label: "OA account",
        fields: { clientId: { type: "string", label: "Client id" } },
        provider: {
          type: "oauth2",
          authorizationUrl: "https://login.oa.test/authorize",
          tokenUrl: "https://token.oa.test/token",
          deviceAuthorizationUrl: "https://token.oa.test/device",
          revocationUrl: "https://revoke.oa.test/revoke",
          scopes: ["read", "write"],
          userinfo: {
            url: "https://api.oa.test/me",
            identity: { login: "login" },
          },
        },
        origins: ["https://api.oa.test"],
      },
    };
  });
  const pending = verdict(
    await trust.decide(await candidate(extensions, "oa")),
  );
  const texts = pending.consent!.items.map((item) => item.text);
  for (const host of [
    "https://token.oa.test",
    "https://revoke.oa.test",
    "https://api.oa.test",
  ])
    assert.ok(
      texts.some((text) => text.startsWith(`Connects to ${host} to sign in`)),
      `${host}\n${texts.join("\n")}`,
    );
  // The authorization page opens in the user's browser, not through the host.
  assert.ok(!texts.some((text) => text.includes("login.oa.test")));
  assert.ok(
    texts.some((text) =>
      /Asks for the scopes read, write on your OA account/.test(text),
    ),
  );
  assert.ok(
    texts.some((text) =>
      /Signs in to your OA account with OAuth 2\.0/.test(text),
    ),
  );
  assert.ok(texts.some((text) => /May share identity details/.test(text)));
});

void test("grants saved before credentials existed compare as having none", () => {
  const next = {
    network: [],
    models: [],
    frame: [],
    accounts: [],
    namespaces: {},
    tools: [],
    ui: [],
    credentials: ["k|provider|oauth2"],
  };
  const old = {
    network: [],
    models: [],
    frame: [],
    accounts: [],
    namespaces: {},
    tools: [],
    ui: [],
  };
  assert.deepEqual(newGrants(old, next).credentials, ["k|provider|oauth2"]);
  assert.deepEqual(
    newGrants(next, { ...next, credentials: [] }).credentials,
    [],
  );
});

void test(
  "the loader checks credentials.js against the manifest: hash and operations, and who needs it",
  { skip },
  async () => {
    const { extensions } = await world();
    const folder = await extensionWithCredentials(
      extensions,
      "usr",
      PROVIDER(),
    );
    const read = await readFolder("usr", folder, version);
    const loaded = await loadInstalledExtension(folder, read.manifest!);
    assert.ok(!("error" in loaded), "error" in loaded ? loaded.error : "");
    assert.deepEqual(loaded.credentials?.operations, ["signIn", "apply"]);
    assert.equal(
      loaded.credentials?.sha256,
      read.manifest?.credentials?.sha256,
    );

    // Edited after it was built: the hash no longer matches.
    await writeFile(
      join(folder, "dist", "credentials.js"),
      bundleOf(PROVIDER("-tampered")),
    );
    const tampered = await loadInstalledExtension(folder, read.manifest!);
    assert.match(
      "error" in tampered ? tampered.error : "",
      /does not match the hash/,
    );

    // The manifest lists operations the code does not implement.
    const lying = await extensionWithCredentials(
      extensions,
      "lie",
      PROVIDER(),
      (manifest) => {
        (manifest.credentials as Json).operations = [
          "signIn",
          "refresh",
          "apply",
        ];
      },
    );
    const lieRead = await readFolder("lie", lying, version);
    const lie = await loadInstalledExtension(lying, lieRead.manifest!);
    assert.match("error" in lie ? lie.error : "", /implements signIn, apply/);

    // A kind that names the provider without shipping the code, and code nobody uses.
    const missing = await extensionWithCredentials(
      extensions,
      "miss",
      PROVIDER(),
      undefined,
      { omitCredentials: true },
    );
    const missingRead = await readFolder("miss", missing, version);
    assert.match(
      await loadInstalledExtension(missing, missingRead.manifest!).then((r) =>
        "error" in r ? r.error : "",
      ),
      /ships no dist\/credentials\.js/,
    );
  },
);

void test(
  "end to end: the catalog loads the credential code, the vault runs it, and the backend only gets a request that works",
  { skip },
  async () => {
    const home = join(root, `home${counter++}`);
    const extensions = join(home, "agent", "extensions");
    await mkdir(extensions, { recursive: true });
    await extensionWithCredentials(extensions, "usr", PROVIDER());
    const catalog = createTestCatalog({ home, trustGate: overrideTrustGate() });
    await catalog.compose();
    const [definition] = catalog
      .accountDefinitions()
      .filter(({ kind }) => kind.kind === "usr-account");
    assert.ok(
      definition?.credentials,
      "the catalog carries the credential code",
    );
    assert.equal(definition.credentials.extensionId, "usr");

    const storage = openCoreStorage(":memory:");
    try {
      const key = randomBytes(32);
      const accounts = new AccountsService({
        repository: () => storage.accounts,
        key: async () => key,
        definitions: () => catalog.accountDefinitions(),
        projectExists: () => false,
      });
      const saved = accounts.save({
        kind: "usr-account",
        name: "Mine",
        fields: {},
      });
      await accounts.setSecrets("usr-account", saved.id, { secret: "tok-9" });
      assert.equal(
        (await accounts.view("usr-account", saved.id))?.state,
        "ready",
      );
      const outcome = await accounts.reader().apply("usr-account", saved.id, {
        method: "GET",
        url: new URL("https://api.test/x"),
      });
      assert.deepEqual(outcome, {
        ok: true,
        headers: { authorization: "Bearer tok-9" },
        query: {},
      });
    } finally {
      storage.close();
    }
  },
);
