import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiRequestError, apiPut } from "./api-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("API client errors", () => {
  it("preserves structured status, code, and message", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "FILE_REVISION_CONFLICT",
            message: "File changed on disk.",
          },
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      );

    await assert.rejects(
      apiPut("/api/filesystem/file", {}),
      (error) =>
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.code === "FILE_REVISION_CONFLICT" &&
        error.message === "File changed on disk.",
    );
  });
});
