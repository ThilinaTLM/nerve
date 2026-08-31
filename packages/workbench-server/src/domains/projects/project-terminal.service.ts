import type { ChildProcess, SpawnOptions } from "node:child_process";
import {
  locateExecutable,
  type ResolvedExecutable,
  spawnExecutable,
} from "@nervekit/tools/execution";
import type { ExternalTerminalStatus } from "@nervekit/contracts/status";
import type {
  OpenProjectInTerminalRequest,
  OpenProjectInTerminalResponse,
  ProjectRecord,
} from "@nervekit/contracts/projects";
import { ApplicationError } from "../../core/application-error.js";
import { resolveProjectLaunchTarget } from "./project-launch-target.js";

type TerminalLauncher = {
  source: NonNullable<ExternalTerminalStatus["source"]>;
  executable: string;
  command: ResolvedExecutable | string;
  argsForDir: (dir: string) => string[];
  windowsHide: boolean;
};

type SpawnCommand = (
  command: ResolvedExecutable | string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

type ProjectTerminalServiceOptions = {
  platform?: NodeJS.Platform;
  locate?: typeof locateExecutable;
  spawnCommand?: SpawnCommand;
  comspec?: string;
};

const LINUX_TERMINALS = [
  "xdg-terminal-exec",
  "x-terminal-emulator",
  "kgx",
  "gnome-terminal",
  "konsole",
  "xfce4-terminal",
  "mate-terminal",
  "tilix",
  "kitty",
  "alacritty",
  "wezterm",
  "foot",
  "xterm",
] as const;

export class ProjectTerminalService {
  private readonly platform: NodeJS.Platform;
  private readonly locate: typeof locateExecutable;
  private readonly spawnCommand: SpawnCommand;
  private readonly comspec: string;
  private launcher?: TerminalLauncher;
  private status: ExternalTerminalStatus = unavailableStatus();

  constructor(
    private readonly getProject: (projectId: string) => ProjectRecord,
    options: ProjectTerminalServiceOptions = {},
  ) {
    this.platform = options.platform ?? process.platform;
    this.locate = options.locate ?? locateExecutable;
    this.spawnCommand =
      options.spawnCommand ??
      ((command, args, spawnOptions) =>
        spawnExecutable(command, args, spawnOptions));
    this.comspec = options.comspec ?? process.env.ComSpec ?? "cmd.exe";
  }

  async refresh(): Promise<ExternalTerminalStatus> {
    this.launcher = await this.discover();
    this.status = this.launcher
      ? {
          available: true,
          source: this.launcher.source,
          executable: this.launcher.executable,
        }
      : unavailableStatus();
    return this.statusSnapshot();
  }

  statusSnapshot(): ExternalTerminalStatus {
    return { ...this.status };
  }

  async openProject(
    projectId: string,
    request: OpenProjectInTerminalRequest,
  ): Promise<OpenProjectInTerminalResponse> {
    const project = this.getProject(projectId);
    const dir = await resolveProjectLaunchTarget(project, request.path, {
      directory: true,
    });
    const launcher = this.launcher ?? (await this.refreshLauncher());
    if (!launcher) {
      throw new ApplicationError(
        404,
        "TERMINAL_NOT_AVAILABLE",
        "A supported terminal launcher is not available on this installation.",
      );
    }

    try {
      const child = this.spawnCommand(
        launcher.command,
        launcher.argsForDir(dir),
        {
          cwd: dir,
          detached: true,
          stdio: "ignore",
          windowsHide: launcher.windowsHide,
        },
      );
      child.once("error", () => undefined);
      child.unref();
    } catch (error) {
      throw new ApplicationError(
        500,
        "TERMINAL_OPEN_FAILED",
        error instanceof Error ? error.message : "Could not open terminal.",
      );
    }

    return { projectId: project.id, dir };
  }

  private async refreshLauncher(): Promise<TerminalLauncher | undefined> {
    const launcher = await this.discover();
    this.launcher = launcher;
    this.status = launcher
      ? {
          available: true,
          source: launcher.source,
          executable: launcher.executable,
        }
      : unavailableStatus();
    return launcher;
  }

  private async discover(): Promise<TerminalLauncher | undefined> {
    if (this.platform === "win32") {
      return {
        source: "system",
        executable: this.comspec,
        command: this.comspec,
        argsForDir: () => ["/K"],
        windowsHide: false,
      };
    }

    if (this.platform === "darwin") {
      const open = await this.locate("/usr/bin/open");
      if (!open) return undefined;
      return {
        source: "system",
        executable: open.path,
        command: open,
        argsForDir: (dir) => ["-a", "Terminal", dir],
        windowsHide: true,
      };
    }

    if (this.platform === "linux") {
      for (const command of LINUX_TERMINALS) {
        const executable = await this.locate(command);
        if (!executable) continue;
        return {
          source:
            command === "xdg-terminal-exec" || command === "x-terminal-emulator"
              ? "path"
              : "known_path",
          executable: executable.path,
          command: executable,
          argsForDir: () => [],
          windowsHide: true,
        };
      }
    }

    return undefined;
  }
}

function unavailableStatus(): ExternalTerminalStatus {
  return {
    available: false,
    error: "Supported terminal launcher not found.",
  };
}
