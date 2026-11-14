import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountsConfigSchema,
  assertUniqueAccountKinds,
  validateAccountInput,
} from "../../src/domains/settings/index.js";
import type { AccountKind } from "../../src/domains/extensions/index.js";

const atlassian: AccountKind = {
  kind: "atlassian",
  label: "Atlassian account",
  fields: {
    name: { type: "string", label: "Name" },
    siteUrl: { type: "string", label: "Site URL", format: "url" },
    email: { type: "string", label: "Email" },
  },
  secret: { label: "API token" },
};

describe("accounts store", () => {
  it("parses accounts by kind and rejects duplicate ids within a kind", () => {
    assert.equal(
      accountsConfigSchema.safeParse({
        version: 2,
        accounts: {
          atlassian: [{ id: "acme", name: "Acme", fields: { email: "a@b.c" } }],
          tavily: [],
        },
      }).success,
      true,
    );
    assert.equal(
      accountsConfigSchema.safeParse({
        version: 2,
        accounts: {
          tavily: [
            { id: "x", name: "One", fields: {} },
            { id: "x", name: "Two", fields: {} },
          ],
        },
      }).success,
      false,
    );
    assert.equal(
      accountsConfigSchema.safeParse({ version: 2, profiles: {} }).success,
      false,
    );
  });

  it("validates input against the kind's fields and drops blanks", () => {
    assert.deepEqual(
      validateAccountInput(atlassian, {
        name: " Acme ",
        fields: { siteUrl: "https://acme.atlassian.net", email: "" },
      }),
      {
        ok: true,
        name: "Acme",
        fields: { siteUrl: "https://acme.atlassian.net" },
      },
    );
    assert.equal(
      validateAccountInput(atlassian, { name: "", fields: {} }).ok,
      false,
    );
    assert.equal(
      validateAccountInput(atlassian, { name: "A", fields: { extra: "x" } }).ok,
      false,
    );
    assert.equal(
      validateAccountInput(atlassian, {
        name: "A",
        fields: { siteUrl: "not a url" },
      }).ok,
      false,
    );
  });

  it("requires account kinds to be unique across extensions", () => {
    assert.doesNotThrow(() =>
      assertUniqueAccountKinds([
        { id: "atlassian", accounts: [atlassian] },
        { id: "web", accounts: [{ kind: "tavily" }] },
      ]),
    );
    assert.throws(
      () =>
        assertUniqueAccountKinds([
          { id: "a", accounts: [{ kind: "x" }] },
          { id: "b", accounts: [{ kind: "x" }] },
        ]),
      /both 'a' and 'b'/,
    );
  });
});
