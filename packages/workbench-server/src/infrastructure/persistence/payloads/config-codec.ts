import { upgradePayload, type PayloadUpgraderChain } from "./codec.js";
import { isJsonObject, mergeParsedWithRaw } from "./merge.js";

export interface ConfigurationCodec<T> {
  readonly currentVersion: number;
  decode(value: unknown): T;
  encode(value: T): unknown;
  version(value: unknown): number;
  upgrade(value: unknown): unknown;
}

export interface ConfigurationCodecOptions<T> {
  readonly currentVersion: number;
  readonly defaults: T;
  readonly version: (value: unknown) => number;
  readonly upgraders?: PayloadUpgraderChain;
  readonly read: (value: unknown) => T;
}

/**
 * Creates a codec for versioned JSON documents whose version is embedded in
 * the document. Known fields are validated while unknown object fields are
 * retained in the decoded/encoded value for forward compatibility.
 */
export function createConfigurationCodec<T>(
  options: ConfigurationCodecOptions<T>,
): ConfigurationCodec<T> {
  const upgrade = (value: unknown): unknown =>
    upgradePayload(
      value,
      options.version(value),
      options.currentVersion,
      options.upgraders,
    );
  const read = (value: unknown): T => {
    const withDefaults = mergeMissingDefaults(options.defaults, value);
    const projected = projectKnownFields(options.defaults, withDefaults);
    return mergeParsedWithRaw(withDefaults, options.read(projected)) as T;
  };
  return {
    currentVersion: options.currentVersion,
    decode(value) {
      return read(upgrade(value));
    },
    encode(value) {
      return read(upgrade(value));
    },
    version: options.version,
    upgrade,
  };
}

/** Add current defaults recursively without replacing explicit persisted data. */
export function mergeMissingDefaults(
  defaults: unknown,
  value: unknown,
): unknown {
  if (!isJsonObject(defaults) || !isJsonObject(value)) return value;
  const merged: Record<string, unknown> = structuredClone(defaults);
  for (const [key, child] of Object.entries(value)) {
    merged[key] = Object.hasOwn(defaults, key)
      ? mergeMissingDefaults(defaults[key], child)
      : structuredClone(child);
  }
  return merged;
}

/**
 * Projects fixed object shapes for strict read schemas. Arrays are left intact
 * because an empty default does not describe the shape of their elements.
 */
export function projectKnownFields(template: unknown, value: unknown): unknown {
  if (!isJsonObject(template) || !isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.keys(template)
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, projectKnownFields(template[key], value[key])]),
  );
}
