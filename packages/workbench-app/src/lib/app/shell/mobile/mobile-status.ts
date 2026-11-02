import { usageTone } from "@nervekit/ui-kit/display/usage";

/**
 * Phone status line: connection and provider quota folded into one header
 * subtitle fragment, with a banner only when something needs attention.
 */

export type MobileConnectionState =
  | "connected"
  | "reconnecting"
  | "connecting"
  | "offline";

type WindowLike = { usedPercent?: number | null } | null | undefined;
type UsageEntryLike = {
  provider: string;
  usage?: { session?: WindowLike; weekly?: WindowLike } | null;
};

export type MobileStatusBanner = {
  tone: "warning" | "destructive";
  message: string;
};

export function mobileConnectionState(input: {
  channelsConnected: boolean;
  connection: string;
}): MobileConnectionState {
  if (input.channelsConnected) return "connected";
  if (input.connection === "connected") return "reconnecting";
  if (input.connection === "error" || input.connection === "closed")
    return "offline";
  return "connecting";
}

export function connectionLabel(state: MobileConnectionState): string {
  switch (state) {
    case "connected":
      return "connected";
    case "reconnecting":
      return "reconnecting";
    case "connecting":
      return "connecting";
    default:
      return "offline";
  }
}

export function providerLabel(provider: string): string {
  if (provider === "openai-codex") return "Codex";
  if (provider === "anthropic") return "Anthropic";
  return provider;
}

/** The provider closest to its limit, when any window is past the red line. */
export function usageAttention(
  usages: readonly UsageEntryLike[],
): { provider: string; percent: number } | undefined {
  let worst: { provider: string; percent: number } | undefined;
  for (const entry of usages) {
    for (const window of [entry.usage?.session, entry.usage?.weekly]) {
      const percent = window?.usedPercent;
      if (percent == null || usageTone(percent) !== "error") continue;
      if (!worst || percent > worst.percent)
        worst = { provider: entry.provider, percent };
    }
  }
  return worst;
}

export function mobileStatusBanner(input: {
  state: MobileConnectionState;
  usages: readonly UsageEntryLike[];
}): MobileStatusBanner | undefined {
  if (input.state === "offline") {
    return { tone: "destructive", message: "Disconnected from the daemon" };
  }
  if (input.state === "reconnecting") {
    return { tone: "warning", message: "Reconnecting to the daemon…" };
  }
  const attention = usageAttention(input.usages);
  if (attention) {
    return {
      tone: "warning",
      message: `${providerLabel(attention.provider)} usage at ${Math.round(attention.percent)}%`,
    };
  }
  return undefined;
}
