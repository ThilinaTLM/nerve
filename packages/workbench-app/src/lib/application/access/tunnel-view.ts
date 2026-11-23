import type { TunnelProblem, TunnelStatus } from "@nervekit/contracts/access";

export const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
export const TAILSCALE_ADMIN_DNS_URL = "https://login.tailscale.com/admin/dns";

export type TunnelView = {
  tone: "neutral" | "success" | "warning";
  /** One short line. */
  summary: string;
  /** Extra explanation under the summary. */
  detail?: string;
  /** Ready/certificate address, shown with a copy button. */
  url?: string;
  /** A one-time command to copy. */
  command?: string;
  /** A page that fixes the problem. */
  link?: { label: string; href: string };
  /** Offer "Try again" (saving the same settings makes the server retry). */
  retry: boolean;
};

const plain = (
  view: Partial<TunnelView> & { summary: string },
): TunnelView => ({
  tone: "warning",
  retry: false,
  ...view,
});

export function describeTunnelProblem(problem: TunnelProblem): TunnelView {
  switch (problem.code) {
    case "not_installed":
      return plain({
        summary: "Tailscale is not installed.",
        link: { label: "Download Tailscale", href: TAILSCALE_DOWNLOAD_URL },
        retry: true,
      });
    case "not_running":
      return plain({ summary: "Start Tailscale and sign in.", retry: true });
    case "no_magic_dns":
      return plain({
        summary: "MagicDNS is off for your tailnet.",
        detail: "Turn on MagicDNS in the Tailscale admin console.",
        link: { label: "Open admin console", href: TAILSCALE_ADMIN_DNS_URL },
        retry: true,
      });
    case "serve_not_enabled":
      return plain({
        summary: "Tailscale Serve is not enabled for your tailnet.",
        link: {
          label: "Enable Serve",
          href: problem.approvalUrl ?? TAILSCALE_ADMIN_DNS_URL,
        },
        retry: true,
      });
    case "permission_denied":
      return plain({
        summary: "Tailscale needs a one-time permission.",
        detail: "Run this command in a terminal, then try again.",
        command: "sudo tailscale set --operator=$USER",
        retry: true,
      });
    case "port_in_use":
      return plain({
        summary: `Another service uses port ${problem.httpsPort} on Tailscale. Choose another port.`,
      });
    case "funnel_enabled":
      return plain({
        summary: "Tailscale Funnel exposes this port to the public internet.",
        detail:
          "Private access has to stay private. Turn Funnel off, then try again.",
        command: `tailscale funnel --https=${problem.httpsPort} off`,
        retry: true,
      });
    case "entry_changed":
      return plain({
        summary: "The Tailscale Serve setup changed.",
        retry: true,
      });
    case "command_failed":
      return plain({
        summary: "Tailscale returned an error.",
        detail: problem.detail,
        retry: true,
      });
  }
}

export function describeTunnel(status: TunnelStatus | undefined): TunnelView {
  switch (status?.state) {
    case undefined:
    case "off":
      return { tone: "neutral", summary: "Off", retry: false };
    case "starting":
      return { tone: "neutral", summary: "Starting…", retry: false };
    case "certificate":
      return {
        tone: "neutral",
        summary: "Getting a certificate…",
        detail: "This can take up to a minute the first time.",
        url: status.url,
        retry: false,
      };
    case "ready":
      return {
        tone: "success",
        summary: "Ready",
        url: status.url,
        retry: false,
      };
    case "problem":
      return describeTunnelProblem(status.problem);
  }
}

/** One line for the phone, which only reads the state. */
export function tunnelPhoneSummary(status: TunnelStatus | undefined): string {
  switch (status?.state) {
    case undefined:
    case "off":
      return "Off. Turn on in Nerve on a computer.";
    case "starting":
      return "Starting…";
    case "certificate":
      return "Getting a certificate…";
    case "ready":
      return `Private access on · ${new URL(status.url).host}`;
    case "problem":
      return `Problem: ${describeTunnelProblem(status.problem).summary}`;
  }
}
