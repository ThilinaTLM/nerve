import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  DEVICE_ABSOLUTE_LIFETIME_MS,
  DEVICE_IDLE_LIFETIME_MS,
  type Device,
  type DeviceKind,
  type DeviceMethod,
  type DeviceView,
} from "@nervekit/contracts/access";
import {
  readDevicesFile,
  writeDevicesFile,
  type DeviceRecord,
  type DevicesFile,
  type PasskeyRecord,
} from "../../infrastructure/storage-bootstrap/devices-file.js";

const ROTATE_AFTER_MS = 24 * 60 * 60_000;
const PREVIOUS_GRACE_MS = 60_000;
const FLUSH_INTERVAL_MS = 5 * 60_000;
const CREDENTIAL_PREFIX = "nd_";

export type AuthenticateResult =
  | {
      ok: true;
      device: Device;
      /** A fresh credential the client must adopt (secret older than 24 h). */
      rotated?: string;
    }
  | { ok: false; reason: "malformed" | "unknown" | "expired" | "idle" };

export interface NewDevice {
  name: string;
  kind: DeviceKind;
  method: DeviceMethod;
  ip?: string;
  userAgent?: string;
}

const hashSecret = (secret: string): Buffer =>
  createHash("sha256").update(secret).digest();

function hashesEqual(hexHash: string, secret: string): boolean {
  const stored = Buffer.from(hexHash, "hex");
  const candidate = hashSecret(secret);
  return (
    stored.length === candidate.length && timingSafeEqual(stored, candidate)
  );
}

export function parseCredential(
  credential: string,
): { deviceId: string; secret: string } | undefined {
  if (!credential.startsWith(CREDENTIAL_PREFIX)) return undefined;
  const dot = credential.indexOf(".");
  if (dot < 0) return undefined;
  const deviceId = credential.slice(CREDENTIAL_PREFIX.length, dot);
  const secret = credential.slice(dot + 1);
  if (!/^dev_[0-9a-f]{16}$/.test(deviceId) || secret.length < 20)
    return undefined;
  return { deviceId, secret };
}

export const formatCredential = (deviceId: string, secret: string): string =>
  `${CREDENTIAL_PREFIX}${deviceId}.${secret}`;

const newSecret = (): string => randomBytes(32).toString("base64url");

function truncate(value: string | undefined, max: number): string | undefined {
  return value === undefined ? undefined : value.slice(0, max);
}

/**
 * Device credentials and owner passkeys, persisted in `secrets/devices.json`.
 * Secrets exist only as SHA-256 hashes. Loaded lazily; writes are atomic and
 * serialized; `lastSeenAt` is flushed at most every five minutes.
 */
export class DeviceStore {
  readonly #path: string;
  readonly #now: () => number;
  #file: DevicesFile | undefined;
  #loading: Promise<DevicesFile> | undefined;
  #writes: Promise<void> = Promise.resolve();
  #dirtySince: number | undefined;

  constructor(path: string, options: { now?: () => number } = {}) {
    this.#path = path;
    this.#now = options.now ?? Date.now;
  }

