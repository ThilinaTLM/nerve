import assert from "node:assert/strict";
import { test } from "node:test";
import { ExtensionError } from "@nervekit/extension-api";
import { createFakeContext } from "@nervekit/extension-api/testing";
import { defineMethod, definePositionalMethod } from "./define-method.js";
import { AtlassianApiError } from "./errors.js";

async function failWith(
  error: Error,
  resource: string,
  path = "pages.create",
): Promise<Error> {
  const { definition } = defineMethod<undefined, undefined>({
    product: "confluence",
    path,
    risk: "external_write",
    signature: "",
    options: [],
    parse: () => undefined,
    resource: () => resource,
    run: async () => {
      throw error;
    },
  });
  const { ctx } = createFakeContext();
  return (await Promise.resolve(definition.run(undefined, undefined, ctx)).then(
    () => new Error("did not fail"),
    (caught: unknown) => caught,
  )) as Error;
}

const apiError = (status: number, reason?: string) =>
  new AtlassianApiError(
    status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
    `Confluence PUT /pages/123 failed (${status}): ${reason}`,
    status,
    reason,
  );

test("Confluence transport errors become `subject: reason`, keeping the code", async () => {
  const error = await failWith(apiError(400, "Title too long"), "page 123");
  assert.equal(error.message, "page 123: Title too long");
  assert.equal((error as ExtensionError).code, "BAD_REQUEST");
});

test("a space resource adds no prefix, so the duplicate-title text stands alone", async () => {
  const error = await failWith(
    apiError(400, 'A page titled "Dup" already exists in this space'),
    "space (default)",
  );
  assert.equal(
    error.message,
    'A page titled "Dup" already exists in this space',
  );
});

test("without a reason the status is the message; the raw request keeps the full text", async () => {
  assert.equal(
    (await failWith(apiError(404), "issue APP-1")).message,
    "APP-1: HTTP 404",
  );
  const raw = apiError(404, "gone");
  assert.equal(await failWith(raw, "", "request"), raw);
});

test("other failures pass through untouched", async () => {
  const other = new ExtensionError("CONFLICT", "stale");
  assert.equal(await failWith(other, "page 1"), other);
});

test("one argument: a bare string only where the method names it, unknown options are listed", () => {
  const { definition } = defineMethod({
    product: "jira",
    path: "issues.get",
    risk: "network",
    signature: "",
    bare: "key",
    options: ["key", "fields"],
    parse: (options) => options,
    run: async () => undefined,
  });
  assert.deepEqual(definition.parse(["APP-1"]), { key: "APP-1" });
  assert.throws(
    () => definition.parse([{ issue: "APP-1" }]),
    /jira\.issues\.get has no option 'issue'; valid options: key, fields\./,
  );
  assert.throws(
    () => definition.parse(["a", "b"]),
    /takes one argument \(a key string or an options object\), got 2/,
  );
  const positional = definePositionalMethod({
    product: "jira",
    path: "request",
    risk: "destructive",
    signature: "",
    maxArgs: 2,
    parse: (args) => args,
    run: async () => undefined,
  });
  assert.throws(
    () => positional.definition.parse([1, 2, 3]),
    /jira\.request takes at most 2 arguments, got 3/,
  );
});
