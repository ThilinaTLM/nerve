import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { afterEach, describe, it } from "node:test";
import {
  deriveOAuthLoopbackRelayTarget,
  relayOAuthLoopbackRedirect,
  validateOAuthLoopbackRedirect,
} from "../../../src/domains/auth/oauth-loopback-relay.js";

const servers: Server[] = [];

async function listen(
  handler: Parameters<typeof createServer>[0],
): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  return { server, port: address.port };
}

function authorizationUrl(
  redirectUri: string,
  state = "expected-state",
): string {
  const url = new URL("https://issuer.example/authorize");
  url.searchParams.set("client_id", "client");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.href;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("OAuth loopback relay", () => {
  it("derives only explicit loopback HTTP callbacks with one state", () => {
    assert.deepEqual(
      deriveOAuthLoopbackRelayTarget(
        authorizationUrl("http://localhost:1455/auth/callback", "state-1"),
      ),
      {
        redirectUri: "http://localhost:1455/auth/callback",
        state: "state-1",
      },
    );
    assert.deepEqual(
      deriveOAuthLoopbackRelayTarget(
        authorizationUrl("http://[::1]:53692/callback"),
      ),
      {
        redirectUri: "http://[::1]:53692/callback",
        state: "expected-state",
      },
    );

    for (const redirectUri of [
      "https://localhost:1455/callback",
      "http://example.com:1455/callback",
      "http://127.0.0.1/callback",
      "http://user@127.0.0.1:1455/callback",
    ]) {
      assert.equal(
        deriveOAuthLoopbackRelayTarget(authorizationUrl(redirectUri)),
        undefined,
      );
    }

    const duplicateState = new URL(
      authorizationUrl("http://127.0.0.1:1455/callback"),
    );
    duplicateState.searchParams.append("state", "other");
    assert.equal(
      deriveOAuthLoopbackRelayTarget(duplicateState.href),
      undefined,
    );
  });

  it("requires the exact callback target and state", () => {
    const target = deriveOAuthLoopbackRelayTarget(
      authorizationUrl("http://localhost:1455/auth/callback?fixed=yes"),
    );
    assert(target);

    assert.equal(
      validateOAuthLoopbackRedirect(
        target,
        " http://localhost:1455/auth/callback?fixed=yes&code=abc&state=expected-state ",
      ).searchParams.get("code"),
      "abc",
    );

    for (const redirect of [
      "http://127.0.0.1:1455/auth/callback?fixed=yes&code=abc&state=expected-state",
      "http://localhost:1456/auth/callback?fixed=yes&code=abc&state=expected-state",
      "http://localhost:1455/other?fixed=yes&code=abc&state=expected-state",
      "http://localhost:1455/auth/callback?fixed=no&code=abc&state=expected-state",
      "http://localhost:1455/auth/callback?fixed=yes&code=abc&state=wrong",
      "http://localhost:1455/auth/callback?fixed=yes&code=abc&state=expected-state&state=expected-state",
      "http://localhost:1455/auth/callback?fixed=yes&state=expected-state",
      "http://localhost:1455/auth/callback?fixed=yes&code=a&code=b&state=expected-state",
      "http://localhost:1455/auth/callback?fixed=yes&code=a&error=denied&state=expected-state",
    ]) {
      assert.throws(() => validateOAuthLoopbackRedirect(target, redirect));
    }
  });

  it("relays one local GET and does not follow its redirect", async () => {
    let redirectedRequests = 0;
    const redirected = await listen((_request, response) => {
      redirectedRequests += 1;
      response.end("must not be reached");
    });

    let callbackRequestUrl: string | undefined;
    const callback = await listen((request, response) => {
      callbackRequestUrl = request.url;
      response.writeHead(302, {
        location: `http://127.0.0.1:${redirected.port}/unexpected`,
      });
      response.end("redirect");
    });
    const target = deriveOAuthLoopbackRelayTarget(
      authorizationUrl(`http://localhost:${callback.port}/callback`),
    );
    assert(target);

    const result = await relayOAuthLoopbackRedirect(
      target,
      `http://localhost:${callback.port}/callback?code=code-1&state=expected-state`,
    );

    assert.deepEqual(result, { status: 302 });
    assert.equal(
      callbackRequestUrl,
      "/callback?code=code-1&state=expected-state",
    );
    assert.equal(redirectedRequests, 0);
  });

  it("revalidates caller-provided targets before making a request", async () => {
    const forgedTarget = {
      redirectUri: "http://example.com:80/callback",
      state: "state",
    };

    await assert.rejects(() =>
      relayOAuthLoopbackRedirect(
        forgedTarget,
        "http://example.com:80/callback?state=state",
      ),
    );
  });
});
