/* Every product capture the homepage shows, in one place. Pairs come from
 * `scripts/screenshots/run.ts` (see its README for scene ids). */
import type { ImageMetadata } from "astro";

import filesDark from "../../assets/screenshots/desktop/files-dark.webp";
import filesLight from "../../assets/screenshots/desktop/files-light.webp";
import mobileConversationDark from "../../assets/screenshots/mobile/conversation-dark.webp";
import mobileConversationLight from "../../assets/screenshots/mobile/conversation-light.webp";

export interface ScreenPair {
  light: ImageMetadata;
  dark: ImageMetadata;
  alt: string;
}

export const screens = {
  workbench: {
    light: filesLight,
    dark: filesDark,
    alt: "The Nerve workbench: project tabs, a project-wide search with the matching file open in the editor, and the Git panel with repositories, worktrees and the current branch's pull request",
  },
  mobile: {
    light: mobileConversationLight,
    dark: mobileConversationDark,
    alt: "A Nerve conversation on a phone",
  },
} satisfies Record<string, ScreenPair>;
