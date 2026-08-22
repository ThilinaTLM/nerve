export type FeatureCapability =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: string };

export const enabledCapability: FeatureCapability = { enabled: true };

export function disabledCapability(reason: string): FeatureCapability {
  return { enabled: false, reason };
}
