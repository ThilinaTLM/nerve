import { z } from "zod";

export const homeAdmissionFailureKindSchema = z.enum([
  "too_old",
  "manifest_invalid",
  "ledger_unexpected",
  "layout_unrecognized",
]);
export type HomeAdmissionFailureKind = z.infer<
  typeof homeAdmissionFailureKindSchema
>;

/** Stable diagnostic code survives worker and child-process error boundaries. */
export class HomeAdmissionError extends Error {
  constructor(
    readonly kind: HomeAdmissionFailureKind,
    message: string,
  ) {
    super(`[NERVE_HOME_ADMISSION:${kind}] ${message}`);
    this.name = "HomeAdmissionError";
  }
}

export function homeAdmissionFailureKind(
  error: unknown,
): HomeAdmissionFailureKind | undefined {
  const text = error instanceof Error ? error.message : String(error);
  const match = /\[NERVE_HOME_ADMISSION:([a-z_]+)\]/.exec(text);
  const parsed = homeAdmissionFailureKindSchema.safeParse(match?.[1]);
  return parsed.success ? parsed.data : undefined;
}
