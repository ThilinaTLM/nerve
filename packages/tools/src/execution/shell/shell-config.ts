import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface ShellConfig {
  shell: string;
  args: string[];
}

export interface ResolveBashShellConfigOptions {
  shellPath?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathExists?: (path: string) => boolean;
  runCommand?: (
    command: string,
    args: string[],
  ) => { stdout: string; status: number | null };
}

function defaultRunCommand(
  command: string,
  args: string[],
): { stdout: string; status: number | null } {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return {
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      status: result.status,
    };
  } catch {
    return { stdout: "", status: null };
  }
}

function findBashOnPath(
  platform: NodeJS.Platform,
  pathExists: (path: string) => boolean,
  runCommand: (
    command: string,
    args: string[],
  ) => { stdout: string; status: number | null },
): string | undefined {
  const result =
    platform === "win32"
      ? runCommand("where", ["bash.exe"])
      : runCommand("which", ["bash"]);
  if (result.status !== 0 || !result.stdout) return undefined;
  const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
  if (!firstMatch) return undefined;
  return platform === "win32" && !pathExists(firstMatch)
    ? undefined
    : firstMatch;
}

export function resolveBashShellConfig(
  options: ResolveBashShellConfigOptions = {},
): ShellConfig {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? existsSync;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const customShellPath = options.shellPath?.trim();

  if (customShellPath) {
    if (pathExists(customShellPath)) {
      return { shell: customShellPath, args: ["-c"] };
    }
    throw new Error(`Custom shell path not found: ${customShellPath}`);
  }

  if (platform === "win32") {
    const candidates: string[] = [];
    const programFiles = env.ProgramFiles;
    if (programFiles) candidates.push(`${programFiles}\\Git\\bin\\bash.exe`);
    const programFilesX86 = env["ProgramFiles(x86)"];
    if (programFilesX86) {
      candidates.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
    }

    for (const candidate of candidates) {
      if (pathExists(candidate)) return { shell: candidate, args: ["-c"] };
    }

    const bashOnPath = findBashOnPath(platform, pathExists, runCommand);
    if (bashOnPath) return { shell: bashOnPath, args: ["-c"] };

    throw new Error(
      `No bash shell found. Options:\n` +
        `  1. Install Git for Windows: https://git-scm.com/download/win\n` +
        `  2. Add bash.exe to PATH (Git Bash, MSYS2, Cygwin, etc.)\n` +
        `  3. Set runtime.shellPath in Nerve settings\n\n` +
        `Searched Git Bash in:\n${candidates.map((path) => `  ${path}`).join("\n")}`,
    );
  }

  if (pathExists("/bin/bash")) return { shell: "/bin/bash", args: ["-c"] };

  const bashOnPath = findBashOnPath(platform, pathExists, runCommand);
  if (bashOnPath) return { shell: bashOnPath, args: ["-c"] };

  return { shell: "sh", args: ["-c"] };
}
