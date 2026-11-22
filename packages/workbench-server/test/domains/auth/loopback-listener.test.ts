import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listenForLoopbackRedirect } from "../../../src/domains/auth/loopback-listener.js";

describe("loopback listener", () => {
  it("serves the given path with a fresh random state, /callback by default", async () => {
    const custom = await listenForLoopbackRedirect({ path: "/oauth/callback" });
    const plain = await listenForLoopbackRedirect({});
    try {
      assert.match(
        custom.redirectUri,
        /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/,
      );
      assert.match(plain.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      assert.notEqual(custom.state, plain.state);
      assert.ok(custom.state.length >= 22);

      const elsewhere = custom.redirectUri.replace(
        "/oauth/callback",
        "/callback",
      );
      assert.equal(
        (await fetch(`${elsewhere}?state=${custom.state}&code=c`)).status,
        404,
      );
      await fetch(`${custom.redirectUri}?state=${custom.state}&code=c`);
      assert.equal(await custom.code, "c");
    } finally {
      custom.close();
      plain.close();
    }
  });

  it("refuses a path a browser would rewrite, which could never match", async () => {
    for (const path of [
      "/a/../b",
      "/./cb",
      "/cb?x=1",
      "/cb#f",
      "//cb",
      "cb",
      "/a b",
      "/%41",
    ])
      await assert.rejects(
        listenForLoopbackRedirect({ path }),
        /redirect path/,
        path,
      );
  });
});
