import { ShellChannelStatus } from "../shell-channel-status.svelte";
import { usageSelectors } from "$lib/application/usage/usage-selectors.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import {
  connectionLabel,
  mobileConnectionState,
  mobileStatusBanner,
  type MobileConnectionState,
} from "./mobile-status";

/** Shared phone status: one channel observer, read by every root header. */
export const mobileStatusSheet = $state({ open: false });

const channels = new ShellChannelStatus();

/** Start observing the daemon channels; call once from a component. */
export function observeMobileStatus(): () => void {
  return channels.observe();
}

export function mobileConnection(): MobileConnectionState {
  return mobileConnectionState({
    channelsConnected: channels.connected,
    connection: workspaceSelectors.connection,
  });
}

/** The connection word for header subtitles ("connected", "offline"…). */
export function mobileConnectionText(): string {
  return connectionLabel(mobileConnection());
}

export function mobileBanner() {
  return mobileStatusBanner({
    state: mobileConnection(),
    usages: usageSelectors.subscriptionUsages,
  });
}
