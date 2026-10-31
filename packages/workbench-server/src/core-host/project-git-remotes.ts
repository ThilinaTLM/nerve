import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
/** Read git configuration only: no remote access and no shell expansion. */
export async function projectGitRemotes(directory: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["config", "--get-regexp", "^remote\\..*\\.url$"],
      { cwd: directory, timeout: 5000, maxBuffer: 1024 * 1024 },
    );
    return stdout.split("\n").flatMap((line) => {
      const match = /^\S+\s+(.+)$/.exec(line);
      return match ? [match[1]] : [];
    });
  } catch {
    return [];
  }
}
