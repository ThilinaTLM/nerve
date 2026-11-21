import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import {
  type AccountKind,
  type InstalledExtensionManifest,
} from "@nervekit/contracts/extensions";
import { openCoreStorage, type CoreStorage } from "@nervekit/conversation-core";
import { extensionNameOfKind } from "../../../src/core-host/extensions/extension-catalog/account-platforms.js";
import {
  buildConsent,
  grantSnapshot,
  newGrants,
} from "../../../src/core-host/extensions/extension-catalog/consent-summary.js";
import { sealCredential } from "../../../src/domains/accounts/credential-blob.js";
import { enabledPlatformUses } from "../../../src/domains/accounts/platform-uses.js";
import type { PlatformUseSource } from "../../../src/domains/accounts/platform-uses.js";
import {
  AccountsService,
  type AccountDefinition,
} from "../../../src/domains/accounts/index.js";

const github: AccountKind = {
  kind: "github-device",
  label: "GitHub account",
  platform: "github",
  fields: { clientId: { type: "string", label: "Client ID" } },
  auth: { scheme: "bearer" },
  origins: ["https://api.github.com"],
  provider: {
    type: "oauth2",
    flows: ["device_code"],
    deviceAuthorizationUrl: "https://github.com/login/device/code",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["read:user"],
  },
};
/** A second definition of the same platform, defined by a project's own extension. */
const projectGithub: AccountKind = {
  ...github,
  kind: "work-gh-token",
  label: "Work GitHub",
};

const open: CoreStorage[] = [];
afterEach(() => {
  for (const storage of open.splice(0)) storage.close();
});

function fixture(
  definitions: () => AccountDefinition[],
  extensionOfKind?: (kind: string) => string | undefined,
  platformUses?: PlatformUseSource,
) {
  const storage = openCoreStorage(":memory:");
  open.push(storage);
  const now = new Date().toISOString();
  for (const id of ["p1", "p2"])
    storage.projects.insert({
      id,
      name: id,
      directory: `/tmp/${id}`,
      createdAt: now,
      updatedAt: now,
    } as never);
  const key = randomBytes(32);
  const service = new AccountsService({
    repository: () => storage.accounts,
    key: async () => key,
    definitions,
    projectExists: (id) => storage.projects.get(id) !== null,
    ...(extensionOfKind ? { extensionOfKind } : {}),
    ...(platformUses ? { platformUses } : {}),
  });
  /** A signed-in account whose credential was granted `scopes`. */
  const signedIn = (
    id: string,
    kind: string,
    scopes: string[],
    projectId: string | null = null,
  ) => {
    const at = new Date().toISOString();
    storage.accounts.insert({
      id,
      kind,
      projectId,
      name: id,
      fields: { clientId: "c" },
      credential: sealCredential(key, id, {
        v: 1,
        secrets: {},
        state: { accessToken: "t" },
        grantedScopes: scopes,
      }),
      status: "ready",
      expiresAt: null,
      createdAt: at,
      updatedAt: at,
    });
  };
  return { service, signedIn };
}

describe("platform scope union", () => {
  const uses = [
    { extensionId: "csv-sync", platform: "github", scopes: ["repo"] },
    { extensionId: "other", platform: "jira", scopes: ["write"] },
  ];
  /** `enabled[level]` lists the extensions enabled at user scope ("") or in a project. */
  const source = (enabled: Record<string, string[]>) =>
    enabledPlatformUses({
      uses: () => uses,
      levels: () => ["p1"],
      enabled: async (projectId) => (id) =>
        enabled[projectId ?? ""]?.includes(id) ?? false,
      ttlMs: 0,
    });

  it("makes accounts need sign-in when an enabled extension adds scopes, and names them", async () => {
    const enabled: Record<string, string[]> = { "": [] };
    const { service, signedIn } = fixture(
      () => [{ kind: github }],
      undefined,
      source(enabled),
    );
    signedIn("a", "github-device", ["read:user"]);
    assert.equal((await service.view("github-device", "a"))?.state, "ready");

    // csv-sync is enabled at user scope: the union grows with `repo`.
    enabled[""] = ["csv-sync"];
    const view = await service.view("github-device", "a");
    assert.equal(view?.state, "needs_sign_in");
    assert.match(view?.error ?? "", /more permissions: repo/);
    // Another platform's use changes nothing; switching the extension off restores the account.
    enabled[""] = ["other"];
    assert.equal((await service.view("github-device", "a"))?.state, "ready");
    enabled[""] = [];
    assert.equal((await service.view("github-device", "a"))?.state, "ready");
  });

  it("counts user-scope extensions for user accounts and the project's for project accounts", async () => {
    const { service, signedIn } = fixture(
      () => [{ kind: github }],
      undefined,
      source({ "": ["csv-sync"], p1: [] }),
    );
    signedIn("user", "github-device", ["read:user"]);
    signedIn("proj", "github-device", ["read:user"], "p1");
    assert.equal(
      (await service.view("github-device", "user"))?.state,
      "needs_sign_in",
    );
    // csv-sync is not enabled in p1, so p1's account asks for nothing more.
    assert.equal((await service.view("github-device", "proj"))?.state, "ready");
    assert.equal(
      await service.reader().state("github-device", "user"),
      "needs_sign_in",
    );
  });
});

