import assert from "node:assert/strict";
import { test } from "node:test";
import { RpcError } from "@nervekit/protocol/rpc";
import { needsClientFailureNotice } from "./pr-mutation-feedback.js";

const rpc = (
  code: ConstructorParameters<typeof RpcError>[0]["code"],
  details?: Record<string, unknown>,
) => new RpcError({ code, message: "failed", retryable: false, details });

void test("a server-reported failure Activity suppresses the client notice regardless of code", () => {
  for (const code of [
    "CONFLICT",
    "DOMAIN_VALIDATION_FAILED",
    "INTERNAL_ERROR",
  ] as const)
    assert.equal(
      needsClientFailureNotice(rpc(code, { activityId: "act_1" })),
      false,
      code,
    );
});

void test("failures without a reported activity id are reported by the client", () => {
  assert.equal(
    needsClientFailureNotice(new Error("connection unavailable")),
    true,
  );
  assert.equal(needsClientFailureNotice(rpc("CONFLICT")), true);
  assert.equal(needsClientFailureNotice(rpc("CONFLICT", { other: 1 })), true);
  assert.equal(
    needsClientFailureNotice(rpc("CONFLICT", { activityId: "" })),
    true,
  );
  assert.equal(
    needsClientFailureNotice(rpc("CONFLICT", { activityId: 7 })),
    true,
  );
  assert.equal(needsClientFailureNotice(rpc("VALIDATION_FAILED")), true);
});
