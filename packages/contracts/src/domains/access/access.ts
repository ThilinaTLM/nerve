import { z } from "zod";

/** Absolute device lifetime from pairing; never extended. */
export const DEVICE_ABSOLUTE_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
/** A device unused for this long must re-pair. */
export const DEVICE_IDLE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** Browser session cookie; the `__Host-` variant is used when served over HTTPS. */
export const SESSION_COOKIE_NAME = "nerve_session";
export const SECURE_SESSION_COOKIE_NAME = "__Host-nerve_session";
/** Local (tier 1) cookie installed by the desktop shell from `secrets/daemon-token`. */
export const LOCAL_TOKEN_COOKIE_NAME = "nerve_token";
/** Response header carrying a rotated credential to bearer clients. */
export const CREDENTIAL_ROTATION_HEADER = "x-nerve-credential";

export const deviceKindSchema = z.enum(["browser", "mobile", "desktop", "cli"]);
export type DeviceKind = z.infer<typeof deviceKindSchema>;

export const deviceMethodSchema = z.enum([
  "pairing",
  "passkey",
  "legacy-token",
]);
export type DeviceMethod = z.infer<typeof deviceMethodSchema>;

export const deviceSchema = z.object({
  id: z.string(), // "dev_<16 hex>", public, not secret
  name: z.string().min(1).max(80),
  kind: deviceKindSchema,
  createdAt: z.number(),
  lastSeenAt: z.number(),
  lastSeenIp: z.string().optional(),
  userAgent: z.string().max(200).optional(),
  method: deviceMethodSchema,
  /** Absolute cap: `createdAt` + 180 days. */
  expiresAt: z.number(),
});
export type Device = z.infer<typeof deviceSchema>;

/** Device as listed to the owner. */
export const deviceViewSchema = deviceSchema.extend({
  /** `expired` devices are kept until dismissed (DELETE). */
  status: z.enum(["active", "expired"]),
  /** `lastSeenAt` + 30 days; whichever of this and `expiresAt` is first ends the device. */
  idleExpiresAt: z.number(),
  /** True for the device that made this request. */
  current: z.boolean(),
});
export type DeviceView = z.infer<typeof deviceViewSchema>;

/** How a bearer-capable client wants to receive the credential. */
export const credentialDeliverySchema = z.enum(["cookie", "bearer"]);
export type CredentialDelivery = z.infer<typeof credentialDeliverySchema>;

// ---- Pairing -------------------------------------------------------------

export const pairingPurposeSchema = z.enum(["mobile", "browser", "desktop"]);
export type PairingPurpose = z.infer<typeof pairingPurposeSchema>;

export const pairingCodeCreateRequestSchema = z.object({
  purpose: pairingPurposeSchema,
  ttlSeconds: z.number().int().min(30).max(300).default(120),
});
export type PairingCodeCreateRequest = z.input<
  typeof pairingCodeCreateRequestSchema
>;

export const pairingCodeSchema = z.object({
  /** 8 chars Crockford base32, displayed `XXXX-XXXX`. */
  code: z.string(),
  expiresAt: z.number(),
  purpose: z.union([pairingPurposeSchema, z.literal("setup")]),
  /** `<publicUrl>/#pair=<code>`; only present when `network.publicUrl` is set. */
  url: z.string().optional(),
});
export type PairingCode = z.infer<typeof pairingCodeSchema>;

export const pairRedeemRequestSchema = z.object({
  code: z.string().min(1).max(32),
  deviceName: z.string().min(1).max(80),
  kind: deviceKindSchema,
  /** Browsers use `cookie` (default): the secret is never visible to JS. */
  delivery: credentialDeliverySchema.default("cookie"),
});
export type PairRedeemRequest = z.input<typeof pairRedeemRequestSchema>;

/** `credential` (`nd_<deviceId>.<secret>`) only when `delivery` is `bearer`. */
export const deviceGrantSchema = z.object({
  device: deviceSchema,
  credential: z.string().optional(),
});
export type DeviceGrant = z.infer<typeof deviceGrantSchema>;

// ---- Session -------------------------------------------------------------

export const accessPrincipalKindSchema = z.enum(["local", "device", "none"]);
export type AccessPrincipalKind = z.infer<typeof accessPrincipalKindSchema>;

export const accessSessionSchema = z.object({
  authenticated: z.boolean(),
  principal: accessPrincipalKindSchema,
  /** Present when `principal` is `device`. */
  device: deviceSchema.optional(),
  /** TLS, loopback, or a trusted proxy reporting https. */
  secureTransport: z.boolean(),
  /** Pairing/login can be completed from this connection. */
  pairingAvailable: z.boolean(),
  /** Why pairing is unavailable here, when it is. */
  pairingBlockedReason: z.enum(["plaintext_transport"]).optional(),
  passkey: z.object({
    /** `network.publicUrl` is set: passkey login gates the server. */
    required: z.boolean(),
    enrolled: z.boolean(),
    /** Owner can sign in with a passkey here. */
    loginAvailable: z.boolean(),
    /** A setup code can be redeemed here to enroll the first passkey. */
    enrollmentOpen: z.boolean(),
  }),
  publicUrl: z.string().optional(),
  /** A non-loopback peer used the daemon token as bearer (accepted for one release). */
  legacyBearerSeen: z.boolean(),
});
export type AccessSession = z.infer<typeof accessSessionSchema>;