describe("platform definitions and availability", () => {
  it("offers a project's definition of a platform only in that project", () => {
    const { service } = fixture(() => [
      { kind: github },
      { kind: projectGithub, projectId: "p1" },
    ]);
    const kinds = (projectId?: string) =>
      service.reader(projectId).platformKinds!("github").map((k) => k.kind);
    assert.deepEqual(kinds("p1"), ["github-device", "work-gh-token"]);
    assert.deepEqual(kinds("p2"), ["github-device"]);
    assert.deepEqual(kinds(), ["github-device"]);
    assert.deepEqual(service.all().platformKinds!("github").length, 2);
  });

  it("lists accounts of a removed definition as unavailable, naming the extension", async () => {
    let definitions: AccountDefinition[] = [{ kind: github }];
    const { service, signedIn } = fixture(
      () => definitions,
      (kind) => (kind === "github-device" ? "GitHub" : undefined),
    );
    signedIn("a", "github-device", ["read:user"]);
    definitions = [];
    const view = await service.view("github-device", "a");
    assert.equal(view?.state, "unavailable");
    assert.match(view?.error ?? "", /the GitHub extension that is off or gone/);
    assert.equal(
      (await service.reader().state("github-device", "a")) satisfies string,
      "unavailable",
    );
  });

  it("finds the defining extension by the id prefix of the kind, longest first", () => {
    const extensions = new Map([
      [
        "",
        {
          entries: [
            { id: "github", name: "GitHub" },
            { id: "github-enterprise", name: "GitHub Enterprise" },
          ],
        },
      ],
    ]);
    assert.equal(
      extensionNameOfKind("github-enterprise-token", extensions),
      "GitHub Enterprise",
    );
    assert.equal(extensionNameOfKind("github-device", extensions), "GitHub");
    assert.equal(extensionNameOfKind("githubber", extensions), undefined);
  });
});

describe("platform consent", () => {
  const manifest = (uses: { platform: string; scopes?: string[] }[]) =>
    ({
      id: "csv-sync",
      name: "CSV sync",
      description: "",
      icon: "blocks",
      enabledByDefault: false,
      settings: { version: 1, fields: {} },
      namespaces: [],
      uses,
      version: "1.0.0",
      sdkVersion: "1.0.0",
    }) as unknown as InstalledExtensionManifest;

  it("states per platform which scopes the extension uses", () => {
    const consent = buildConsent({
      manifest: manifest([
        { platform: "github", scopes: ["repo", "gist"] },
        { platform: "jira" },
      ]),
      contentHash: "h",
    });
    assert.deepEqual(
      consent.items.map((item) => item.text),
      [
        "Uses your github accounts with scopes gist, repo",
        "Uses your jira accounts",
      ],
    );
  });

  it("asks again only for scopes that are new", () => {
    const before = grantSnapshot(
      manifest([{ platform: "github", scopes: ["repo"] }]),
    );
    const after = manifest([{ platform: "github", scopes: ["repo", "gist"] }]);
    const consent = buildConsent({
      manifest: after,
      contentHash: "h",
      previous: before,
    });
    assert.deepEqual(
      consent.items.map((item) => item.text),
      ["Uses your github accounts with scopes gist"],
    );
    assert.deepEqual(newGrants(before, before).accounts, []);
  });
});
