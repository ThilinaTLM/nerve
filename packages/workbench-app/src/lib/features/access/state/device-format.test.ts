import assert from "node:assert/strict";
import test from "node:test";
import {
  auditEventLabel,
  auditEventTone,
  formatLastSeen,
} from "./device-format";
import { pairingUrl } from "./pairing-url";
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

test("pairing urls keep the code in the fragment", () => {
  assert.equal(
    pairingUrl(
      { code: "ABCD-EFGH", expiresAt: 1, purpose: "mobile" },
      "https://nerve.test",
    ),
    "https://nerve.test/#pair=ABCD-EFGH",
  );
  assert.equal(
    pairingUrl(
      {
        code: "ABCD-EFGH",
        expiresAt: 1,
        purpose: "mobile",
        url: "https://pub/#pair=ABCD-EFGH",
      },
      "http://localhost",
    ),
    "https://pub/#pair=ABCD-EFGH",
  );
});

test("encodes a QR matrix", () => {
  const matrix = buildQrMatrix("https://nerve.test/#pair=ABCD-EFGH");
  assert.ok(matrix.size >= 21);
  assert.match(matrix.path, /^M\d+ \d+h\d+v1h-\d+z/);
});
