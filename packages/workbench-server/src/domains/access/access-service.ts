import type {
  AccessSession,
  Device,
  DeviceGrant,
  DeviceKind,
  DeviceMethod,
  DeviceView,
  PairingCode,
  PairingLink,
  Passkey,
  PairingPurpose,
} from "@nervekit/contracts/access";
import {
  DEFAULT_TRUST_PROXY_PEERS,
  type ApplicationConfigurationSnapshot,
} from "@nervekit/contracts/settings";
import { tokensEqual } from "../../adapters/http/token-compare.js";
import {
  rotateLocalToken,
  type StoragePaths,
} from "../../infrastructure/storage-bootstrap/index.js";
import { AccessAuditLog } from "./audit-log.js";
import { sessionCookie } from "./access-cookies.js";
import { AccessError } from "./access-error.js";
import { AccessGate, type ClientInfo, type Principal } from "./access-gate.js";
import { PeerMatcher } from "../../infrastructure/network/client-address.js";
import { DeviceSockets } from "./device-sockets.js";
import { DeviceStore } from "./device-store.js";
import { FailureLimiter } from "./failure-limiter.js";
import type { ShareOrigin } from "../../infrastructure/network/share-origins.js";
import {
  type IssuedPairingCode,
  normalizePairingCode,
  PairingCodes,
} from "./pairing-codes.js";
import { PasskeyService, toPasskey } from "./passkey-service.js";

export interface AccessSettings {
  /** `network.publicUrl`: enables the passkey gate and trusted-proxy handling. */
  publicUrl?: string;
  /** `network.trustProxy.peers`: addresses or CIDR ranges. */
  trustProxyPeers?: readonly string[];
}

/** Late-bound hooks so the service can exist before the notice publisher does. */
export interface AccessNotifier {
  devicePaired(device: Device): void;
  deviceRevoked(deviceId: string, reason: "revoked" | "logout" | "all"): void;
  passkeysChanged(count: number): void;
}

const noopNotifier: AccessNotifier = {
  devicePaired: () => undefined,
  deviceRevoked: () => undefined,
  passkeysChanged: () => undefined,
};

/** Access settings from a resolved application configuration snapshot. */
export function accessSettingsFromSnapshot(
  snapshot: ApplicationConfigurationSnapshot,
): AccessSettings {
  const { publicUrl, trustProxyPeers } = snapshot.application.network;
  return {
    publicUrl: publicUrl.activeValue || undefined,
    trustProxyPeers: trustProxyPeers.activeValue,
  };
}

export interface AccessServiceOptions {
  paths: Pick<StoragePaths, "home" | "devicesPath" | "accessAuditPath">;
  localToken: string;
  settings?: AccessSettings;
  now?: () => number;
  logger?: { warn(message: string): void };
}

export interface IssuedGrant {
  grant: DeviceGrant;
  /** `Set-Cookie` value for cookie delivery. */
  cookie?: string;
}

interface RequestMeta {
  client: ClientInfo;
  userAgent?: string;
}

/**
 * Remote-access domain facade: devices, pairing codes, passkeys, audit and
 * the local token. Route handlers and the CLI go through here; the
 * `AccessGate` shares its store, throttle and configuration.
 */
export class AccessService {
  readonly store: DeviceStore;
  readonly pairing: PairingCodes;
  readonly audit: AccessAuditLog;
  readonly sockets = new DeviceSockets();
  readonly gate: AccessGate;
  readonly passkeys: PasskeyService;
  notifier: AccessNotifier = noopNotifier;
  /** Late-bound so the service can exist before the logger does. */
  logger: { warn(message: string): void } | undefined;
  /** Called after `secrets/daemon-token` was replaced. */
  onLocalTokenRotated: ((token: string) => void) | undefined;
  /** Late-bound: per-network HTTPS origins, known once mobile HTTPS is up. */
  shareOrigins: () => readonly ShareOrigin[] = () => [];

  readonly #now: () => number;
  readonly #loginLimiter: FailureLimiter;
  readonly #legacyWarned = new Set<string>();
  #localToken: string;
  #publicUrl: URL | undefined;
  #trustedPeers: PeerMatcher;
  #legacyBearerSeen = false;

