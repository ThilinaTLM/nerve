import type { ChildProcess, SpawnOptions } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  locateExecutable,
  type ResolvedExecutable,
  spawnExecutable,
} from "@nervekit/tools";
import type {
  ExternalEditorStatus,
  ExternalEditorStatuses,
} from "@nervekit/contracts/status";
import type {
  OpenProjectInEditorRequest,
  OpenProjectInEditorResponse,
  ProjectEditor,
  ProjectRecord,
} from "@nervekit/contracts/projects";
import { ApplicationError } from "../../core/application-error.js";
import { resolveProjectLaunchTarget } from "./project-launch-target.js";

type EditorLauncherSource = NonNullable<ExternalEditorStatus["source"]>;

type EditorLauncher = {
  editor: ProjectEditor;
  source: EditorLauncherSource;
  executable: string;
  command: ResolvedExecutable | string;
  argsForDir: (dir: string) => string[];
};

type SpawnCommand = (
  command: ResolvedExecutable | string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

type EditorDefinition = {
  editor: ProjectEditor;
  displayName: string;
  pathCommands: string[];
  macAppName: string;
  macAppPaths: () => string[];
  linuxKnownPaths: () => string[];
  windowsKnownPaths: () => string[];
};

type ProjectEditorServiceOptions = {
  spawnCommand?: SpawnCommand;
  locate?: typeof locateExecutable;
};

const EDITOR_ORDER: ProjectEditor[] = ["vscode", "zed"];
function joinIfBase(base: string | undefined, ...segments: string[]): string {
  return base ? join(base, ...segments) : "";
}

const EDITORS: Record<ProjectEditor, EditorDefinition> = {
  vscode: {
    editor: "vscode",
    displayName: "VS Code",
    pathCommands: ["code"],
    macAppName: "Visual Studio Code",
    macAppPaths: () => [
      "/Applications/Visual Studio Code.app",
      join(homedir(), "Applications", "Visual Studio Code.app"),
    ],
    linuxKnownPaths: () => [
      "/usr/bin/code",
      "/usr/local/bin/code",
      "/snap/bin/code",
      "/usr/share/code/bin/code",
      join(homedir(), ".local", "bin", "code"),
    ],
    windowsKnownPaths: () => [
      joinIfBase(
        process.env.LOCALAPPDATA,
        "Programs",
        "Microsoft VS Code",
        "Code.exe",
      ),
      joinIfBase(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
      joinIfBase(
        process.env["ProgramFiles(x86)"],
        "Microsoft VS Code",
        "Code.exe",
      ),
    ],
  },
  zed: {
    editor: "zed",
    displayName: "Zed",
    pathCommands: ["zed"],
    macAppName: "Zed",
    macAppPaths: () => [
      "/Applications/Zed.app",
      join(homedir(), "Applications", "Zed.app"),
    ],
    linuxKnownPaths: () => [
      "/usr/bin/zed",
      "/usr/local/bin/zed",
      "/opt/zed/zed",
      "/snap/bin/zed",
      join(homedir(), ".local", "bin", "zed"),
    ],
    windowsKnownPaths: () => [
      joinIfBase(process.env.LOCALAPPDATA, "Programs", "Zed", "Zed.exe"),
      joinIfBase(process.env.ProgramFiles, "Zed", "Zed.exe"),
      joinIfBase(process.env["ProgramFiles(x86)"], "Zed", "Zed.exe"),
    ],
  },
};

export class ProjectEditorService {
  private readonly spawnCommand: SpawnCommand;
  private readonly locate: typeof locateExecutable;
  private launchers: Partial<Record<ProjectEditor, EditorLauncher>> = {};
  private statuses: ExternalEditorStatuses = unavailableStatuses();

  constructor(
    private readonly getProject: (projectId: string) => ProjectRecord,
    options: ProjectEditorServiceOptions = {},
  ) {
    this.spawnCommand =
      options.spawnCommand ??
      ((command, args, spawnOptions) =>
        spawnExecutable(command, args, spawnOptions));
    this.locate = options.locate ?? locateExecutable;
  }

  async refresh(): Promise<ExternalEditorStatuses> {
    const entries = await Promise.all(
      EDITOR_ORDER.map(
        async (editor) => [editor, await this.discoverEditor(editor)] as const,
      ),
    );
    const launchers: Partial<Record<ProjectEditor, EditorLauncher>> = {};
    const statuses = unavailableStatuses();
    for (const [editor, launcher] of entries) {
      if (!launcher) {
        statuses[editor] = unavailableStatus(EDITORS[editor]);
        continue;
      }
      launchers[editor] = launcher;
      statuses[editor] = {
        available: true,
        source: launcher.source,
        executable: launcher.executable,
      };
    }
    this.launchers = launchers;
    this.statuses = statuses;
    return this.statusSnapshot();
  }

  statusSnapshot(): ExternalEditorStatuses {
    return cloneStatuses(this.statuses);
  }

  async openProject(
    projectId: string,
    request: OpenProjectInEditorRequest,
  ): Promise<OpenProjectInEditorResponse> {
    const project = this.getProject(projectId);
    const { editor } = request;
    const launcher =
      this.launchers[editor] ?? (await this.refreshEditor(editor));
    if (!launcher) {
      throw new ApplicationError(
        404,
        "EDITOR_NOT_AVAILABLE",
        `${EDITORS[editor].displayName} is not available on this installation.`,
      );
    }

    const target = await resolveProjectLaunchTarget(project, request.path);
    try {
      const child = this.spawnCommand(
        launcher.command,
        launcher.argsForDir(target),
        {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        },
      );
      child.once("error", () => undefined);
      child.unref();
    } catch (error) {
      throw new ApplicationError(
        500,
        "EDITOR_OPEN_FAILED",
        error instanceof Error
          ? error.message
          : `Could not open ${EDITORS[editor].displayName}.`,
      );
    }

    return { projectId: project.id, editor, path: target };
  }

  private async refreshEditor(
    editor: ProjectEditor,
  ): Promise<EditorLauncher | undefined> {
    const launcher = await this.discoverEditor(editor);
    if (launcher) {
      this.launchers = { ...this.launchers, [editor]: launcher };
      this.statuses = {
        ...this.statuses,
        [editor]: {
          available: true,
          source: launcher.source,
          executable: launcher.executable,
        },
      };
      return launcher;
    }

    const launchers = { ...this.launchers };
    delete launchers[editor];
    this.launchers = launchers;
    this.statuses = {
      ...this.statuses,
      [editor]: unavailableStatus(EDITORS[editor]),
    };
    return undefined;
  }

  private async discoverEditor(
    editor: ProjectEditor,
  ): Promise<EditorLauncher | undefined> {
    const definition = EDITORS[editor];
    for (const command of definition.pathCommands) {
      const executable = await this.locate(command);
      if (executable) {
        return commandLauncher(definition, "path", executable);
      }
    }

    if (process.platform === "darwin") {
      for (const appPath of definition.macAppPaths()) {
        if (await pathExists(appPath)) {
          return {
            editor,
            source: "app",
            executable: appPath,
            command: "/usr/bin/open",
            argsForDir: (dir) => ["-a", definition.macAppName, dir],
          };
        }
      }
    }

    for (const path of platformKnownPaths(definition)) {
      if (!path) continue;
      const executable = await this.locate(path);
      if (executable) {
        return commandLauncher(definition, "known_path", executable);
      }
    }

    return undefined;
  }
}

function unavailableStatuses(): ExternalEditorStatuses {
  return {
    vscode: unavailableStatus(EDITORS.vscode),
    zed: unavailableStatus(EDITORS.zed),
  };
}

function unavailableStatus(definition: EditorDefinition): ExternalEditorStatus {
  return {
    available: false,
    error: `${definition.displayName} launcher not found.`,
  };
}

function cloneStatuses(
  statuses: ExternalEditorStatuses,
): ExternalEditorStatuses {
  return {
    vscode: { ...statuses.vscode },
    zed: { ...statuses.zed },
  };
}

function commandLauncher(
  definition: EditorDefinition,
  source: EditorLauncherSource,
  executable: ResolvedExecutable,
): EditorLauncher {
  return {
    editor: definition.editor,
    source,
    executable: executable.path,
    command: executable,
    argsForDir: (dir) => [dir],
  };
}

function platformKnownPaths(definition: EditorDefinition): string[] {
  if (process.platform === "win32") return definition.windowsKnownPaths();
  if (process.platform === "linux") return definition.linuxKnownPaths();
  return [];
}

async function pathExists(
  path: string,
  mode: number = constants.F_OK,
): Promise<boolean> {
  if (!path) return false;
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}
