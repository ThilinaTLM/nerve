import assert from "node:assert/strict";
import test from "node:test";
import { derivePushStatus, type PushEnvironment } from "./push-status";

const env: PushEnvironment = {
  apis: true,
  ios: false,
  standalone: false,
  permission: "default",
  subscribed: false,
};

test("derivePushStatus", () => {
  assert.equal(derivePushStatus(env), "off");
  assert.equal(
    derivePushStatus({ ...env, permission: "granted", subscribed: true }),
    "on",
  );
  assert.equal(
    derivePushStatus({ ...env, permission: "granted", subscribed: false }),
    "off",
  );
  // A revoked permission wins over a stale server subscription.
  assert.equal(
    derivePushStatus({ ...env, permission: "denied", subscribed: true }),
    "blocked",
  );
  assert.equal(derivePushStatus({ ...env, apis: false }), "unsupported");
});

test("iOS needs the Home Screen app before anything else", () => {
  assert.equal(
    derivePushStatus({ ...env, ios: true, apis: false }),
    "needs-install",
  );
  assert.equal(
    derivePushStatus({ ...env, ios: true, standalone: true }),
    "off",
  );
});
