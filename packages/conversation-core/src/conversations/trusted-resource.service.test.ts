import assert from "node:assert/strict";
import { test } from "node:test";
import { toTrustedDigest } from "@nervekit/contracts/core";
import type { CoreStorage } from "../storage/core-storage.js";
import { TrustedResourceService } from "./trusted-resource.service.js";

const digest = toTrustedDigest("a".repeat(64));
const other = toTrustedDigest("b".repeat(64));

void test("a stored row maps to the three trust states; a decline does not depend on the content", () => {
  const service = new TrustedResourceService({} as CoreStorage, () => "");
  const row = (status: "trusted" | "rejected") => ({
    status,
    contentDigest: digest,
  });
  assert.equal(service.trustState(null, digest), "needs_review");
  assert.equal(service.trustState(row("trusted"), digest), "trusted");
  assert.equal(service.trustState(row("trusted"), other), "needs_review");
  assert.equal(service.trustState(row("rejected"), digest), "declined");
  assert.equal(service.trustState(row("rejected"), other), "declined");
});
