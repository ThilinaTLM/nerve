import { z } from "zod";
import {
  resolveAgentConfiguration,
  type ResolutionOptions,
} from "./resolver.js";
import {
  canonicalSettingsEntries,
  conversationDefaultsSchema,
  leadSettingsOverridesSchema,
  type LeadSettingsOverrides,
} from "./schemas.js";

/** Resolution below a conversation: retain recommendations, never requirements or choices. */
export function resolveInheritedConversationSettings(
  options: ResolutionOptions,
): LeadSettingsOverrides {
  return resolveAgentConfiguration({
    ...options,
    conversation: undefined,
    launch: undefined,
    appliedProfile: options.appliedProfile
      ? { ...options.appliedProfile, requirements: {} }
      : null,
  }).settings;
}

/** JSON value equality independent of object property insertion order. Arrays remain ordered. */
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => equal(value, b[index]))
    );
  const left = Object.entries(a);
  return (
    left.length === Object.keys(b).length &&
    left.every(
      ([key, value]) =>
        Object.hasOwn(b, key) &&
        equal(value, (b as Record<string, unknown>)[key]),
    )
  );
}

function put(target: Record<string, unknown>, pointer: string, value: unknown) {
  const keys = pointer
    .slice(1)
    .split("/")
    .map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
  let node = target;
  for (const key of keys.slice(0, -1)) {
    if (!Object.hasOwn(node, key))
      Object.defineProperty(node, key, {
        value: {},
        enumerable: true,
        configurable: true,
        writable: true,
      });
    node = node[key] as Record<string, unknown>;
  }
  Object.defineProperty(node, keys.at(-1)!, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/**
 * Keep only value-based overrides against a resolved lower layer. Callers own
 * requirement validation and must supply the correct baseline (including a
 * child's frozen defaults), not a resolution containing the edited layer.
 * Atomic merge units are compared whole; empty containers disappear naturally.
 */
export function normalizeSettingsOverrides(
  overrides: LeadSettingsOverrides,
  inherited: LeadSettingsOverrides,
): LeadSettingsOverrides {
  const current = leadSettingsOverridesSchema.parse(overrides);
  const lower = leadSettingsOverridesSchema.parse(inherited);
  const inheritedEntries = new Map(canonicalSettingsEntries(lower));
  const result: Record<string, unknown> = {};
  for (const [pointer, value] of canonicalSettingsEntries(current)) {
    if (pointer.startsWith("/skills/")) continue;
    if (!equal(value, inheritedEntries.get(pointer)))
      put(result, pointer, value);
  }
  for (const source of ["file", "nerve", "agentBrowser"] as const) {
    const named = current.skills?.[source] ?? {};
    const inheritedNamed = lower.skills?.[source] ?? {};
    const inheritedDefault = lower.skills?.defaults?.[source];
    const localDefault = current.skills?.defaults?.[source];
    // Even an equal source default can mask lower-layer named exceptions.
    const keepDefault =
      localDefault !== undefined &&
      (localDefault !== inheritedDefault ||
        Object.entries(inheritedNamed).some(
          ([name, value]) =>
            !Object.hasOwn(named, name) && value !== localDefault,
        ));
    if (keepDefault) put(result, `/skills/defaults/${source}`, localDefault);
    for (const [name, value] of Object.entries(named)) {
      const baseline = keepDefault
        ? localDefault
        : Object.hasOwn(inheritedNamed, name)
          ? inheritedNamed[name]
          : inheritedDefault;
      if (value !== baseline)
        put(
          result,
          `/skills/${source}/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`,
          value,
        );
    }
  }
  return leadSettingsOverridesSchema.parse(result);
}

export type CreationPreferencesOverrides = z.infer<
  typeof conversationDefaultsSchema.shape.overrides
>;

/** Creation model selections are atomic sets: order and duplicates have no effect. */
export function normalizeCreationPreferencesOverrides(
  overrides: CreationPreferencesOverrides,
  inherited: CreationPreferencesOverrides,
): CreationPreferencesOverrides {
  const schema = conversationDefaultsSchema.shape.overrides;
  const current = schema.parse(overrides);
  const lower = schema.parse(inherited);
  const sameModelSelection = (
    a: NonNullable<CreationPreferencesOverrides["scopedModels"]>,
    b: CreationPreferencesOverrides["scopedModels"],
  ) =>
    b !== undefined &&
    a.every((model) => b.some((other) => equal(model, other))) &&
    b.every((model) => a.some((other) => equal(model, other)));
  return {
    ...(current.defaultAgentProfile !== undefined &&
    current.defaultAgentProfile !== lower.defaultAgentProfile
      ? { defaultAgentProfile: current.defaultAgentProfile }
      : {}),
    ...(current.scopedModels !== undefined &&
    !sameModelSelection(current.scopedModels, lower.scopedModels)
      ? { scopedModels: current.scopedModels }
      : {}),
  };
}
