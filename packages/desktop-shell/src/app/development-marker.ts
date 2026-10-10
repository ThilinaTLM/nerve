// `pnpm desktop:dev` labels its windows so they can't be mistaken for the
// production app. The preload parses the same argument (see preload-api.cjs).
export const DEVELOPMENT_SLOT_ARGUMENT = "--nerve-dev-slot=";

export function parseDevelopmentSlot(
  value: string | undefined,
): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[1-9]\d*$/.test(trimmed)) return undefined;
  const slot = Number(trimmed);
  return slot <= 100 ? slot : undefined;
}
