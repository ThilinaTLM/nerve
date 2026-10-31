import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createdPrReference,
  referenceMatchesRepository,
} from "./pr-reference-signal.js";

const reference = {
  provider: "github",
  resourceKey: "github.com/a/b/pull/4",
  kind: "pull_request",
  relationship: "created" as const,
  url: "https://github.com/A/B/pull/4",
  container: "A/B",
  identifier: "4",
};
void test("created PR references match GitHub remotes by host, owner, repo rather than number alone", () => {
  const created = createdPrReference(reference)!;
  assert.equal(created.number, 4);
  assert.equal(
    referenceMatchesRepository(created, {
      hostname: "github.com",
      owner: "a",
      repo: "b",
    }),
    true,
  );
  assert.equal(
    referenceMatchesRepository(created, {
      hostname: "github.com",
      owner: "other",
      repo: "b",
    }),
    false,
  );
  assert.equal(
    referenceMatchesRepository(created, {
      hostname: "enterprise.example",
      owner: "A",
      repo: "B",
    }),
    false,
  );
  assert.equal(
    createdPrReference({ ...reference, relationship: "referenced" }),
    null,
  );
  assert.equal(
    createdPrReference({
      ...reference,
      url: "https://github.com/A/B/issues/4",
    }),
    null,
  );
});
