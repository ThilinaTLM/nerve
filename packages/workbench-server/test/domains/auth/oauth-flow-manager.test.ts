import assert from "node:assert/strict";
import { createServer } from "node:http";
import type {
  AuthInteraction,
  OAuthCredentials,
  Provider,
} from "@earendil-works/pi-ai";
import { describe, it } from "node:test";
import { OAuthFlowManager } from "../../../src/domains/auth/oauth-flow-manager.js";

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
  const manager = new OAuthFlowManager(
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

async function waitFor(
  predicate: () => boolean,
  message = "condition",
): Promise<void> {
  const timeout = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > timeout)
      throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("OAuthFlowManager", () => {
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
