import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolExecutionError } from "@nervekit/tools/execution";
import { withTidyErrors } from "./tidy-errors.js";

async function failWith(
  message: string,
  resource: string,
  code: string,
): Promise<Error> {
  const method = withTidyErrors({
    product: "confluence",
    path: "pages.create",
    risk: "external_write",
    signature: "",
    prepare: () => ({
      resource,
      run: async () => {
        throw new ToolExecutionError(code, message);
      },
    }),
  });
  const prepared = method.prepare([], {} as never);
  return (await prepared.run({} as never).then(
    () => new Error("did not fail"),
    (error: unknown) => error,
  )) as Error;
}

void test("Confluence transport errors become `subject: reason`, keeping the code", async () => {
  const error = await failWith(
    "CONFLUENCE_BAD_REQUEST: Confluence PUT /pages/123 failed (400 Bad Request): Title too long See /home/x/SKILL.md.",
    "page 123",
    "CONFLUENCE_BAD_REQUEST",
  );
  assert.equal(error.message, "page 123: Title too long");
  assert.equal((error as ToolExecutionError).code, "CONFLUENCE_BAD_REQUEST");
});

void test("a space resource adds no prefix, so the duplicate-title text stands alone", async () => {
  const error = await failWith(
    'CONFLUENCE_BAD_REQUEST: Confluence POST /pages failed (400 Bad Request): A page titled "Dup" already exists in this space',
    "space (default)",
    "CONFLUENCE_BAD_REQUEST",
  );
  assert.equal(
    error.message,
    'A page titled "Dup" already exists in this space',
  );
});
