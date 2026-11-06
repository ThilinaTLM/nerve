import assert from "node:assert/strict";
import test from "node:test";
import {
  auditEventLabel,
  auditEventTone,
  formatLastSeen,
} from "./device-format";
import { defaultPairingLink, pairingLinks } from "./pairing-url";
import { buildQrMatrix } from "./qr-matrix";

test("formats last-seen ages", () => {
  const now = 1_000_000_000;
  assert.equal(formatLastSeen(now - 5_000, now), "just now");
  assert.equal(formatLastSeen(now - 5 * 60_000, now), "5 min ago");
  assert.equal(formatLastSeen(now - 3 * 3_600_000, now), "3 h ago");
  assert.equal(formatLastSeen(now - 2 * 86_400_000, now), "2 d ago");
});

test("labels audit events and flags failures", () => {
  const failed = { at: 1, type: "failed" as const, deviceName: "Pixel" };
  assert.equal(auditEventLabel(failed), "Failed attempt: Pixel");
  assert.equal(auditEventTone(failed), "warning");
  assert.equal(auditEventTone({ at: 1, type: "pair" }), "neutral");
});

test("pairing links fall back to this page's origin", () => {
  assert.deepEqual(
    pairingLinks(
      { code: "ABCD-EFGH", expiresAt: 1, purpose: "mobile", links: [] },
      "https://nerve.test",
    ).map((link) => link.url),
    ["https://nerve.test/#pair=ABCD-EFGH"],
  );
});

test("picks the remembered network, then the current one, then the best", () => {
  const links = [
    {
      kind: "lan",
      label: "Local network",
      url: "https://192.168.1.2:3748/#pair=X",
    },
    {
      kind: "tailscale",
      label: "Tailscale",
      url: "https://100.64.0.2:3748/#pair=X",
    },
  ] as const;
  const pick = (remembered: string | undefined, origin: string) =>
    defaultPairingLink(links, { remembered, origin })?.label;
  assert.equal(pick("Tailscale", "http://127.0.0.1:3747"), "Tailscale");
  assert.equal(pick("Gone", "https://100.64.0.2:3748"), "Tailscale");
  assert.equal(pick(undefined, "http://127.0.0.1:3747"), "Local network");
});

test("encodes a QR matrix", () => {
  const matrix = buildQrMatrix("https://nerve.test/#pair=ABCD-EFGH");
  assert.ok(matrix.size >= 21);
  assert.match(matrix.path, /^M\d+ \d+h\d+v1h-\d+z/);
});
