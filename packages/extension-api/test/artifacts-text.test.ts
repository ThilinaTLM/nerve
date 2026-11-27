import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactNameOf,
  assertArtifactName,
  closeMatches,
  mediaTypeFor,
} from "../src/host.js";

void test("artifact names accept handles and reject folders", () => {
  assert.equal(artifactNameOf("artifact:report 1.csv"), "report 1.csv");
  assert.equal(artifactNameOf("plain.txt"), "plain.txt");
  assert.throws(() => assertArtifactName("../x"), /Invalid artifact name/);
  assert.throws(() => assertArtifactName(".hidden"), /Invalid artifact name/);
});

void test("mediaTypeFor uses the last extension case-insensitively", () => {
  assert.equal(mediaTypeFor("a/b.PNG"), "image/png");
  assert.equal(mediaTypeFor("archive.tar.zip"), "application/zip");
  assert.equal(mediaTypeFor(".json"), "application/octet-stream");
  assert.equal(mediaTypeFor("noext"), "application/octet-stream");
});

void test("closeMatches ranks exact, substring, then small edit distance", () => {
  assert.deepEqual(
    closeMatches("isue", ["issue", "issues.search", "pages", "Issue"]),
    ["issue", "Issue"],
  );
  assert.deepEqual(closeMatches("  ", ["a"]), []);
  assert.deepEqual(closeMatches("page", ["pages", "page"]), ["page", "pages"]);
});
