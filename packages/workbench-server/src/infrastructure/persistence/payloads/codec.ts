import { mergeParsedWithRaw } from "./merge.js";

export type EncodedPayload = Uint8Array | string;

export interface PayloadUpgradeContext {
  readonly fromVersion: number;
  readonly toVersion: number;
}

export type PayloadUpgrader = (
  value: unknown,
  context: PayloadUpgradeContext,
) => unknown;

export type PayloadUpgraderChain = Readonly<Record<number, PayloadUpgrader>>;

export interface PayloadCodec<T = unknown> {
  readonly currentVersion: number;
  decode(encoded: EncodedPayload, payloadVersion: number): T;
  /** Validate persisted bytes without reconstructing a preserved read value. */
  validate(encoded: EncodedPayload, payloadVersion: number): void;
  /** Validate an already parsed nested value without preserving unknown fields. */
  validateValue(value: unknown, payloadVersion: number): void;
  encode(value: T): Uint8Array;
  upgrade(value: unknown, payloadVersion: number): unknown;
  read(value: unknown): T;
}

export interface JsonPayloadCodecOptions<T> {
  readonly currentVersion: number;
  readonly upgraders?: PayloadUpgraderChain;
  /** The persisted read schema. This may intentionally be lenient. */
  readonly read: (value: unknown) => T;
  /** Optional validation-only path for nested codecs. */
  readonly validate?: (value: unknown) => void;
  /** Defaults to true so schema projection cannot erase unrecognized fields. */
  readonly preserveUnknownFields?: boolean;
}

export class UnsupportedPayloadVersionError extends Error {
  constructor(
    readonly payloadVersion: number,
    readonly currentVersion: number,
  ) {
    super(
      payloadVersion > currentVersion
        ? `Payload version ${payloadVersion} is newer than supported version ${currentVersion}.`
        : `No payload upgrader from version ${payloadVersion} to ${payloadVersion + 1}.`,
    );
    this.name = "UnsupportedPayloadVersionError";
  }
}

export function upgradePayload(
  value: unknown,
  payloadVersion: number,
  currentVersion: number,
  upgraders: PayloadUpgraderChain = {},
): unknown {
  assertVersion(payloadVersion, "payloadVersion");
  assertVersion(currentVersion, "currentVersion");
  if (payloadVersion > currentVersion) {
    throw new UnsupportedPayloadVersionError(payloadVersion, currentVersion);
  }

  let upgraded = value;
  for (let version = payloadVersion; version < currentVersion; version += 1) {
    const upgrader = upgraders[version];
    if (!upgrader) {
      throw new UnsupportedPayloadVersionError(version, currentVersion);
    }
    upgraded = upgrader(upgraded, {
      fromVersion: version,
      toVersion: version + 1,
    });
  }
  return upgraded;
}

export function readPreservingUnknown<T>(
  raw: unknown,
  read: (value: unknown) => T,
): T {
  return mergeParsedWithRaw(raw, read(raw)) as T;
}

export function createJsonPayloadCodec<T>(
  options: JsonPayloadCodecOptions<T>,
): PayloadCodec<T> {
  assertVersion(options.currentVersion, "currentVersion");
  const read = (value: unknown): T =>
    options.preserveUnknownFields === false
      ? options.read(value)
      : readPreservingUnknown(value, options.read);
  const parseAndUpgrade = (
    encoded: EncodedPayload,
    payloadVersion: number,
  ): unknown => {
    const text =
      typeof encoded === "string"
        ? encoded
        : Buffer.from(encoded).toString("utf8");
    const value: unknown = JSON.parse(text);
    return upgradePayload(
      value,
      payloadVersion,
      options.currentVersion,
      options.upgraders,
    );
  };
  return {
    currentVersion: options.currentVersion,
    decode(encoded, payloadVersion) {
      return read(parseAndUpgrade(encoded, payloadVersion));
    },
    validate(encoded, payloadVersion) {
      const value = parseAndUpgrade(encoded, payloadVersion);
      (options.validate ?? options.read)(value);
    },
    validateValue(value, payloadVersion) {
      const upgraded = upgradePayload(
        value,
        payloadVersion,
        options.currentVersion,
        options.upgraders,
      );
      (options.validate ?? options.read)(upgraded);
    },
    encode(value) {
      return Buffer.from(JSON.stringify(read(value)), "utf8");
    },
    upgrade(value, payloadVersion) {
      return upgradePayload(
        value,
        payloadVersion,
        options.currentVersion,
        options.upgraders,
      );
    },
    read,
  };
}

function assertVersion(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
}