  constructor(private readonly options: AccessServiceOptions) {
    this.logger = options.logger;
    this.#now = options.now ?? Date.now;
    this.#localToken = options.localToken;
    this.#publicUrl = parsePublicUrl(options.settings?.publicUrl);
    this.#trustedPeers = new PeerMatcher(
      options.settings?.trustProxyPeers ?? DEFAULT_TRUST_PROXY_PEERS,
    );
    this.store = new DeviceStore(options.paths.devicesPath, { now: this.#now });
    this.pairing = new PairingCodes({ now: this.#now });
    this.audit = new AccessAuditLog(options.paths.accessAuditPath, {
      now: this.#now,
    });
    this.#loginLimiter = new FailureLimiter({
      perKey: 10,
      global: 30,
      windowMs: 10 * 60_000,
      now: this.#now,
    });
    this.passkeys = new PasskeyService(
      this.store,
      () => this.#publicUrl,
      this.#now,
    );
    this.gate = new AccessGate({
      store: this.store,
      localToken: () => this.#localToken,
      config: () => ({
        publicUrl: this.#publicUrl,
        trustedPeers: this.#trustedPeers,
      }),
      limiter: new FailureLimiter({
        perKey: 20,
        global: 100,
        windowMs: 10 * 60_000,
        now: this.#now,
      }),
      enrollmentGateClosed: () => this.enrollmentGateClosed(),
      onFailure: (client, reason, request) => {
        void this.audit.record({
          type: "failed",
          ip: client.ip,
          userAgent: request.headers.get("user-agent") ?? undefined,
          detail: reason,
        });
      },
      onLegacyBearer: (client, request) =>
        this.#noteLegacyBearer(client, request),
    });
  }

  get publicUrl(): URL | undefined {
    return this.#publicUrl;
  }

  get localToken(): string {
    return this.#localToken;
  }

  get legacyBearerSeen(): boolean {
    return this.#legacyBearerSeen;
  }

  /** Hosts the Host allowlist must accept in addition to loopback and bound addresses. */
  get publicHost(): string | undefined {
    return this.#publicUrl?.host;
  }

  async enrollmentGateClosed(): Promise<boolean> {
    return (
      this.#publicUrl !== undefined &&
      (await this.store.passkeys()).length === 0
    );
  }

  #noteLegacyBearer(client: ClientInfo, request: { headers: Headers }): void {
    this.#legacyBearerSeen = true;
    if (this.#legacyWarned.has(client.ip)) return;
    this.#legacyWarned.add(client.ip);
    this.logger?.warn(
      `Accepted the daemon token as a bearer credential from ${client.ip}. This is deprecated and will be removed: pair that client to get its own device credential.`,
    );
    void this.audit.record({
      type: "legacy_bearer",
      ip: client.ip,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
  }

  // ---- session -----------------------------------------------------------

  async session(
    principal: Principal | undefined,
    client: ClientInfo,
  ): Promise<AccessSession> {
    const enrolled = (await this.store.passkeys()).length > 0;
    const required = this.#publicUrl !== undefined;
    const device =
      principal?.kind === "device"
        ? await this.store.get(principal.deviceId)
        : undefined;
    return {
      authenticated: principal !== undefined,
      principal: principal?.kind ?? "none",
      device,
      secureTransport: client.secure || client.transportOk,
      pairingAvailable: client.transportOk,
      pairingBlockedReason: client.transportOk
        ? undefined
        : "plaintext_transport",
      passkey: {
        required,
        enrolled,
        loginAvailable: required && enrolled,
        enrollmentOpen: required && !enrolled,
      },
      publicUrl: this.#publicUrl?.origin,
      legacyBearerSeen: this.#legacyBearerSeen,
    };
  }

  // ---- grants ------------------------------------------------------------

  async #issue(
    input: {
      name: string;
      kind: DeviceKind;
      method: DeviceMethod;
      delivery: "cookie" | "bearer";
    },
    meta: RequestMeta,
  ): Promise<IssuedGrant> {
    const { device, credential } = await this.store.create({
      name: input.name,
      kind: input.kind,
      method: input.method,
      ip: meta.client.ip,
      userAgent: meta.userAgent,
    });
    this.notifier.devicePaired(device);
    await this.audit.record({
      type: input.method === "passkey" ? "login" : "pair",
      deviceId: device.id,
      deviceName: device.name,
      ip: meta.client.ip,
      userAgent: meta.userAgent,
      detail: input.method,
    });
    return input.delivery === "bearer"
      ? { grant: { device, credential } }
      : {
          grant: { device },
          cookie: sessionCookie({
            credential,
            expiresAt: device.expiresAt,
            secure: meta.client.secure,
          }),
        };
  }

  #requireTransport(client: ClientInfo): void {
    if (!client.transportOk) {
      throw new AccessError(
        403,
        "TLS_REQUIRED",
        "Pairing and sign-in are only available over HTTPS (or on this machine). Enable mobile HTTPS or use a TLS reverse proxy.",
      );
    }
  }

  // ---- pairing -----------------------------------------------------------

  async createPairingCode(
    purpose: PairingPurpose,
    ttlSeconds: number,
  ): Promise<PairingCode> {
    if (await this.enrollmentGateClosed()) {
      throw new AccessError(
        409,
        "PASSKEY_ENROLLMENT_REQUIRED",
        "Enroll an owner passkey before pairing other devices.",
      );
    }
    return this.#withLinks(this.pairing.create(purpose, ttlSeconds));
  }

  /** One-time passkey enrollment code (10 minutes). Local principals only. */
  createSetupCode(): PairingCode {
    return this.#withLinks(this.pairing.create("setup", 600));
  }

  #withLinks(code: IssuedPairingCode): PairingCode {
    const fragment = `/#pair=${code.code}`;
    const links: PairingLink[] = this.#publicUrl
      ? [
          {
            kind: "public",
            label: "Public URL",
            url: `${this.#publicUrl.origin}${fragment}`,
          },
        ]
      : [];
    for (const share of this.shareOrigins()) {
      if (share.origin === this.#publicUrl?.origin) continue;
      links.push({
        kind: share.kind,
        label: share.label,
        url: `${share.origin}${fragment}`,
        setupUrl: `${share.setupOrigin}/mobile-setup#pair=${code.code}`,
      });
    }
    return { ...code, links };
  }

  async redeemPairing(
    input: {
      code: string;
      deviceName: string;
      kind: DeviceKind;
      delivery: "cookie" | "bearer";
    },
    meta: RequestMeta,
  ): Promise<IssuedGrant> {
    this.#requireTransport(meta.client);
    if (await this.enrollmentGateClosed()) {
      throw new AccessError(
        403,
        "PASSKEY_ENROLLMENT_REQUIRED",
        "This server requires owner passkey enrollment first.",
      );
    }
    const result = this.pairing.redeem(input.code, meta.client.ip, "pairing");
    if (!result.ok) {
      await this.#failed(meta, `pairing:${result.reason}`);
      throw result.reason === "rate_limited"
        ? new AccessError(
            429,
            "RATE_LIMITED",
            "Too many failed attempts. Try again later.",
            result.retryAfterSeconds,
          )
        : new AccessError(
            400,
            "PAIRING_CODE_INVALID",
            "This pairing code is invalid, expired or already used.",
          );
    }
    return this.#issue(
      { ...input, name: input.deviceName, method: "pairing" },
      meta,
    );
  }

