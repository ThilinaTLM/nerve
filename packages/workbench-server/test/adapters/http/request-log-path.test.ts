import assert from "node:assert/strict";
import { test } from "node:test";
import { requestLogPath } from "../../../src/adapters/http/request-log-path.js";

test("redacts preview credentials for request, auth failure and handler diagnostics", () => {
  const id = "a".repeat(64);
  assert.equal(
    requestLogPath(`http://localhost/api/filesystem/html-preview/${id}`),
    "/api/filesystem/html-preview/:id",
  );
  assert.equal(
    requestLogPath(`http://localhost/html-preview/${id}/assets/file.css`),
    "/html-preview/:id/assets/file.css",
  );
  assert.equal(
    requestLogPath("http://localhost/api/filesystem/html-preview/invalid-id"),
    "/api/filesystem/html-preview/:id",
  );
  assert.equal(
    requestLogPath("http://localhost/api/filesystem/html-preview"),
    "/api/filesystem/html-preview",
  );
  assert.equal(
    requestLogPath("http://localhost/api/status?token=secret"),
    "/api/status",
  );
});
