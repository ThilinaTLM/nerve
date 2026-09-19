import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type {
  CardGlyph,
  MetaItem,
  PrimaryArg,
} from "../../cards/card-presentation";

export type DetailsActionInfo = {
  hidden: number;
  label: string;
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
  /** Glyph override for work that is not what its tool status implies. */
  glyph?: CardGlyph;
  /** Background task this call was promoted into, if any. */
  backgroundTaskId?: string;
};
