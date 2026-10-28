import Bot from "@lucide/svelte/icons/bot";
import ClipboardList from "@lucide/svelte/icons/clipboard-list";
import Code2 from "@lucide/svelte/icons/code-2";
import Network from "@lucide/svelte/icons/network";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import ShieldCog from "@lucide/svelte/icons/shield-cog";
import ShieldEllipsis from "@lucide/svelte/icons/shield-ellipsis";
import ShieldMinus from "@lucide/svelte/icons/shield-minus";
import ShieldZap from "@nervekit/ui-kit/icons/ShieldZap";

/** One glyph per agent profile, shared by the composer trigger and its list. */
export function profileIcon(name: string) {
  switch (name) {
    case "planning":
      return ClipboardList;
    case "coding":
      return Code2;
    case "lead":
      return Network;
    default:
      return Bot;
  }
}

/** One glyph per permission rule set, shared by the trigger and its list. */
export function permissionIcon(id: string) {
  switch (id) {
    case "read_only":
      return ShieldMinus;
    case "autonomous":
      return ShieldZap;
    case "supervised":
      return ShieldCheck;
    case "planning":
      return ShieldEllipsis;
    default:
      return ShieldCog;
  }
}
