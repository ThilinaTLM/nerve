import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyMcpForm,
  entryFromForm,
  formFromEntry,
  secretNameFor,
  validateMcpForm,
  withSecretValues,
} from "./mcp-form";

describe("MCP form and entry", () => {
  it("round-trips a stdio entry, keeping the entry's own enabled", () => {
    const entry = {
      command: "npx",
      args: ["-y", "pkg"],
      cwd: "/work",
      env: { MODE: "dev" },
      timeout: 30,
      description: "Docs",
      enabled: false,
    };
    const form = formFromEntry("docs", entry);
    assert.equal(form.args, "-y\npkg");
    assert.deepEqual(entryFromForm(form), {
      name: "docs",
      entry,
      secrets: {},
    });
  });

  it("writes a secret as a reference and sends its value separately", () => {
    const form = {
      ...emptyMcpForm(),
      name: "my server",
      transport: "http" as const,
      url: "https://x.test/mcp",
      headers: [{ key: "Authorization", value: "Bearer t", secret: true }],
    };
    form.name = "api";
    const { entry, secrets } = entryFromForm(form);
    assert.deepEqual(entry, {
      type: "http",
      url: "https://x.test/mcp",
      headers: { Authorization: "${secret:api_Authorization}" },
    });
    assert.deepEqual(secrets, { api_Authorization: "Bearer t" });
  });

  it("keeps a stored secret's name and sends nothing while its field is blank", () => {
    const form = formFromEntry(
      "renamed",
      { command: "x", env: { TOKEN: "${secret:old_TOKEN}", A: "1" } },
      [{ name: "old_TOKEN", set: true }],
    );
    assert.deepEqual(form.env[0], {
      key: "TOKEN",
      value: "",
      secret: true,
      secretName: "old_TOKEN",
      stored: true,
    });
    const { entry, secrets } = entryFromForm(form);
    assert.equal(entry.env?.TOKEN, "${secret:old_TOKEN}");
    assert.deepEqual(secrets, {});
    const typed = withSecretValues(form, { old_TOKEN: "new" });
    assert.deepEqual(entryFromForm(typed).secrets, { old_TOKEN: "new" });
  });

  it("derives vault names from the allowed characters", () => {
    assert.equal(secretNameFor("a", "X-Api Key"), "a_X-Api_Key");
  });

  it("names what blocks saving", () => {
    const form = emptyMcpForm();
    assert.match(validateMcpForm(form) ?? "", /name/);
    form.name = "bad name";
    assert.match(validateMcpForm(form) ?? "", /letters/);
    form.name = "ok";
    assert.match(validateMcpForm(form) ?? "", /command/);
    form.command = "x";
    assert.equal(validateMcpForm(form), undefined);
    form.timeout = "abc";
    assert.match(validateMcpForm(form) ?? "", /seconds/);
  });
});
