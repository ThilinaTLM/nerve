import assert from "node:assert/strict";
import test from "node:test";
import type { AccessSession } from "@nervekit/contracts/access";
import { canFallBackToPairing, resolveAccessScreen } from "./access-routing";

function session(overrides: Partial<AccessSession> = {}): AccessSession {
  return {
    authenticated: false,
    principal: "none",
    secureTransport: true,
    pairingAvailable: true,
    passkey: {
      required: false,
      enrolled: false,
      loginAvailable: false,
      enrollmentOpen: false,
    },
    legacyBearerSeen: false,
    ...overrides,
  };
}

const passkey = (patch: Partial<AccessSession["passkey"]>) => ({
  required: true,
  enrolled: false,
  loginAvailable: false,
  enrollmentOpen: false,
  ...patch,
});

test("authenticated sessions open the app", () => {
  assert.equal(
    resolveAccessScreen(session({ authenticated: true, principal: "device" })),
    "app",
  );
});

test("unauthenticated visitors pair by default", () => {
  assert.equal(resolveAccessScreen(session()), "pair");
});

test("passkey login wins over pairing, a fragment code wins over login", () => {
  const s = session({
    passkey: passkey({ enrolled: true, loginAvailable: true }),
  });
  assert.equal(resolveAccessScreen(s), "passkey-login");
  assert.equal(
    resolveAccessScreen(s, { pendingPairCode: "ABCD-EFGH" }),
    "pair",
  );
});

test("first passkey enrollment takes over while it is open", () => {
  const s = session({ passkey: passkey({ enrollmentOpen: true }) });
  assert.equal(
    resolveAccessScreen(s, { pendingPairCode: "ABCD-EFGH" }),
    "passkey-enroll",
  );
});

test("plaintext transport blocks everything", () => {
  const s = session({
    pairingAvailable: false,
    pairingBlockedReason: "plaintext_transport",
  });
  assert.equal(resolveAccessScreen(s), "blocked");
  assert.equal(canFallBackToPairing(s), false);
});