export const logoutResponseSchema = z.object({ ok: z.literal(true) });

// ---- Devices -------------------------------------------------------------

export const listDevicesResponseSchema = z.object({
  devices: z.array(deviceViewSchema),
  legacyBearerSeen: z.boolean(),
});
export type ListDevicesResponse = z.infer<typeof listDevicesResponseSchema>;

export const renameDeviceRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type RenameDeviceRequest = z.infer<typeof renameDeviceRequestSchema>;

export const revokeAllDevicesRequestSchema = z.object({
  /** Keep the calling device signed in. Default true. */
  keepCurrent: z.boolean().default(true),
});
export type RevokeAllDevicesRequest = z.input<
  typeof revokeAllDevicesRequestSchema
>;
export const revokeAllDevicesResponseSchema = z.object({
  revoked: z.number().int(),
});

export const rotateLocalTokenResponseSchema = z.object({
  rotatedAt: z.number(),
});

// ---- Passkeys ------------------------------------------------------------

/** WebAuthn JSON payloads are opaque to the contract (validated by the server library). */
export const webAuthnJsonSchema = z.record(z.string(), z.unknown());

export const passkeySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number().optional(),
});
export type Passkey = z.infer<typeof passkeySchema>;

export const passkeyOptionsResponseSchema = z.object({
  options: webAuthnJsonSchema,
});

export const passkeyLoginVerifyRequestSchema = z.object({
  response: webAuthnJsonSchema,
  deviceName: z.string().min(1).max(80),
  kind: deviceKindSchema,
  delivery: credentialDeliverySchema.default("cookie"),
});
export type PasskeyLoginVerifyRequest = z.input<
  typeof passkeyLoginVerifyRequestSchema
>;

/**
 * Registration is authorised either by a setup code (first enrollment, no
 * session yet) or by an existing session (adding another passkey).
 */
export const passkeyRegisterOptionsRequestSchema = z.object({
  setupCode: z.string().min(1).max(32).optional(),
});
export type PasskeyRegisterOptionsRequest = z.infer<
  typeof passkeyRegisterOptionsRequestSchema
>;

export const passkeyRegisterVerifyRequestSchema = z.object({
  setupCode: z.string().min(1).max(32).optional(),
  response: webAuthnJsonSchema,
  passkeyName: z.string().trim().min(1).max(80),
  /** Used when a setup code is redeemed: the enrolling browser becomes a device. */
  deviceName: z.string().min(1).max(80).optional(),
  kind: deviceKindSchema.default("browser"),
  delivery: credentialDeliverySchema.default("cookie"),
});
export type PasskeyRegisterVerifyRequest = z.input<
  typeof passkeyRegisterVerifyRequestSchema
>;
export const passkeyRegisterVerifyResponseSchema = z.object({
  passkey: passkeySchema,
  /** Present when a setup code was redeemed (the browser is signed in). */
  grant: deviceGrantSchema.optional(),
});
export type PasskeyRegisterVerifyResponse = z.infer<
  typeof passkeyRegisterVerifyResponseSchema
>;

export const listPasskeysResponseSchema = z.object({
  passkeys: z.array(passkeySchema),
});

// ---- Audit ---------------------------------------------------------------

export const accessAuditEventTypeSchema = z.enum([
  "pair",
  "login",
  "failed",
  "revoked",
  "rotated",
  "passkey_registered",
  "passkey_removed",
  "reset",
  "local_token_rotated",
  "legacy_bearer",
]);
export type AccessAuditEventType = z.infer<typeof accessAuditEventTypeSchema>;

/** Never contains secrets. */
export const accessAuditEventSchema = z.object({
  at: z.number(),
  type: accessAuditEventTypeSchema,
  deviceId: z.string().optional(),
  deviceName: z.string().optional(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
  detail: z.string().optional(),
});
export type AccessAuditEvent = z.infer<typeof accessAuditEventSchema>;

export const listAuditEventsResponseSchema = z.object({
  events: z.array(accessAuditEventSchema),
});

// ---- Errors --------------------------------------------------------------

/** `error.code` values returned by `/api/access/*` and the auth gate. */
export const accessErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "MISDIRECTED_REQUEST",
  "TLS_REQUIRED",
  "RATE_LIMITED",
  "PAIRING_CODE_INVALID",
  "PASSKEY_ENROLLMENT_REQUIRED",
  "PASSKEY_NOT_ENROLLED",
  "PASSKEY_VERIFICATION_FAILED",
  "PASSKEY_LAST_REMAINING",
  "PUBLIC_URL_REQUIRED",
  "LOCAL_ONLY",
  "DEVICE_NOT_FOUND",
]);
export type AccessErrorCode = z.infer<typeof accessErrorCodeSchema>;
