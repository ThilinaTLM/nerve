import type { GuideId } from "../guides/catalog.js";

/** Where a Discover entry sends the user when it is acted on. */
export type DiscoverAction =
  | { kind: "guide"; guideId: GuideId; label: string }
  | { kind: "settings"; pageId: string; sectionId: string; label: string }
  | { kind: "external"; href: string; label: string };

export type DiscoverArtwork = "conversations" | "discover" | "workbench";

/**
 * A release-tagged announcement. `releasedIn` anchors the entry to an app
 * version so Discover can group it and decide whether a release is worth
 * surfacing automatically; `version` is the content revision and is bumped
 * only when the copy changes enough to deserve a fresh unread flag.
 */
export type DiscoverNewsEntry = {
  id: string;
  version: number;
  releasedIn: string;
  title: string;
  summary: string;
  details?: readonly string[];
  featured?: boolean;
  artwork?: DiscoverArtwork;
  action?: DiscoverAction;
};

export type DiscoverTipEntry = {
  id: string;
  version: number;
  title: string;
  summary: string;
  action?: DiscoverAction;
};

export type DiscoverResourceLink = {
  id: string;
  label: string;
  href: string;
};
