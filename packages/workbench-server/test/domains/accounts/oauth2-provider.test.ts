import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import type { AccountKind } from "@nervekit/contracts/extensions";
import type { AuthEvent } from "@earendil-works/pi-ai";
import { listenForLoopbackRedirect } from "../../../src/domains/auth/loopback-listener.js";
import type { SignInInteraction } from "../../../src/domains/auth/sign-in-service.js";
import {
  CredentialTransientError,
  type ProviderAccount,
} from "../../../src/domains/accounts/credential-provider.js";
import { createOAuth2Provider } from "../../../src/domains/accounts/oauth2-provider.js";

type Hit = { path: string; body: URLSearchParams; authorization?: string };

/** A fake authorization server: answers are set per test; every request is recorded. */
async function service() {
  const hits: Hit[] = [];
  const answers = new Map<
    string,
    (hit: Hit) => { status?: number; json?: unknown }
  >();
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const hit: Hit = {
        path: request.url ?? "",
        body: new URLSearchParams(Buffer.concat(chunks).toString("utf8")),
        ...(request.headers.authorization
          ? { authorization: request.headers.authorization }
          : {}),
      };
      hits.push(hit);
      const handler = answers.get(hit.path);
      const answer =
        typeof handler === "function"
          ? handler(hit)
          : { status: 404, json: {} };
      response.writeHead(answer.status ?? 200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(answer.json ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, hits, answers, close: () => server.close() };
}

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

function kindFor(
  base: string,
  provider: Partial<NonNullable<AccountKind["provider"]>> = {},
): AccountKind {
  return {
    kind: "svc",
    label: "Service",
    fields: {
      clientId: { type: "string", label: "Client id", default: "shipped-id" },
      tenant: { type: "string", label: "Tenant" },
    },
    secrets: { clientSecret: { label: "Client secret" } },
    provider: {
      type: "oauth2",
      authorizationUrl: `${base}/authorize`,
      tokenUrl: `${base}/token`,
      deviceAuthorizationUrl: `${base}/device`,
      scopes: ["read", "write"],
      clientSecret: "clientSecret",
      ...provider,
    },
  };
}

const account = (
  kind: AccountKind,
  fields: Record<string, unknown> = {},
): ProviderAccount => ({ id: "a1", kind, fields });

function interactionStub(options: {
  browser?: (url: URL) => Promise<void>;
  answers?: string[];
}) {
  const events: AuthEvent[] = [];
  const controller = new AbortController();
  const interaction: SignInInteraction = {
    signal: controller.signal,
    prompt: async () => options.answers?.shift() ?? "",
    notify: (event) => {
      events.push(event);
      if (event.type === "auth_url") void options.browser?.(new URL(event.url));
    },
    listenLoopback: (options) =>
      listenForLoopbackRedirect(options ?? {}, controller.signal),
  };
  return { interaction, events, controller };
}

const provider = (extra: Parameters<typeof createOAuth2Provider>[0] = {}) =>
  createOAuth2Provider({ allowPrivateNetwork: true, ...extra });

describe("oauth2 provider", () => {
  it("authorization code with PKCE: loopback redirect, verifier proof, expiry, scopes and identity", async () => {
    const fake = await service();
    closers.push(fake.close);
    let challenge = "";
    fake.answers.set("/token", (hit) => {
      const verifier = hit.body.get("code_verifier") ?? "";
      assert.equal(
        createHash("sha256").update(verifier).digest("base64url"),
        challenge,
      );
      return {
        json: {
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          scope: "read write",
        },
      };
    });
    fake.answers.set("/me", (hit) => {
      assert.equal(hit.authorization, "Bearer access-1");
      return { json: { user: { login: "octo", id: 7 }, junk: "x\ny" } };
    });
    const kind = kindFor(fake.base, {
      userinfo: {
        url: `${fake.base}/me`,
        identity: { login: "user.login", id: "user.id", junk: "junk" },
      },
    });
    const { interaction, events } = interactionStub({
      browser: async (url) => {
        assert.equal(url.pathname, "/authorize");
        assert.equal(url.searchParams.get("client_id"), "shipped-id");
        assert.equal(url.searchParams.get("scope"), "read write");
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        challenge = url.searchParams.get("code_challenge")!;
        const redirect = new URL(url.searchParams.get("redirect_uri")!);
        assert.equal(redirect.hostname, "127.0.0.1");
        assert.equal(redirect.pathname, "/callback");
        // The wrong state is refused and does not end the sign-in.
        const bad = await fetch(`${redirect}?code=evil&state=nope`);
        assert.equal(bad.status, 400);
        await fetch(
          `${redirect}?code=the-code&state=${url.searchParams.get("state")}`,
        );
      },
    });
    const outcome = await provider({ now: () => 1_000_000 }).signIn(
      account(kind),
      { secrets: { clientSecret: "shh" }, interaction },
    );
    assert.deepEqual(outcome, {
      status: "ready",
      state: { accessToken: "access-1", refreshToken: "refresh-1" },
      grantedScopes: ["read", "write"],
      expiresAt: new Date(1_000_000 + 3_600_000).toISOString(),
      identity: { login: "octo", id: "7" },
    });
    assert.equal(events.filter((e) => e.type === "auth_url").length, 1);
    const exchange = fake.hits.find((hit) => hit.path === "/token")!.body;
    assert.equal(exchange.get("grant_type"), "authorization_code");
    assert.equal(exchange.get("code"), "the-code");
    assert.equal(exchange.get("client_secret"), "shh");
    assert.equal(exchange.get("client_id"), "shipped-id");
  });

  it("the client id is an account field; the author's default applies only while it is empty; redirectPath sets the redirect path", async () => {
    const fake = await service();
    closers.push(fake.close);
    fake.answers.set("/token", () => ({ json: { access_token: "t" } }));
    const kind = kindFor(fake.base, { redirectPath: "/oauth/callback" });
    const { interaction } = interactionStub({
      browser: async (url) => {
        assert.equal(url.searchParams.get("client_id"), "mine");
        const redirect = url.searchParams.get("redirect_uri")!;
        assert.equal(new URL(redirect).pathname, "/oauth/callback");
        await fetch(
          `${redirect}?code=c&state=${url.searchParams.get("state")}`,
        );
      },
    });
    const outcome = await provider().signIn(
      account(kind, { clientId: "mine" }),
      {
        secrets: {},
        interaction,
      },
    );
    assert.equal(outcome.status, "ready");
    // No expiry in the response: the token does not expire; no scope: what was asked for.
    assert.equal("expiresAt" in outcome, false);
    assert.deepEqual((outcome as { grantedScopes?: string[] }).grantedScopes, [
      "read",
      "write",
    ]);
  });

  it("a refused authorization ends the sign-in with the service's error", async () => {
    const fake = await service();
    closers.push(fake.close);
    const kind = kindFor(fake.base);
    const { interaction } = interactionStub({
      browser: async (url) => {
        const redirect = url.searchParams.get("redirect_uri")!;
        await fetch(
          `${redirect}?error=access_denied&state=${url.searchParams.get("state")}`,
        );
      },
    });
    await assert.rejects(
      provider().signIn(account(kind), { secrets: {}, interaction }),
      /access_denied/,
    );
  });

  it("device code: shows the code, polls through pending and slow_down, then signs in", async () => {
    const fake = await service();
    closers.push(fake.close);
    fake.answers.set("/device", () => ({
      json: {
        device_code: "dev-1",
        user_code: "ABCD-1234",
        verification_uri: "https://example.test/device",
        expires_in: 900,
        interval: 5,
      },
    }));
    const polls = ["authorization_pending", "slow_down", "ok"];
    fake.answers.set("/token", (hit) => {
      assert.equal(
        hit.body.get("grant_type"),
        "urn:ietf:params:oauth:grant-type:device_code",
      );
      assert.equal(hit.body.get("device_code"), "dev-1");
      const next = polls.shift();
      return next === "ok"
        ? { json: { access_token: "dev-access", refresh_token: "dev-refresh" } }
        : { status: 400, json: { error: next } };
    });
    const kind = kindFor(fake.base, { flows: ["device_code"] });
    const waits: number[] = [];
    const { interaction, events } = interactionStub({});
    const outcome = await provider({
      sleep: async (ms) => void waits.push(ms),
    }).signIn(account(kind), { secrets: {}, interaction });
    assert.equal(outcome.status, "ready");
    assert.deepEqual(waits, [5000, 5000, 10_000]);
    assert.deepEqual(events[0], {
      type: "device_code",
      userCode: "ABCD-1234",
      verificationUri: "https://example.test/device",
      intervalSeconds: 5,
      expiresInSeconds: 900,
    });
  });

  it("device code: declined and expired codes need a new sign-in", async () => {
    const fake = await service();
    closers.push(fake.close);
    fake.answers.set("/device", () => ({
      json: {
        device_code: "d",
        user_code: "U",
        verification_uri: "https://example.test/device",
        expires_in: 900,
      },
    }));
    const kind = kindFor(fake.base, { flows: ["device_code"] });
    for (const [error, message] of [
      ["access_denied", /declined/],
      ["expired_token", /expired/],
    ] as const) {
      fake.answers.set("/token", () => ({ status: 400, json: { error } }));
      const { interaction } = interactionStub({});
      const outcome = await provider({ sleep: async () => {} }).signIn(
        account(kind),
        { secrets: {}, interaction },
      );
      assert.equal(outcome.status, "needs_sign_in");
      assert.match((outcome as { message: string }).message, message);
    }
  });

  it("with several flows the user chooses", async () => {
    const fake = await service();
    closers.push(fake.close);
    fake.answers.set("/device", () => ({
      json: {
        device_code: "d",
        user_code: "U",
        verification_uri: "https://x.test",
      },
    }));
    fake.answers.set("/token", () => ({ json: { access_token: "t" } }));
    const kind = kindFor(fake.base, {
      flows: ["authorization_code", "device_code"],
    });
    const { interaction, events } = interactionStub({
      answers: ["device_code"],
    });
    const outcome = await provider({ sleep: async () => {} }).signIn(
      account(kind),
      { secrets: {}, interaction },
    );
    assert.equal(outcome.status, "ready");
    assert.equal(events[0]?.type, "device_code");
  });

  it("endpoints come from OIDC discovery and {field} templates", async () => {
    const fake = await service();
    closers.push(fake.close);
    fake.answers.set("/acme/.well-known/openid-configuration", () => ({
      json: {
        authorization_endpoint: `${fake.base}/authorize`,
        token_endpoint: `${fake.base}/real-token`,
        revocation_endpoint: `${fake.base}/revoke`,
      },
    }));
    fake.answers.set("/real-token", (hit) => ({
      json: {
        access_token: "new",
        refresh_token: hit.body.get("refresh_token"),
      },
    }));
    const kind = kindFor(fake.base, {
      discovery: `${fake.base}/{tenant}`,
      tokenUrl: undefined,
      authorizationUrl: undefined,
    });
    const refreshed = await provider().refresh(
      account(kind, { tenant: "acme" }),
      { secrets: {}, state: { accessToken: "old", refreshToken: "r" } },
    );
    assert.equal(refreshed.status, "ready");
    // A missing template field says what to fill in.
    await assert.rejects(
      provider().refresh(account(kind), {
        secrets: {},
        state: { accessToken: "old", refreshToken: "r" },
      }),
      /Fill in "Tenant"/,
    );
  });

  describe("refresh", () => {
    const credential = (extra: object = {}) => ({
      secrets: { clientSecret: "shh" },
      state: { accessToken: "old", refreshToken: "r-old" },
      grantedScopes: ["read", "write"],
      ...extra,
    });

    it("rotates the refresh token when given and keeps the old one when not", async () => {
      const fake = await service();
      closers.push(fake.close);
      const kind = kindFor(fake.base);
      const instance = provider({ now: () => 0 });
      fake.answers.set("/token", () => ({
        json: { access_token: "a2", refresh_token: "r-new", expires_in: 60 },
      }));
      assert.deepEqual(await instance.refresh(account(kind), credential()), {
        status: "ready",
        state: { accessToken: "a2", refreshToken: "r-new" },
        grantedScopes: ["read", "write"],
        expiresAt: new Date(60_000).toISOString(),
      });
      fake.answers.set("/token", () => ({ json: { access_token: "a3" } }));
      const kept = await instance.refresh(account(kind), credential());
      assert.deepEqual((kept as { state: unknown }).state, {
        accessToken: "a3",
        refreshToken: "r-old",
      });
      const sent = fake.hits.at(-1)!.body;
      assert.equal(sent.get("grant_type"), "refresh_token");
      assert.equal(sent.get("refresh_token"), "r-old");
      assert.equal(sent.get("client_secret"), "shh");
    });

    it("takes the granted scopes from the response", async () => {
      const fake = await service();
      closers.push(fake.close);
      fake.answers.set("/token", () => ({
        json: { access_token: "a", scope: "read" },
      }));
      const outcome = await provider().refresh(
        account(kindFor(fake.base)),
        credential(),
      );
      assert.deepEqual((outcome as { grantedScopes: string[] }).grantedScopes, [
        "read",
      ]);
    });

    it("maps errors: invalid_grant needs sign-in, invalid_client fails, network and 5xx are transient", async () => {
      const fake = await service();
      closers.push(fake.close);
      const kind = kindFor(fake.base);
      fake.answers.set("/token", () => ({
        status: 400,
        json: { error: "invalid_grant" },
      }));
      assert.equal(
        (await provider().refresh(account(kind), credential())).status,
        "needs_sign_in",
      );
      fake.answers.set("/token", () => ({
        status: 401,
        json: { error: "invalid_client", error_description: "bad secret" },
      }));
      const failed = await provider().refresh(account(kind), credential());
      assert.equal(failed.status, "failed");
      assert.match(
        (failed as { message: string }).message,
        /client id or secret.*bad secret/,
      );
      fake.answers.set("/token", () => ({ status: 503, json: {} }));
      await assert.rejects(
        provider().refresh(account(kind), credential()),
        CredentialTransientError,
      );
      // Nothing listens there any more.
      fake.close();
      await assert.rejects(
        provider().refresh(account(kind), credential()),
        CredentialTransientError,
      );
    });

    it("without a refresh token there is nothing to refresh with", async () => {
      const instance = provider();
      const kind = kindFor("http://127.0.0.1:1");
      const bare = { secrets: {}, state: { accessToken: "a" } };
      assert.equal(instance.canRefresh?.(bare), false);
      assert.equal(instance.canRefresh?.(credential()), true);
      assert.equal(
        (await instance.refresh(account(kind), bare)).status,
        "needs_sign_in",
      );
    });
  });

  it("applies the access token as a bearer header and names the scopes it needs", async () => {
    const kind = kindFor("http://127.0.0.1:1");
    const instance = provider();
    assert.deepEqual(
      await instance.apply(
        account(kind),
        { secrets: {}, state: { accessToken: "tok" } },
        { method: "GET", url: new URL("https://x.test") },
      ),
      { headers: { authorization: "Bearer tok" }, query: {} },
    );
    assert.deepEqual(instance.requiredScopes?.(account(kind)), [
      "read",
      "write",
    ]);
    assert.equal(
      (await instance.signIn(account(kind), { secrets: {} })).status,
      "needs_sign_in",
    );
  });

  it("revokes the refresh token at the revocation endpoint", async () => {
    const fake = await service();
    closers.push(fake.close);
    fake.answers.set("/revoke", () => ({ json: {} }));
    const kind = kindFor(fake.base, { revocationUrl: `${fake.base}/revoke` });
    await provider().revoke(account(kind), {
      secrets: {},
      state: { accessToken: "a", refreshToken: "r" },
    });
    const sent = fake.hits.find((hit) => hit.path === "/revoke")!.body;
    assert.equal(sent.get("token"), "r");
    assert.equal(sent.get("token_type_hint"), "refresh_token");
  });

  it("refuses sign-in origins on private addresses unless allowed", async () => {
    const kind = kindFor("http://127.0.0.1:9");
    await assert.rejects(
      createOAuth2Provider().refresh(account(kind), {
        secrets: {},
        state: { accessToken: "a", refreshToken: "r" },
      }),
      /blocked by host policy/,
    );
  });
});
