import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathMentionReference } from "./composer-path-references";

describe("pathMentionReference", () => {
  it("prefixes bare paths and derives label, kind and title", () => {
    assert.deepEqual(pathMentionReference("/tmp/up/image-1.png", "image"), {
      insert: "@/tmp/up/image-1.png",
      label: "image-1.png",
      kind: "image",
      title: "/tmp/up/image-1.png",
    });
    assert.equal(pathMentionReference("src/a.ts").kind, "file");
    assert.equal(pathMentionReference("assets/logo.PNG").kind, "image");
    const dir = pathMentionReference("packages/ui/");
    assert.equal(dir.kind, "directory");
    assert.equal(dir.label, "ui/");
    assert.equal(dir.insert, "@packages/ui/");
  });

  it("does not double-prefix and keeps whitespace paths quoted", () => {
    assert.equal(pathMentionReference("@src/a.ts").insert, "@src/a.ts");
    const spaced = pathMentionReference('"My Docs/a b.txt"');
    assert.equal(spaced.insert, '"@My Docs/a b.txt"');
    assert.equal(spaced.label, "a b.txt");
    assert.equal(spaced.title, "My Docs/a b.txt");
    assert.equal(pathMentionReference('"@My Docs/"').kind, "directory");
  });
});
