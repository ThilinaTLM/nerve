import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import type { AccountKind } from "@nervekit/contracts/extensions";
import { openCoreStorage, type CoreStorage } from "@nervekit/conversation-core";
import {
  AccountsService,
  type AccountDefinition,
} from "../../../src/domains/accounts/index.js";

const atlassian: AccountKind = {
  kind: "atlassian",
  label: "Atlassian account",
  fields: {
    siteUrl: { type: "string", label: "Site URL", format: "url" },
    email: { type: "string", label: "Email" },
  },
  secret: { label: "API token" },
  auth: { scheme: "basic", user: "email" },
  test: true,
};
const tavily: AccountKind = {
  kind: "tavily",
  label: "Tavily account",
  fields: {},
  secret: { label: "API key" },
  auth: { scheme: "bearer" },
};
/** Defined by the repository of project p1 only. */
const repoKind: AccountKind = {
  kind: "repo-service",
  label: "Repo service",
  fields: {},
  secret: { label: "Token" },
  auth: { scheme: "bearer" },
};

const open: CoreStorage[] = [];
afterEach(() => {
  for (const storage of open.splice(0)) storage.close();
});

function fixture(
  definitions: AccountDefinition[] = [
    { kind: atlassian },
    { kind: tavily },
    { kind: repoKind, projectId: "p1" },
  ],
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
    definitions: () => definitions,
    projectExists: (id) => storage.projects.get(id) !== null,
  });
  return { service, storage, key };
}

const hop = { method: "GET", url: new URL("https://acme.atlassian.net/x") };

