import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthEvent } from "@earendil-works/pi-ai";
import { accountKindSchema } from "@nervekit/contracts/extensions";
import { createOAuth2Provider } from "../../../src/domains/accounts/oauth2-provider.js";
import { githubAccount } from "./github-device-flow.example.js";

describe("GitHub device flow example", () => {
  const kind = { kind: "github", ...githubAccount };

  it("is valid manifest data: no secrets, no auth, a bearer token to api.github.com", () => {
    assert.ok(accountKindSchema.safeParse(kind).success);
  });

  it("signs in through GitHub's device endpoints and reads the login", async () => {
    const requests: string[] = [];
    // GitHub answers form posts with JSON when asked to; here a canned service stands in.
    const fakeFetch = (async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = new URLSearchParams(String(init?.body ?? ""));
      requests.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), { status });
      if (url.pathname === "/login/device/code") {
        assert.equal(body.get("client_id"), "Iv1.example");
        assert.equal(body.get("scope"), "repo read:user");
        return json({
          device_code: "dev",
          user_code: "WDJB-MJHT",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        });
      }
      if (url.pathname === "/login/oauth/access_token")
        return json({
          access_token: "gho_token",
          token_type: "bearer",
          scope: "repo,read:user",
        });
      if (url.host === "api.github.com")
        return json({ login: "octocat", id: 1 });
      return json({}, 404);
    }) as typeof fetch;
    const provider = createOAuth2Provider({
      fetch: fakeFetch,
      allowPrivateNetwork: true,
      sleep: async () => {},
    });
    const events: AuthEvent[] = [];
    const outcome = await provider.signIn(
      { id: "g1", kind, fields: { clientId: "Iv1.example" } },
      {
        secrets: {},
        interaction: {
          signal: new AbortController().signal,
          prompt: async () => "",
          notify: (event) => void events.push(event),
          listenLoopback: async () => {
            throw new Error("not used by the device flow");
          },
        },
      },
    );
    assert.deepEqual(outcome, {
      status: "ready",
      state: { accessToken: "gho_token" },
      grantedScopes: ["repo", "read:user"],
      identity: { login: "octocat", id: "1" },
    });
    assert.equal(events[0]?.type, "device_code");
    // GitHub's classic tokens do not expire and have no refresh token: nothing to refresh.
    assert.equal(
      provider.canRefresh?.({
        secrets: {},
        state: { accessToken: "gho_token" },
      }),
      false,
    );
    assert.deepEqual(requests, [
      "POST github.com/login/device/code",
      "POST github.com/login/oauth/access_token",
      "GET api.github.com/user",
    ]);
  });
});
