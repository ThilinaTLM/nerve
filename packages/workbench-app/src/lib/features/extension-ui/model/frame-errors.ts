import {
  bridgeLimits,
  type BridgeFrameError,
} from "@nervekit/contracts/extensions";

/** Decides which frame errors of one frame load are forwarded: identical ones once, a bounded number in total. */
export class FrameErrorGate {
  private readonly seen = new Set<string>();

  accept(error: BridgeFrameError): boolean {
    if (this.seen.size >= bridgeLimits.maxFrameErrorsPerLoad) return false;
    const key = `${error.kind}\n${error.message}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  reset(): void {
    this.seen.clear();
  }
}
