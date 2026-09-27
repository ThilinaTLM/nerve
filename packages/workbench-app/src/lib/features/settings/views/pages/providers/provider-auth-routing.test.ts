import assert from "node:assert/strict";
import test from "node:test";
import type { AuthProviderMetadata } from "$lib/api";
import {
  deviceCodeSecondsRemaining,
  isProviderAvailableForDialog,
  routeProviderAuth,
  supportsDialogKind,
} from "./provider-auth-routing";

function provider(
  supportsApiKey: boolean,
  supportsOAuth: boolean,
): AuthProviderMetadata {
  return {
    provider: "example",
    displayName: "Example",
    configured: false,
    supportsApiKey,
    supportsOAuth,
  };
}

test("dual-capability providers remain available in API-key dialogs", () => {
  const dual = provider(true, true);
  assert.equal(supportsDialogKind(dual, "api_key"), true);
  assert.equal(routeProviderAuth(dual, "api_key"), "api-key");
  assert.equal(routeProviderAuth(dual, "oauth"), "oauth");
});

test("opposite credential types can be intentionally replaced", () => {
  const withOAuth = {
    ...provider(true, true),
    configured: true,
    credentialType: "oauth" as const,
  };
  const withApiKey = {
    ...provider(true, true),
    configured: true,
    credentialType: "api_key" as const,
  };
  assert.equal(isProviderAvailableForDialog(withOAuth, "api_key"), true);
  assert.equal(isProviderAvailableForDialog(withOAuth, "oauth"), false);
  assert.equal(isProviderAvailableForDialog(withApiKey, "oauth"), true);
  assert.equal(isProviderAvailableForDialog(withApiKey, "api_key"), false);
  assert.equal(isProviderAvailableForDialog(withApiKey, "all"), false);
});

test("all-provider dialogs ask for a method only when both are supported", () => {
  assert.equal(routeProviderAuth(provider(true, true), "all"), "method");
  assert.equal(routeProviderAuth(provider(true, false), "all"), "api-key");
  assert.equal(routeProviderAuth(provider(false, true), "all"), "oauth");
});

test("device-code countdown rounds up and never becomes negative", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(deviceCodeSecondsRemaining("2026-01-01T00:00:01.001Z", now), 2);
  assert.equal(deviceCodeSecondsRemaining("2025-12-31T23:59:00.000Z", now), 0);
  assert.equal(deviceCodeSecondsRemaining(undefined, now), undefined);
});