  async #failed(meta: RequestMeta, detail: string): Promise<void> {
    await this.audit.record({
      type: "failed",
      ip: meta.client.ip,
      userAgent: meta.userAgent,
      detail,
    });
  }

  // ---- passkeys ----------------------------------------------------------

  async #checkLoginThrottle(meta: RequestMeta): Promise<void> {
    const decision = this.#loginLimiter.check(meta.client.ip);
    if (!decision.allowed) {
      throw new AccessError(
        429,
        "RATE_LIMITED",
        "Too many failed attempts. Try again later.",
        decision.retryAfterSeconds,
      );
    }
  }

  async loginOptions(meta: RequestMeta): Promise<Record<string, unknown>> {
    this.#requireTransport(meta.client);
    await this.#checkLoginThrottle(meta);
    return this.passkeys.loginOptions();
  }

  async loginVerify(
    input: {
      response: Record<string, unknown>;
      deviceName: string;
      kind: DeviceKind;
      delivery: "cookie" | "bearer";
    },
    meta: RequestMeta,
  ): Promise<IssuedGrant> {
    this.#requireTransport(meta.client);
    await this.#checkLoginThrottle(meta);
    try {
      await this.passkeys.verifyLogin(input.response);
    } catch (error) {
      this.#loginLimiter.recordFailure(meta.client.ip);
      await this.#failed(meta, "passkey_login");
      throw error;
    }
    this.#loginLimiter.recordSuccess(meta.client.ip);
    return this.#issue(
      { ...input, name: input.deviceName, method: "passkey" },
      meta,
    );
  }

  /** Registration is allowed for a signed-in owner or with a valid setup code. */
  async registerOptions(
    input: { setupCode?: string },
    principal: Principal | undefined,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    this.#requireTransport(meta.client);
    await this.#authorizeRegistration(input.setupCode, principal, meta);
    return this.passkeys.registrationOptions(
      principal ? undefined : normalizeBinding(input.setupCode),
    );
  }

  async registerVerify(
    input: {
      setupCode?: string;
      response: Record<string, unknown>;
      passkeyName: string;
      deviceName?: string;
      kind: DeviceKind;
      delivery: "cookie" | "bearer";
    },
    principal: Principal | undefined,
    meta: RequestMeta,
  ): Promise<{ passkey: Passkey; issued?: IssuedGrant }> {
    this.#requireTransport(meta.client);
    await this.#authorizeRegistration(input.setupCode, principal, meta);
    let record;
    try {
      record = await this.passkeys.verifyRegistration(
        input.response,
        input.passkeyName,
        principal ? undefined : normalizeBinding(input.setupCode),
      );
    } catch (error) {
      await this.#failed(meta, "passkey_registration");
      throw error;
    }
    await this.audit.record({
      type: "passkey_registered",
      ip: meta.client.ip,
      userAgent: meta.userAgent,
      detail: record.name,
    });
    this.notifier.passkeysChanged((await this.store.passkeys()).length);
    if (principal) return { passkey: toPasskey(record) };
    // Setup code: consume now and sign the enrolling browser in.
    this.pairing.consume(input.setupCode ?? "");
    const issued = await this.#issue(
      {
        name: input.deviceName ?? input.passkeyName,
        kind: input.kind,
        method: "passkey",
        delivery: input.delivery,
      },
      meta,
    );
    return { passkey: toPasskey(record), issued };
  }

  async #authorizeRegistration(
    setupCode: string | undefined,
    principal: Principal | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    if (principal) return;
    if (!setupCode) {
      throw new AccessError(
        403,
        "PASSKEY_ENROLLMENT_REQUIRED",
        "A setup code or a signed-in session is required to register a passkey.",
      );
    }
    const result = this.pairing.peek(setupCode, meta.client.ip, "setup");
    if (result.ok) return;
    await this.#failed(meta, `setup:${result.reason}`);
    throw result.reason === "rate_limited"
      ? new AccessError(
          429,
          "RATE_LIMITED",
          "Too many failed attempts. Try again later.",
          result.retryAfterSeconds,
        )
      : new AccessError(
          400,
          "PAIRING_CODE_INVALID",
          "This setup code is invalid, expired or already used.",
        );
  }

  async listPasskeys(): Promise<Passkey[]> {
    return (await this.store.passkeys()).map(toPasskey);
  }

  async removePasskey(id: string): Promise<void> {
    const all = await this.store.passkeys();
    if (this.#publicUrl && all.length === 1 && all[0]?.id === id) {
      throw new AccessError(
        409,
        "PASSKEY_LAST_REMAINING",
        "Register another passkey before removing the last one.",
      );
    }
    if (!(await this.store.removePasskey(id))) {
      throw new AccessError(404, "DEVICE_NOT_FOUND", "Passkey not found.");
    }
    await this.audit.record({ type: "passkey_removed", detail: id });
    this.notifier.passkeysChanged((await this.store.passkeys()).length);
  }

  // ---- devices -----------------------------------------------------------

  listDevices(currentDeviceId?: string): Promise<DeviceView[]> {
    return this.store.list(currentDeviceId);
  }

  async renameDevice(id: string, name: string): Promise<Device> {
    const device = await this.store.rename(id, name);
    if (!device) throw deviceNotFound();
    return device;
  }

  async revokeDevice(
    id: string,
    reason: "revoked" | "logout" = "revoked",
    meta?: RequestMeta,
  ): Promise<void> {
    const device = await this.store.revoke(id);
    if (!device) throw deviceNotFound();
    this.sockets.closeDevice(id);
    this.notifier.deviceRevoked(id, reason);
    await this.audit.record({
      type: "revoked",
      deviceId: id,
      deviceName: device.name,
      ip: meta?.client.ip,
      detail: reason,
    });
  }

  async revokeAll(keepDeviceId?: string, meta?: RequestMeta): Promise<number> {
    const removed = await this.store.revokeAll({
      exceptDeviceId: keepDeviceId,
    });
    this.sockets.closeAll(keepDeviceId);
    for (const device of removed) this.notifier.deviceRevoked(device.id, "all");
    await this.audit.record({
      type: "revoked",
      ip: meta?.client.ip,
      detail: `all (${removed.length})`,
    });
    return removed.length;
  }

  // ---- local token / owner reset ----------------------------------------

  async rotateLocalToken(meta?: RequestMeta): Promise<number> {
    const token = await rotateLocalToken(this.options.paths.home);
    this.#localToken = token;
    this.onLocalTokenRotated?.(token);
    this.sockets.closeLocal();
    this.#legacyBearerSeen = false;
    await this.audit.record({
      type: "local_token_rotated",
      ip: meta?.client.ip,
    });
    return this.#now();
  }

  /** Lost-passkey recovery: clear passkeys and return a fresh setup code. */
  async resetOwner(meta?: RequestMeta): Promise<PairingCode> {
    const removed = await this.store.clearPasskeys();
    this.pairing.clear();
    this.notifier.passkeysChanged(0);
    await this.audit.record({
      type: "reset",
      ip: meta?.client.ip,
      detail: `passkeys cleared: ${removed}`,
    });
    return this.createSetupCode();
  }

  // ---- legacy ?token= links ---------------------------------------------

  async redeemLegacyToken(
    token: string,
    meta: RequestMeta,
  ): Promise<
    | ({ ok: true } & IssuedGrant)
    | {
        ok: false;
        reason: "invalid" | "plaintext" | "blocked" | "rate_limited";
      }
  > {
    const decision = this.#loginLimiter.check(meta.client.ip);
    if (!decision.allowed) return { ok: false, reason: "rate_limited" };
    if (!tokensEqual(token, this.#localToken)) {
      this.#loginLimiter.recordFailure(meta.client.ip);
      await this.#failed(meta, "legacy_token");
      return { ok: false, reason: "invalid" };
    }
    if (!meta.client.transportOk) return { ok: false, reason: "plaintext" };
    if (!meta.client.localEligible && (await this.enrollmentGateClosed())) {
      return { ok: false, reason: "blocked" };
    }
    const issued = await this.#issue(
      {
        name: "Legacy link",
        kind: /mobile|android|iphone|ipad/i.test(meta.userAgent ?? "")
          ? "mobile"
          : "browser",
        method: "legacy-token",
        delivery: "cookie",
      },
      meta,
    );
    return { ok: true, ...issued };
  }

  // ---- startup -----------------------------------------------------------

  /**
   * First remote start: print a one-time code so the owner can get in. With
   * `publicUrl` it is a passkey setup code; otherwise a browser pairing code
   * while no device is paired yet.
   */
  async announceFirstRun(input: {
    remote: boolean;
  }): Promise<PairingCode | undefined> {
    if (!input.remote && !this.#publicUrl) return undefined;
    let code: PairingCode | undefined;
    if (this.#publicUrl) {
      if ((await this.store.passkeys()).length > 0) return undefined;
      code = this.createSetupCode();
    } else {
      if ((await this.store.activeCount()) > 0) return undefined;
      code = this.#withLinks(this.pairing.create("browser", 600));
    }
    const link = code.links[0]?.url;
    const what =
      code.purpose === "setup" ? "Passkey setup code" : "Pairing code";
    process.stdout.write(
      `[nerve] ${what}: ${code.code} (valid 10 minutes). Open ${link ?? "the Nerve web UI and choose “Pair this device”"}. More: \`nerve pair\`.\n`,
    );
    return code;
  }

  async dispose(): Promise<void> {
    await this.store.flush();
  }
}

function deviceNotFound(): AccessError {
  return new AccessError(404, "DEVICE_NOT_FOUND", "Device not found.");
}

function normalizeBinding(code: string | undefined): string | undefined {
  return code === undefined ? undefined : normalizePairingCode(code);
}

function parsePublicUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`network.publicUrl must be http(s): ${value}`);
  }
  return url;
}
