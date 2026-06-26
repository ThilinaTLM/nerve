import type { StatusTone } from "$lib/components/ui/status-dot";

export type MetaTone = "default" | "success" | "warning" | "error" | "info";

export type MetaItem = {
  text: string;
  tone?: MetaTone;
  mono?: boolean;
  openPath?: string;
  href?: string;
};

export type CollapseInfo = {
  hidden: number;
  expandLabel: string;
  collapseLabel: string;
};

export type PrimaryArg = {
  text: string;
  openPath?: string;
  line?: number;
  href?: string;
};

export type ToolPresentation = {
  badge: string;
  primaryArg?: PrimaryArg;
  meta: MetaItem[];
  collapse?: CollapseInfo;
  /** Tone for the leading status dot. */
  dotTone: StatusTone;
  /** Pulse the leading status dot (in-flight / awaiting states). */
  dotPulse: boolean;
};
