import type { ExtensionConsent } from "@nervekit/contracts/extensions";
import { line, type ReviewLine } from "./review-lines.js";

const SHORT_BY_KIND: Record<string, string> = {
  network: "Reaches the network",
  account: "Uses your accounts",
  model: "Uses your models",
  frame: "Shows web content",
  tools: "Adds agent tools",
  namespace: "Adds commands for agents",
  ui: "Changes the workbench",
  code: "Its code changed",
};

/**
 * The consent items of an extension as review lines. A first consent lists everything it asks
 * for; an update lists only what is new, so its lines are all `new` (see `newLines`).
 */
export function extensionLines(consent: ExtensionConsent): ReviewLine[] {
  return consent.items.map((item) =>
    line(item.text, item.broad === true, SHORT_BY_KIND[item.kind]),
  );
}
