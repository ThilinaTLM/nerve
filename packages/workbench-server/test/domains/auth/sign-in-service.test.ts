import assert from "node:assert/strict";
import { createServer } from "node:http";
import type {
  AuthInteraction,
  OAuthCredentials,
  Provider,
} from "@earendil-works/pi-ai";
import { describe, it } from "node:test";
import { waitFor as waitForCondition } from "@nervekit/test-kit";
import { SignInService } from "../../../src/domains/auth/sign-in-service.js";

type Login = (interaction: AuthInteraction) => Promise<void>;

function provider(): Provider {
  return {
    id: "test-oauth",
    name: "Test OAuth",
    auth: { oauth: { name: "OAuth" } },
  } as unknown as Provider;
}

function harness(login: Login) {
  const published: Array<{ type: string; data: unknown }> = [];
  const manager = new SignInService(
    {
      getProvider: () => provider(),
      loginOAuth: async (_providerId, interaction) => {
        await login(interaction);
        return { type: "oauth", access: "token" } as OAuthCredentials & {
          type: "oauth";
        };
      },
    },
    {
      async publish(type: string, data: unknown) {
        published.push({ type, data });
      },
    },
  );
  return { manager, published };
}

const waitFor = (predicate: () => boolean, message = "condition") =>
  waitForCondition(predicate, { timeoutMs: 2_000, intervalMs: 5, message });

