import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPublicKrokiUrl } from "./kroki-server";

describe("isPublicKrokiUrl", () => {
  it("flags only the public kroki.io host", () => {
    assert.equal(isPublicKrokiUrl("https://kroki.io/"), true);
    assert.equal(isPublicKrokiUrl("http://kroki.io/prefix/"), true);
    assert.equal(isPublicKrokiUrl("http://127.0.0.1:9080/kroki/"), false);
    assert.equal(isPublicKrokiUrl("https://kroki.io.example.org/"), false);
    assert.equal(isPublicKrokiUrl("not a url"), false);
  });
});
