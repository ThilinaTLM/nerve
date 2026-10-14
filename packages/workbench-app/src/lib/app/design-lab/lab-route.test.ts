import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hashForSection,
  labRouteFromPath,
  sectionIdFromHash,
} from "./lab-route.js";

test("recognizes catalog, wireframe index and named wireframes", () => {
  assert.deepEqual(labRouteFromPath("/dev/components"), { page: "components" });
  assert.deepEqual(labRouteFromPath("/dev/components/"), {
    page: "components",
  });
  assert.deepEqual(labRouteFromPath("/dev/wireframes"), { page: "wireframes" });
  assert.deepEqual(labRouteFromPath("/dev/wireframes/review-queue/"), {
    page: "wireframes",
    name: "review-queue",
  });
});

test("rejects legacy routes, prefix collisions and invalid wireframe names", () => {
  for (const path of [
    "/",
    "/ui-gallery",
    "/dev/components-extra",
    "/dev/components/nested",
    "/dev/wireframes-extra",
    "/dev/wireframes/a/b",
    "/dev/wireframes/%2e%2e",
    "/dev/wireframes/-bad",
    "/dev/wireframes//",
  ]) {
    assert.equal(labRouteFromPath(path), undefined, path);
  }
});

test("round-trips catalog section ids through the hash", () => {
  assert.equal(sectionIdFromHash(hashForSection("controls")), "controls");
  assert.equal(sectionIdFromHash("#controls"), "controls");
  assert.equal(sectionIdFromHash(""), undefined);
  assert.equal(sectionIdFromHash("#/"), undefined);
});
