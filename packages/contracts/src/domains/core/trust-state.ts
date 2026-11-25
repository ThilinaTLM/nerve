import { z } from "zod";

/**
 * What the user sees about one resource, derived from its stored row and the current content
 * digest by `TrustedResourceService.trustState`: no decision for this content (`needs_review`),
 * exactly this content trusted, or declined by the user (whatever the content now is).
 */
export const trustStateSchema = z.enum(["needs_review", "trusted", "declined"]);
export type TrustState = z.infer<typeof trustStateSchema>;
