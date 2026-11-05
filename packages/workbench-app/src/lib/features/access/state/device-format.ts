import type {
  AccessAuditEvent,
  DeviceKind,
  DeviceMethod,
} from "@nervekit/contracts/access";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatLastSeen(at: number, now = Date.now()): string {
  const age = now - at;
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`;
  if (age < 60 * DAY) return `${Math.floor(age / DAY)} d ago`;
  return new Date(at).toLocaleDateString();
}

const METHOD_LABELS: Record<DeviceMethod, string> = {
  pairing: "Pairing code",
  passkey: "Passkey",
  "legacy-token": "Legacy link",
};

export function methodLabel(method: DeviceMethod): string {
  return METHOD_LABELS[method];
}

const KIND_LABELS: Record<DeviceKind, string> = {
  browser: "Browser",
  mobile: "Phone",
  desktop: "Desktop",
  cli: "CLI",
};

export function kindLabel(kind: DeviceKind): string {
  return KIND_LABELS[kind];
}

const AUDIT_LABELS: Record<AccessAuditEvent["type"], string> = {
  pair: "Device paired",
  login: "Passkey sign-in",
  failed: "Failed attempt",
  revoked: "Device revoked",
  rotated: "Credential rotated",
  passkey_registered: "Passkey added",
  passkey_removed: "Passkey removed",
  reset: "Access reset",
  local_token_rotated: "Local token rotated",
  legacy_bearer: "Legacy token used remotely",
};

export function auditEventLabel(event: AccessAuditEvent): string {
  const label = AUDIT_LABELS[event.type];
  return event.deviceName ? `${label}: ${event.deviceName}` : label;
}

/** Failed attempts and legacy-token use deserve attention in the log. */
export function auditEventTone(event: AccessAuditEvent): "neutral" | "warning" {
  return event.type === "failed" || event.type === "legacy_bearer"
    ? "warning"
    : "neutral";
}

/** Toast text for an `access.device_paired` event. */
export function devicePairedMessage(deviceName: string): string {
  return `Device paired: ${deviceName}`;
}
