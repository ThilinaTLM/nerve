import type { UpdateSettingsRequest } from "$lib/api";

export type SettingsChange = (
  patch: UpdateSettingsRequest,
  options?: { immediate?: boolean; debounceMs?: number },
) => void;
