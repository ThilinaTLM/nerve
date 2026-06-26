import type { StatusTone } from "$lib/components/ui/status-dot";

export type MetaTone = "default" | "success" | "warning" | "error" | "info";

export type MetaItem = {
  text: string;
  tone?: MetaTone;
  mono?: boolean;
  openPath?: string;
  href?: string;
};

export type DetailsActionInfo = {
  hidden: number;
  label: string;
};

export type PrimaryArg = {
  text: string;
  openPath?: string;
  line?: number;
  href?: string;
  /** Preserve embedded whitespace for code/command-like values. */
  preserveWhitespace?: boolean;
};

export type ToolPresentation = {
  badge: string;
  primaryArg?: PrimaryArg;
  meta: MetaItem[];
  detailsAction?: DetailsActionInfo;
  /** Tone for the leading status dot. */
  dotTone: StatusTone;
  /** Pulse the leading status dot (in-flight / awaiting states). */
  dotPulse: boolean;
};
