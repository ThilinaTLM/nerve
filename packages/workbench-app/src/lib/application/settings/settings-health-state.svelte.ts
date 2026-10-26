import type {
  SettingsDocumentId,
  SettingsResolutionRequest,
} from "@nervekit/contracts/settings";
import { loadCoreSettings } from "$lib/application/settings/settings-actions.svelte";
import {
  fetchSettingsHealth,
  resolveSettingsHealth,
  updateSettingsHealthNotice,
  type SettingsHealthNoticeState,
} from "$lib/application/settings/settings-health";

/** Shared by the activity list item, the toast and the reset confirmation. */
class SettingsHealthController {
  notice = $state<SettingsHealthNoticeState>({
    health: { invalid: [] },
    pending: false,
  });
  /** The file awaiting reset confirmation. */
  resetId = $state<SettingsDocumentId>();

  async refresh(): Promise<void> {
    if (this.notice.pending) return;
    this.notice = { ...this.notice, pending: true, error: undefined };
    this.notice = await updateSettingsHealthNotice(
      this.notice,
      fetchSettingsHealth,
    );
  }

  async resolve(request: SettingsResolutionRequest): Promise<void> {
    if (this.notice.pending) return;
    this.notice = { ...this.notice, pending: true, error: undefined };
    this.notice = await updateSettingsHealthNotice(this.notice, () =>
      resolveSettingsHealth(request),
    );
    // Rehydrate settings, provider metadata and open settings forms from the server.
    if (
      !this.notice.error &&
      !this.notice.health.invalid.some((item) => item.id === request.id)
    ) {
      this.notice = { ...this.notice, pending: true };
      try {
        await loadCoreSettings();
      } catch (error) {
        this.notice = {
          ...this.notice,
          error:
            error instanceof Error
              ? error.message
              : "Settings were repaired, but the workbench could not refresh them.",
        };
      } finally {
        this.notice = { ...this.notice, pending: false };
      }
    }
  }
}

export const settingsHealth = new SettingsHealthController();
