import {
  settingsHealthSchema,
  type SettingsHealth,
  type SettingsResolutionRequest,
} from "@nervekit/contracts/settings";
import { apiGet, apiPost } from "$lib/platform/http/api-client";

export async function fetchSettingsHealth(): Promise<SettingsHealth> {
  return settingsHealthSchema.parse(await apiGet("/api/settings/health"));
}

export async function resolveSettingsHealth(
  request: SettingsResolutionRequest,
): Promise<SettingsHealth> {
  return settingsHealthSchema.parse(
    await apiPost("/api/settings/health/resolve", request),
  );
}

export interface SettingsHealthNoticeState {
  health: SettingsHealth;
  pending: boolean;
  error?: string;
}

/** Keep the persistent notice on failed requests; only a successful read clears it. */
export async function updateSettingsHealthNotice(
  state: SettingsHealthNoticeState,
  request: () => Promise<SettingsHealth>,
): Promise<SettingsHealthNoticeState> {
  try {
    return { health: await request(), pending: false };
  } catch (error) {
    return {
      health: state.health,
      pending: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not load settings health.",
    };
  }
}

/** Identifies the set of failing files; the toast fires when it changes. */
export function settingsHealthSignature(health: SettingsHealth): string {
  return health.invalid
    .map((item) => item.id)
    .sort()
    .join(",");
}

export function settingsHealthToastTitle(health: SettingsHealth): string {
  const count = health.invalid.length;
  return `Settings need attention · ${count} ${count === 1 ? "file" : "files"}`;
}