  async #load(): Promise<DevicesFile> {
    if (this.#file) return this.#file;
    // Expired devices stay listed (as "Expired") until dismissed; only their
    // credentials are refused, in `authenticate`.
    this.#loading ??= readDevicesFile(this.#path).then((file) => {
      this.#file = file;
      return file;
    });
    return this.#loading;
  }

  #persist(): Promise<void> {
    const file = this.#file;
    if (!file) return Promise.resolve();
    this.#dirtySince = undefined;
    const snapshot: DevicesFile = structuredClone(file);
    this.#writes = this.#writes
      .catch(() => undefined)
      .then(() => writeDevicesFile(this.#path, snapshot));
    return this.#writes;
  }

  /** Flush pending `lastSeenAt` changes (shutdown). */
  async flush(): Promise<void> {
    if (this.#dirtySince !== undefined) await this.#persist();
    await this.#writes;
  }

  async create(
    input: NewDevice,
  ): Promise<{ device: Device; credential: string }> {
    const file = await this.#load();
    const now = this.#now();
    const id = `dev_${randomBytes(8).toString("hex")}`;
    const secret = newSecret();
    const device: Device = {
      id,
      name: input.name.slice(0, 80),
      kind: input.kind,
      createdAt: now,
      lastSeenAt: now,
      lastSeenIp: input.ip,
      userAgent: truncate(input.userAgent, 200),
      method: input.method,
      expiresAt: now + DEVICE_ABSOLUTE_LIFETIME_MS,
    };
    file.devices.push({
      device,
      secretHash: hashSecret(secret).toString("hex"),
      secretIssuedAt: now,
    });
    await this.#persist();
    return { device, credential: formatCredential(id, secret) };
  }

  /** Verify a wire credential; applies idle/absolute expiry and 24 h rotation. */
  async authenticate(
    credential: string,
    seen: { ip?: string; userAgent?: string } = {},
    options: { allowRotation?: boolean } = {},
  ): Promise<AuthenticateResult> {
    const parsed = parseCredential(credential);
    if (!parsed) return { ok: false, reason: "malformed" };
    const file = await this.#load();
    const record = file.devices.find(
      (entry) => entry.device.id === parsed.deviceId,
    );
    if (!record) return { ok: false, reason: "unknown" };
    const now = this.#now();
    const current = hashesEqual(record.secretHash, parsed.secret);
    const previous =
      !current &&
      record.previousHash !== undefined &&
      (record.previousUntil ?? 0) > now &&
      hashesEqual(record.previousHash, parsed.secret);
    if (!current && !previous) return { ok: false, reason: "unknown" };
    const state = this.#state(record.device, now);
    if (state !== "active") return { ok: false, reason: state };

    record.device.lastSeenAt = now;
    if (seen.ip) record.device.lastSeenIp = seen.ip;
    if (seen.userAgent) record.device.userAgent = truncate(seen.userAgent, 200);

    let rotated: string | undefined;
    if (
      current &&
      options.allowRotation !== false &&
      now - record.secretIssuedAt > ROTATE_AFTER_MS
    ) {
      const secret = newSecret();
      record.previousHash = record.secretHash;
      record.previousUntil = now + PREVIOUS_GRACE_MS;
      record.secretHash = hashSecret(secret).toString("hex");
      record.secretIssuedAt = now;
      rotated = formatCredential(record.device.id, secret);
      await this.#persist();
    } else if (record.previousHash && (record.previousUntil ?? 0) <= now) {
      record.previousHash = undefined;
      record.previousUntil = undefined;
    }
    this.#dirtySince ??= now;
    if (rotated === undefined && now - this.#dirtySince >= FLUSH_INTERVAL_MS) {
      void this.#persist().catch(() => undefined);
    }
    return { ok: true, device: { ...record.device }, rotated };
  }

  #state(device: Device, now: number): "active" | "expired" | "idle" {
    if (now >= device.expiresAt) return "expired";
    if (now - device.lastSeenAt >= DEVICE_IDLE_LIFETIME_MS) return "idle";
    return "active";
  }

  async list(currentDeviceId?: string): Promise<DeviceView[]> {
    const file = await this.#load();
    const now = this.#now();
    return file.devices
      .map(({ device }) => ({
        ...device,
        status:
          this.#state(device, now) === "active"
            ? ("active" as const)
            : ("expired" as const),
        idleExpiresAt: device.lastSeenAt + DEVICE_IDLE_LIFETIME_MS,
        current: device.id === currentDeviceId,
      }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  async get(deviceId: string): Promise<Device | undefined> {
    const file = await this.#load();
    const found = file.devices.find((entry) => entry.device.id === deviceId);
    return found ? { ...found.device } : undefined;
  }

  async activeCount(): Promise<number> {
    const file = await this.#load();
    const now = this.#now();
    return file.devices.filter(
      ({ device }) => this.#state(device, now) === "active",
    ).length;
  }

  async rename(deviceId: string, name: string): Promise<Device | undefined> {
    const file = await this.#load();
    const record = file.devices.find((entry) => entry.device.id === deviceId);
    if (!record) return undefined;
    record.device.name = name.slice(0, 80);
    await this.#persist();
    return { ...record.device };
  }

  /** Delete (revoke or dismiss) one device. */
  async revoke(deviceId: string): Promise<Device | undefined> {
    const file = await this.#load();
    const index = file.devices.findIndex(
      (entry) => entry.device.id === deviceId,
    );
    if (index < 0) return undefined;
    const [removed] = file.devices.splice(index, 1) as [DeviceRecord];
    await this.#persist();
    return removed.device;
  }

  async revokeAll(
    options: { exceptDeviceId?: string } = {},
  ): Promise<Device[]> {
    const file = await this.#load();
    const removed = file.devices
      .filter((entry) => entry.device.id !== options.exceptDeviceId)
      .map((entry) => entry.device);
    file.devices = file.devices.filter(
      (entry) => entry.device.id === options.exceptDeviceId,
    );
    if (removed.length > 0) await this.#persist();
    return removed;
  }

  // ---- owner passkeys ----------------------------------------------------

  async passkeys(): Promise<PasskeyRecord[]> {
    const file = await this.#load();
    return structuredClone(file.owner?.passkeys ?? []);
  }

  async addPasskey(record: PasskeyRecord): Promise<void> {
    const file = await this.#load();
    file.owner ??= { passkeys: [] };
    file.owner.passkeys.push(record);
    await this.#persist();
  }

  async updatePasskeyUse(id: string, counter: number): Promise<void> {
    const file = await this.#load();
    const record = file.owner?.passkeys.find((entry) => entry.id === id);
    if (!record) return;
    record.counter = counter;
    record.lastUsedAt = this.#now();
    await this.#persist();
  }

  async removePasskey(id: string): Promise<boolean> {
    const file = await this.#load();
    const passkeys = file.owner?.passkeys ?? [];
    const index = passkeys.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    passkeys.splice(index, 1);
    await this.#persist();
    return true;
  }

  async clearPasskeys(): Promise<number> {
    const file = await this.#load();
    const count = file.owner?.passkeys.length ?? 0;
    file.owner = undefined;
    if (count > 0) await this.#persist();
    return count;
  }
}