describe("SignInService", () => {
  it("maps and validates provider choices before completing", async () => {
    const { manager } = harness(async (interaction) => {
      const selected = await interaction.prompt({
        type: "select",
        message: "Choose login method",
        options: [
          { id: "browser", label: "Browser" },
          { id: "device", label: "Device code" },
        ],
      });
      assert.equal(selected, "device");
    });

    const started = await manager.start("test-oauth");
    await waitFor(
      () =>
        manager.get(started.flowId).state === "active" &&
        manager.get(started.flowId).interaction.type === "choice",
      "choice prompt",
    );
    const choice = manager.get(started.flowId);
    assert.equal(choice.state, "active");
    assert.equal(choice.interaction.type, "choice");
    if (choice.interaction.type !== "choice") return;

    await assert.rejects(
      manager.respond(started.flowId, {
        type: "select",
        interactionId: choice.interaction.interactionId,
        selectedId: "unknown",
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "OAUTH_OPTION_INVALID",
    );
    await manager.respond(started.flowId, {
      type: "select",
      interactionId: choice.interaction.interactionId,
      selectedId: "device",
    });
    await waitFor(
      () => manager.get(started.flowId).state === "succeeded",
      "successful login",
    );
  });

  it("exposes device-code expiry and stops stale updates after success", async () => {
    let finish!: () => void;
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const before = Date.now();
    const { manager } = harness(async (interaction) => {
      interaction.notify({
        type: "device_code",
        userCode: "ABCD-EFGH",
        verificationUri: "https://example.com/device",
        intervalSeconds: 5,
        expiresInSeconds: 60,
      });
      await completed;
    });

    const started = await manager.start("test-oauth");
    await waitFor(() => {
      const flow = manager.get(started.flowId);
      return flow.state === "active" && flow.interaction.type === "device_code";
    }, "device-code interaction");
    const active = manager.get(started.flowId);
    assert.equal(active.state, "active");
    assert.equal(active.interaction.type, "device_code");
    if (active.interaction.type !== "device_code") return;
    assert.equal(active.interaction.userCode, "ABCD-EFGH");
    assert.equal(active.interaction.intervalSeconds, 5);
    assert.ok(active.interaction.expiresAt);
    assert.ok(Date.parse(active.interaction.expiresAt) >= before + 59_000);

    finish();
    await waitFor(
      () => manager.get(started.flowId).state === "succeeded",
      "successful device flow",
    );
  });

  it("forwards provider-backed authorization input", async () => {
    const { manager } = harness(async (interaction) => {
      interaction.notify({
        type: "auth_url",
        url: "https://provider.example/authorize",
        instructions: "Continue in your browser.",
      });
      const value = await interaction.prompt({
        type: "manual_code",
        message: "Paste the authorization code or redirect URL",
        placeholder: "Authorization code",
      });
      assert.equal(value, "provider-code");
    });

    const started = await manager.start("test-oauth");
    await waitFor(() => {
      const flow = manager.get(started.flowId);
      return (
        flow.state === "active" &&
        flow.interaction.type === "browser" &&
        flow.interaction.manualEntry?.acceptedInput === "authorization_input"
      );
    }, "provider manual-code prompt");
    const active = manager.get(started.flowId);
    assert.equal(active.state, "active");
    assert.equal(active.interaction.type, "browser");
    if (
      active.interaction.type !== "browser" ||
      !active.interaction.manualEntry
    )
      return;

    await manager.respond(started.flowId, {
      type: "manual_redirect",
      interactionId: active.interaction.manualEntry.interactionId,
      value: "provider-code",
    });
    await waitFor(() => manager.get(started.flowId).state === "succeeded");
  });

  it("relays a pasted loopback redirect into a provider callback", async () => {
    let callbackResolve!: () => void;
    const callbackReceived = new Promise<void>((resolve) => {
      callbackResolve = resolve;
    });
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      assert.equal(url.pathname, "/callback");
      assert.equal(url.searchParams.get("code"), "auth-code");
      assert.equal(url.searchParams.get("state"), "expected-state");
      response.statusCode = 200;
      response.end("ok");
      callbackResolve();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const callback = `http://localhost:${address.port}/callback`;

    try {
      const { manager } = harness(async (interaction) => {
        const authorization = new URL("https://provider.example/authorize");
        authorization.searchParams.set("redirect_uri", callback);
        authorization.searchParams.set("state", "expected-state");
        interaction.notify({
          type: "auth_url",
          url: authorization.href,
          instructions: "Continue in your browser.",
        });
        await callbackReceived;
      });

      const started = await manager.start("test-oauth");
      await waitFor(() => {
        const flow = manager.get(started.flowId);
        return flow.state === "active" && flow.interaction.type === "browser";
      }, "browser interaction");
      const browser = manager.get(started.flowId);
      assert.equal(browser.state, "active");
      assert.equal(browser.interaction.type, "browser");
      if (browser.interaction.type !== "browser") return;
      assert.equal(
        browser.interaction.manualEntry?.acceptedInput,
        "redirect_url",
      );
      assert.ok(browser.interaction.manualEntry);

      await manager.respond(started.flowId, {
        type: "manual_redirect",
        interactionId: browser.interaction.manualEntry.interactionId,
        value: `${callback}?code=auth-code&state=expected-state`,
      });
      await waitFor(
        () => manager.get(started.flowId).state === "succeeded",
        "relayed callback completion",
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("cancels a pending prompt and rejects stale responses", async () => {
    const { manager } = harness(async (interaction) => {
      await interaction.prompt({ type: "text", message: "Enterprise domain" });
    });
    const started = await manager.start("test-oauth");
    await waitFor(() => {
      const flow = manager.get(started.flowId);
      return flow.state === "active" && flow.interaction.type === "text_input";
    });
    const active = manager.get(started.flowId);
    assert.equal(active.state, "active");
    assert.equal(active.interaction.type, "text_input");
    if (active.interaction.type !== "text_input") return;

    const cancelled = await manager.cancel(started.flowId);
    assert.equal(cancelled.state, "cancelled");
    const stale = await manager.respond(started.flowId, {
      type: "text",
      interactionId: active.interaction.interactionId,
      value: "example.com",
    });
    assert.equal(stale.state, "cancelled");
  });
});

describe("SignInService for accounts", () => {
  const target = { kind: "svc", id: "acct-1", name: "Work" };
  const idle = () => harness(async () => {}).manager;

  it("runs the account's login with the shared interaction and reports success once", async () => {
    const manager = idle();
    const done: string[] = [];
    const flow = await manager.startAccount(
      target,
      async (interaction) => {
        interaction.notify({
          type: "device_code",
          userCode: "ABCD",
          verificationUri: "https://example.test/device",
        });
        await waitFor(() => done.length === 1, "answered");
      },
      async (info) => void done.push(info.state),
    );
    assert.deepEqual(
      {
        account: flow.account,
        provider: flow.provider,
        name: flow.providerName,
      },
      {
        account: { kind: "svc", id: "acct-1" },
        provider: "account:acct-1",
        name: "Work",
      },
    );
    await waitFor(
      () =>
        manager.get(flow.flowId).state === "active" &&
        (manager.get(flow.flowId) as { interaction: { type: string } })
          .interaction.type === "device_code",
      "device code shown",
    );
    done.push("answered");
    await waitFor(
      () => manager.get(flow.flowId).state === "succeeded",
      "success",
    );
    assert.equal(manager.get(flow.flowId).account?.id, "acct-1");
    assert.deepEqual(done, ["answered", "succeeded"]);
  });

  it("allows one sign-in per account at a time, and a failure carries the login's message", async () => {
    const manager = idle();
    const first = await manager.startAccount(
      target,
      async (interaction) => {
        await new Promise((_, reject) =>
          interaction.signal.addEventListener("abort", () =>
            reject(new Error("stop")),
          ),
        );
      },
      async () => {},
    );
    await assert.rejects(
      manager.startAccount(
        target,
        async () => {},
        async () => {},
      ),
      /already active/,
    );
    // Another account is independent.
    await manager.startAccount(
      { ...target, id: "acct-2" },
      async () => {},
      async () => {},
    );
    await manager.cancel(first.flowId);
    assert.equal(manager.get(first.flowId).state, "cancelled");
    const failing = await manager.startAccount(
      target,
      async () => {
        throw new Error("The sign-in code expired.");
      },
      async () => {},
    );
    await waitFor(
      () => manager.get(failing.flowId).state === "failed",
      "failure",
    );
    const info = manager.get(failing.flowId);
    assert.equal(
      info.state === "failed" && info.failure.detail,
      "The sign-in code expired.",
    );
  });

  it("closes its loopback listener when cancelled and ends a flow that outlives its timeout", async () => {
    const manager = idle();
    let redirectUri = "";
    const flow = await manager.startAccount(
      target,
      async (interaction) => {
        const listener = await interaction.listenLoopback();
        redirectUri = `${listener.redirectUri}?state=${listener.state}`;
        await listener.code;
      },
      async () => {},
    );
    await waitFor(() => redirectUri !== "", "listener");
    assert.equal(
      (await fetch(`${redirectUri}&code=x`).catch(() => undefined))?.status,
      200,
    );
    await waitFor(() => manager.get(flow.flowId).state !== "active", "ended");

    let closedUri = "";
    const second = await manager.startAccount(
      { ...target, id: "acct-3" },
      async (interaction) => {
        closedUri = (await interaction.listenLoopback()).redirectUri;
        await new Promise(() => {});
      },
      async () => {},
    );
    await waitFor(() => closedUri !== "", "second listener");
    await manager.cancel(second.flowId);
    assert.equal(
      await fetch(`${closedUri}?state=s&code=x`).then(
        () => true,
        () => false,
      ),
      false,
    );

    const slow = await manager.startAccount(
      { ...target, id: "acct-4" },
      async (interaction) => {
        await new Promise((_, reject) =>
          interaction.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        );
      },
      async () => {},
      { timeoutMs: 20 },
    );
    await waitFor(() => manager.get(slow.flowId).state === "failed", "timeout");
  });
});
