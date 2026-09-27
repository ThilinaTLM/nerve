import { stat, statfs } from "node:fs/promises";

export const MINIMUM_MIGRATION_MARGIN_BYTES = 512 * 1024 * 1024;

export interface StorageSpaceRequirement {
  inputBytes: number;
  marginBytes: number;
  requiredBytes: number;
  availableBytes: number;
}

export class InsufficientStorageSpaceError extends Error {
  readonly code = "STORAGE_MIGRATION_SPACE_REQUIRED";

  constructor(readonly requirement: StorageSpaceRequirement) {
    super(
      `Storage migration requires ${requirement.requiredBytes} bytes but only ${requirement.availableBytes} bytes are available.`,
    );
    this.name = "InsufficientStorageSpaceError";
  }
}

export async function calculateStorageSpaceRequirement(
  filesystemPath: string,
  inputPaths: string[],
): Promise<StorageSpaceRequirement> {
  let inputBytes = 0;
  for (const path of inputPaths) {
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile()) inputBytes += info.size;
  }
  const marginBytes = Math.max(
    Math.ceil(inputBytes * 0.1),
    MINIMUM_MIGRATION_MARGIN_BYTES,
  );
  const filesystem = await statfs(filesystemPath);
  const availableBytes = filesystem.bavail * filesystem.bsize;
  return {
    inputBytes,
    marginBytes,
    requiredBytes: inputBytes + marginBytes,
    availableBytes,
  };
}

export async function assertStorageSpace(
  filesystemPath: string,
  inputPaths: string[],
): Promise<StorageSpaceRequirement> {
  const requirement = await calculateStorageSpaceRequirement(
    filesystemPath,
    inputPaths,
  );
  if (requirement.availableBytes < requirement.requiredBytes) {
    throw new InsufficientStorageSpaceError(requirement);
  }
  return requirement;
}

export async function assertStorageMargin(
  filesystemPath: string,
  marginBytes: number,
): Promise<void> {
  const filesystem = await statfs(filesystemPath);
  const availableBytes = filesystem.bavail * filesystem.bsize;
  if (availableBytes < marginBytes) {
    throw new InsufficientStorageSpaceError({
      inputBytes: 0,
      marginBytes,
      requiredBytes: marginBytes,
      availableBytes,
    });
  }
}
