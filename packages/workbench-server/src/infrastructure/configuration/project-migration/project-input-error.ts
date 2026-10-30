/** Preserve the actual failing companion identity for health and confirmed recovery. */
export class ProjectInputError extends Error {
  constructor(
    readonly path: string,
    readonly source: Buffer,
    cause: unknown,
  ) {
    super("Project configuration input failed", { cause });
  }
}

export class NewerLegacyVersion extends Error {}
