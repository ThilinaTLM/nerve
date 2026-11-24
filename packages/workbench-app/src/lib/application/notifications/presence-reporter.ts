import type { ClientPresence } from "@nervekit/contracts/access";

/**
 * Sends this window's presence to the daemon, which pushes to phones only
 * when no client is active or muted. Sends changes only; `force` repeats the
 * current value after a reconnect, when the daemon has forgotten it.
 */
export function createPresenceReporter(
  send: (presence: ClientPresence) => Promise<unknown>,
): { sync(next: ClientPresence, force?: boolean): void } {
  let sent: ClientPresence | undefined;
  return {
    sync(next, force = false) {
      if (!force && sent?.active === next.active && sent.muted === next.muted) {
        return;
      }
      sent = next;
      send(next).catch(() => {
        // Retry on the next change or reconnect.
        if (sent === next) sent = undefined;
      });
    },
  };
}