describe("AccountsService", () => {
  it("saves accounts, keeps their secrets in the vault and lists them with their state", async () => {
    const { service, storage } = fixture();
    const saved = service.save({
      kind: "atlassian",
      name: "Acme",
      fields: { siteUrl: "https://acme.atlassian.net/", email: "a@acme.test" },
    });
    assert.equal(saved.level, "user");
    assert.equal((await service.views())[0]?.state, "needs_sign_in");
    await service.setSecrets("atlassian", saved.id, { secret: "token" });
    const [view] = await service.views();
    assert.deepEqual(
      { state: view?.state, level: view?.level, fields: view?.fields },
      {
        state: "ready",
        level: "user",
        fields: { siteUrl: "https://acme.atlassian.net", email: "a@acme.test" },
      },
    );
    assert.equal("secret" in view!, false);
    // The credential column holds ciphertext only.
    const sealed = storage.accounts.readCredential(saved.id)!;
    assert.equal(Buffer.from(sealed).includes("token"), false);
    const applied = await service.reader().apply("atlassian", saved.id, hop);
    assert.deepEqual(applied, {
      ok: true,
      headers: {
        authorization: `Basic ${Buffer.from("a@acme.test:token").toString("base64")}`,
      },
      query: {},
    });
    assert.equal(await service.reader().state("atlassian", saved.id), "ready");
  });

  it("updates in place and rejects unknown kinds, fields, ids and secret names", async () => {
    const { service } = fixture();
    const { id } = service.save({ kind: "tavily", name: "One", fields: {} });
    service.save({ kind: "tavily", id, name: "Renamed", fields: {} });
    assert.equal((await service.reader().list("tavily"))[0]?.name, "Renamed");
    assert.throws(
      () => service.save({ kind: "jira", name: "x", fields: {} }),
      /No extension defines/,
    );
    assert.throws(
      () => service.save({ kind: "tavily", name: "x", fields: { extra: "1" } }),
      /no field/,
    );
    assert.throws(
      () =>
        service.save({ kind: "tavily", id: "missing", name: "x", fields: {} }),
      /does not exist/,
    );
    await assert.rejects(
      service.setSecrets("tavily", id, { wrong: "x" }),
      /no secret 'wrong'/,
    );
  });

  it("deletes the account with its credential; a second delete finds nothing", async () => {
    const { service, storage } = fixture();
    const { id } = service.save({ kind: "tavily", name: "One", fields: {} });
    await service.setSecrets("tavily", id, { secret: "key" });
    assert.equal(await service.delete("tavily", id), true);
    assert.equal(await service.delete("tavily", id), false);
    assert.equal(storage.accounts.list().length, 0);
  });

  it("rejects duplicate kinds across user-wide definitions but allows a project's own", () => {
    assert.throws(() => fixture([{ kind: tavily }, { kind: tavily }]), /both/);
    assert.doesNotThrow(() =>
      fixture([
        { kind: repoKind, projectId: "p1" },
        { kind: repoKind, projectId: "p2" },
      ]),
    );
  });

  describe("levels", () => {
    it("a project sees user-level accounts and its own; user scope sees user-level ones only", async () => {
      const { service } = fixture();
      const user = service.save({ kind: "tavily", name: "U", fields: {} });
      const one = service.save({
        kind: "tavily",
        name: "P1",
        fields: {},
        projectId: "p1",
      });
      const two = service.save({
        kind: "tavily",
        name: "P2",
        fields: {},
        projectId: "p2",
      });
      const names = async (reader: ReturnType<AccountsService["reader"]>) =>
        (await reader.list("tavily")).map((a) => a.name).sort();
      assert.deepEqual(await names(service.reader("p1")), ["P1", "U"]);
      assert.deepEqual(await names(service.reader("p2")), ["P2", "U"]);
      assert.deepEqual(await names(service.reader()), ["U"]);
      assert.equal(one.level, "project");
      assert.equal(one.projectId, "p1");
      // An `account` setting saved at user scope cannot select a project account.
      assert.ok(
        await service
          .reader("p1")
          .get("tavily", one.id, { userLevelOnly: false }),
      );
      assert.equal(
        await service
          .reader("p1")
          .get("tavily", one.id, { userLevelOnly: true }),
        undefined,
      );
      assert.ok(
        await service
          .reader("p1")
          .get("tavily", user.id, { userLevelOnly: true }),
      );
      assert.equal(await service.reader("p1").get("tavily", two.id), undefined);
      assert.deepEqual(
        (await service.views("p1")).map((view) => view.name).sort(),
        ["P1", "U"],
      );
      assert.equal((await service.views()).length, 3);
    });

    it("a project-defined kind has accounts of its project only", async () => {
      const { service } = fixture();
      assert.throws(
        () => service.save({ kind: "repo-service", name: "x", fields: {} }),
        /defined by a project/,
      );
      assert.throws(
        () =>
          service.save({
            kind: "repo-service",
            name: "x",
            fields: {},
            projectId: "p2",
          }),
        /defined by a project/,
      );
      const account = service.save({
        kind: "repo-service",
        name: "ok",
        fields: {},
        projectId: "p1",
      });
      assert.throws(
        () => service.move("repo-service", account.id, null),
        /defined by a project/,
      );
      assert.throws(
        () => service.move("repo-service", account.id, "p2"),
        /defined by a project/,
      );
      await assert.rejects(
        service.duplicate("repo-service", account.id, null),
        /defined by a project/,
      );
    });

    it("moves between levels keeping the credential, and rejects unknown projects", async () => {
      const { service } = fixture();
      const { id } = service.save({ kind: "tavily", name: "A", fields: {} });
      await service.setSecrets("tavily", id, { secret: "key" });
      service.move("tavily", id, "p1");
      assert.equal((await service.view("tavily", id))?.level, "project");
      assert.equal(await service.reader().get("tavily", id), undefined);
      // The credential still opens: the blob is bound to the id, not the level.
      assert.equal(
        (await service.reader("p1").apply("tavily", id, hop)).ok,
        true,
      );
      service.move("tavily", id, null);
      assert.equal((await service.view("tavily", id))?.level, "user");
      assert.throws(() => service.move("tavily", id, "nope"), /does not exist/);
    });

    it("duplicates into another level with the credential re-encrypted under the new id", async () => {
      const { service, storage } = fixture();
      const { id } = service.save({ kind: "tavily", name: "A", fields: {} });
      await service.setSecrets("tavily", id, { secret: "key" });
      const copy = await service.duplicate("tavily", id, "p2");
      assert.notEqual(copy.id, id);
      assert.equal(copy.projectId, "p2");
      assert.equal(copy.name, "A (copy)");
      assert.notDeepEqual(
        storage.accounts.readCredential(copy.id),
        storage.accounts.readCredential(id),
      );
      const applied = await service.reader("p2").apply("tavily", copy.id, hop);
      assert.deepEqual(applied, {
        ok: true,
        headers: { authorization: "Bearer key" },
        query: {},
      });
      // An account without a credential duplicates as one that needs sign-in.
      const bare = service.save({ kind: "tavily", name: "B", fields: {} });
      const bareCopy = await service.duplicate("tavily", bare.id, null);
      assert.equal(
        (await service.view("tavily", bareCopy.id))?.state,
        "needs_sign_in",
      );
    });

    it("clearing credentials leaves the account needing sign-in", async () => {
      const { service, storage } = fixture();
      const { id } = service.save({ kind: "tavily", name: "A", fields: {} });
      await service.setSecrets("tavily", id, { secret: "key" });
      await service.clearCredentials("tavily", id);
      assert.equal(storage.accounts.readCredential(id), null);
      assert.equal((await service.view("tavily", id))?.state, "needs_sign_in");
    });
  });

  it("an account whose kind's extension is gone stays listed as unavailable", async () => {
    const definitions: AccountDefinition[] = [{ kind: tavily }];
    const { service } = fixture(definitions);
    const { id } = service.save({ kind: "tavily", name: "A", fields: {} });
    await service.setSecrets("tavily", id, { secret: "key" });
    definitions.length = 0;
    assert.equal((await service.views())[0]?.state, "unavailable");
    assert.deepEqual(await service.reader().apply("tavily", id, hop), {
      ok: false,
      state: "unavailable",
    });
    assert.equal(await service.reader().state("tavily", id), "unavailable");
  });
});
