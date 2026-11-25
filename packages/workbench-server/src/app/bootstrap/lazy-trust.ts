import type { TrustedResourceService } from "@nervekit/conversation-core";

/** What readers of trust decisions need of the core's service, which is created after them. */
export type TrustReader = Pick<
  TrustedResourceService,
  "find" | "state" | "trustState"
>;

export function lazyTrust(
  service: () => Pick<TrustedResourceService, keyof TrustReader>,
): TrustReader {
  return {
    find: (...args) => service().find(...args),
    state: (...args) => service().state(...args),
    trustState: (...args) => service().trustState(...args),
  };
}
