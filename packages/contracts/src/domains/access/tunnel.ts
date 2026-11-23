import { z } from "zod";

/**
 * Private remote access through Tailscale Serve. The daemon owns a loopback
 * listener that Serve proxies to; see docs/proposals/mobile-workbench.md.
 */

/** HTTPS ports Tailscale Serve accepts. 443 gives a URL without a port. */
export const TUNNEL_HTTPS_PORTS = [443, 8443, 10000] as const;
export const tunnelHttpsPortSchema = z.union([
  z.literal(443),
  z.literal(8443),
  z.literal(10000),
]);
export type TunnelHttpsPort = z.infer<typeof tunnelHttpsPortSchema>;

/** Why the tunnel is not ready; each maps to one action for the user. */
export const tunnelProblemSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("not_installed") }),
  z.object({ code: z.literal("not_running") }),
  z.object({ code: z.literal("no_magic_dns") }),
  /** Serve/HTTPS is off for the tailnet; `approvalUrl` turns it on. */
  z.object({
    code: z.literal("serve_not_enabled"),
    approvalUrl: z.string().url().optional(),
  }),
  /** Linux: the user is not the tailnet operator. */
  z.object({ code: z.literal("permission_denied") }),
  /** Another Serve entry owns this HTTPS port. */
  z.object({ code: z.literal("port_in_use"), httpsPort: z.number().int() }),
  /** Funnel exposes our entry to the public internet. */
  z.object({ code: z.literal("funnel_enabled"), httpsPort: z.number().int() }),
  /** Our Serve entry disappeared or changed after it was set up. */
  z.object({ code: z.literal("entry_changed") }),
  z.object({ code: z.literal("command_failed"), detail: z.string() }),
]);
export type TunnelProblem = z.infer<typeof tunnelProblemSchema>;

export const tunnelStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("off") }),
  /** Checking Tailscale or adding the Serve entry. */
  z.object({ state: z.literal("starting") }),
  /** Waiting for the first certificate (tens of seconds, once). */
  z.object({ state: z.literal("certificate"), url: z.string().url() }),
  z.object({ state: z.literal("ready"), url: z.string().url() }),
  z.object({ state: z.literal("problem"), problem: tunnelProblemSchema }),
]);
export type TunnelStatus = z.infer<typeof tunnelStatusSchema>;
