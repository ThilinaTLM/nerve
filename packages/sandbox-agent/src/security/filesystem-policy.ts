import { access, constants, lstat, realpath } from "node:fs/promises";

export type FilesystemPolicyStatus = {
  ok: boolean;
  limitations: string[];
  errors: string[];
};

export async function assertInsideRoot(
  candidate: string,
  root: string,
): Promise<void> {
  const [realCandidate, realRoot] = await Promise.all([
    realpath(candidate),
    realpath(root),
  ]);
  if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}/`))
    throw new Error(`Path escapes allowed root: ${candidate}`);
}

export async function checkSandboxFilesystemPolicy(paths: {
  agentDir: string;
  workspaceDir: string;
  stateDir: string;
  tempDir?: string;
  builtinSkillsDir?: string;
}): Promise<FilesystemPolicyStatus> {
  const errors: string[] = [];
  const limitations: string[] = [];
  await mustExistReadonly(paths.agentDir, "/agent", errors, limitations);
  if (paths.builtinSkillsDir)
    await mustExistReadonly(
      paths.builtinSkillsDir,
      "/agent/skills",
      errors,
      limitations,
      true,
    );
  await mustWritable(paths.workspaceDir, "/workspace", errors);
  await mustWritable(paths.stateDir, "/state", errors);
  if (paths.tempDir) await mustWritable(paths.tempDir, "/tmp", errors);
  return { ok: errors.length === 0, errors, limitations };
}

async function mustExistReadonly(
  path: string,
  label: string,
  errors: string[],
  limitations: string[],
  optional = false,
): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory()) errors.push(`${label} must be a directory`);
    await access(path, constants.W_OK).then(
      () => errors.push(`${label} must not be writable by sandbox user`),
      () => undefined,
    );
  } catch {
    if (!optional) errors.push(`${label} is missing`);
    else limitations.push(`${label} not present`);
  }
}
async function mustWritable(
  path: string,
  label: string,
  errors: string[],
): Promise<void> {
  try {
    await access(path, constants.W_OK);
  } catch {
    errors.push(`${label} must be writable by sandbox user`);
  }
}
