import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountKind } from "@nervekit/contracts/extensions";
import {
  accountCanTest,
  accountFormInputs,
  helpParts,
  initialAccountForm,
  submitAccountForm,
} from "./account-form";

const atlassian: AccountKind = {
  kind: "atlassian",
  label: "Atlassian account",
  fields: {
    name: { type: "string", label: "Name" },
    siteUrl: { type: "string", label: "Site URL", format: "url" },
    email: { type: "string", label: "Email" },
  },
  secret: { label: "API token" },
  test: true,
};
const tavily: AccountKind = {
  kind: "tavily",
  label: "Tavily account",
  fields: { name: { type: "string", label: "Name" } },
  secret: { label: "API key" },
};

describe("account form", () => {
  it("generates inputs from the kind's fields, leaving the name to the dialog", () => {
    assert.deepEqual(
      accountFormInputs(atlassian).map(({ key, control }) => [key, control]),
      [
        ["siteUrl", "url"],
        ["email", "text"],
      ],
    );
    assert.deepEqual(accountFormInputs(tavily), []);
  });

  it("starts from the stored account and never from its secret", () => {
    assert.deepEqual(
      initialAccountForm(atlassian, {
        name: "Acme",
        fields: { siteUrl: "https://acme.atlassian.net" },
      }),
      {
        name: "Acme",
        fields: { siteUrl: "https://acme.atlassian.net", email: "" },
        secrets: { secret: "" },
      },
    );
  });

  it("submits normalized fields and requires the secret only while none is stored", () => {
    const form = {
      ...initialAccountForm(atlassian),
      name: " Acme ",
      fields: { siteUrl: "acme.atlassian.net", email: "" },
    };
    assert.deepEqual(submitAccountForm(atlassian, form, false), {
      ok: false,
      message: "Enter the API token.",
    });
    assert.deepEqual(submitAccountForm(atlassian, form, true), {
      ok: true,
      name: "Acme",
      fields: { siteUrl: "https://acme.atlassian.net" },
    });
    assert.deepEqual(
      submitAccountForm(
        atlassian,
        { ...form, secrets: { secret: " token " } },
        false,
      ),
      {
        ok: true,
        name: "Acme",
        fields: { siteUrl: "https://acme.atlassian.net" },
        secrets: { secret: "token" },
      },
    );
    assert.equal(
      submitAccountForm(
        tavily,
        { name: "", fields: {}, secrets: { secret: "k" } },
        false,
      ).ok,
      false,
    );
  });

  it("asks for every secret of a kind with several, and sends only those typed", () => {
    const keyed = {
      ...tavily,
      secret: undefined,
      secrets: {
        keyId: { label: "Key id" },
        keySecret: { label: "Key secret" },
      },
    };
    const form = {
      ...initialAccountForm(keyed),
      name: "K",
      secrets: { keyId: "id", keySecret: "" },
    };
    assert.deepEqual(submitAccountForm(keyed, form, false), {
      ok: false,
      message: "Enter the Key secret.",
    });
    assert.deepEqual(submitAccountForm(keyed, form, true), {
      ok: true,
      name: "K",
      fields: {},
      secrets: { keyId: "id" },
    });
  });

  it("offers Test only for kinds that define it and accounts with a secret", () => {
    assert.equal(accountCanTest(atlassian, { state: "ready" }), true);
    assert.equal(accountCanTest(atlassian, { state: "needs_sign_in" }), false);
    assert.equal(accountCanTest(tavily, { state: "ready" }), false);
  });

  it("splits help text into links and text", () => {
    assert.deepEqual(helpParts("Get a key at https://app.tavily.com."), [
      { text: "Get a key at " },
      { text: "https://app.tavily.com", href: "https://app.tavily.com" },
      { text: "." },
    ]);
    assert.deepEqual(helpParts("No link"), [{ text: "No link" }]);
  });
});
