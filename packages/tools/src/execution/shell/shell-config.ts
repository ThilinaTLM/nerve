import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";

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
  env: NodeJS.ProcessEnv,
): string | undefined {
  const result =
    platform === "win32"
      ? runCommand("where", ["bash.exe"])
      : runCommand("which", platform === "darwin" ? ["-a", "bash"] : ["bash"]);
  if (result.status !== 0 || !result.stdout) return undefined;
  return result.stdout
    .split(/\r?\n/)
    .map((path) => path.trim())
    .find((path) => {
      if (!path) return false;
      if (platform === "darwin")
        return path !== "/bin/bash" && pathExists(path);
      if (platform !== "win32") return true;
      const windowsRoot = env.SystemRoot ?? env.WINDIR;
      const isWslLauncher =
        windowsRoot &&
        win32.normalize(path).toLowerCase() ===
          win32.join(windowsRoot, "System32", "bash.exe").toLowerCase();
      return !isWslLauncher && pathExists(path);
    });
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

    if (env.LOCALAPPDATA) {
      candidates.push(
        win32.join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"),
      );
    }

    for (const candidate of candidates) {
      if (pathExists(candidate)) return { shell: candidate, args: ["-c"] };
    }

    const bashOnPath = findBashOnPath(platform, pathExists, runCommand, env);
    if (bashOnPath) return { shell: bashOnPath, args: ["-c"] };

    const gitResult = runCommand("where", ["git.exe"]);
    if (gitResult.status === 0) {
      for (const match of gitResult.stdout.split(/\r?\n/)) {
        const gitPath = match.trim();
        if (!win32.isAbsolute(gitPath) || !pathExists(gitPath)) continue;
        const directory = win32.dirname(gitPath);
        // Git for Windows exposes cmd/git.exe or bin/git.exe on PATH.
        if (!/^(cmd|bin)$/i.test(win32.basename(directory))) continue;
        const root = win32.dirname(directory);
        for (const relative of ["bin\\bash.exe", "usr\\bin\\bash.exe"]) {
          const candidate = win32.join(root, relative);
          candidates.push(candidate);
          if (pathExists(candidate)) return { shell: candidate, args: ["-c"] };
        }
      }
    }

    throw new Error(
      `No bash shell found. Options:\n` +
        `  1. Install Git for Windows: https://git-scm.com/download/win\n` +
        `  2. Add bash.exe to PATH (Git Bash, MSYS2, Cygwin, etc.)\n` +
        `  3. Set runtime.shellPath in Nerve settings\n\n` +
        `Searched Git Bash in:\n${candidates.map((path) => `  ${path}`).join("\n")}`,
    );
  }

  // macOS ships an old /bin/bash; prefer a newer bash from PATH.
  if (platform === "darwin") {
    const bashOnPath = findBashOnPath(platform, pathExists, runCommand, env);
    if (bashOnPath) return { shell: bashOnPath, args: ["-c"] };
  }

  if (pathExists("/bin/bash")) return { shell: "/bin/bash", args: ["-c"] };

  if (platform !== "darwin") {
    const bashOnPath = findBashOnPath(platform, pathExists, runCommand, env);
    if (bashOnPath) return { shell: bashOnPath, args: ["-c"] };
  }

  return { shell: "sh", args: ["-c"] };
}
