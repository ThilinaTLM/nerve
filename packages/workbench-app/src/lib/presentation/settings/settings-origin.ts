/** Where a group of settings items comes from. Lists order groups Project, User, other sources, Built-in. */
export type SettingsOrigin =
  | { kind: "project" }
  | { kind: "user" }
  | { kind: "builtin" }
  | { kind: "agent-browser" }
  | { kind: "extension"; name: string };

/** The layer a switch, value or action applies to. */
export type SettingsLayer = "user" | "project";

export const USER_COLUMN_TIP =
  "Your setting. Applies in every project unless the project sets its own.";

export function projectColumnTip(project: string): string {
  return `Only in ${project}. Follows User until you change it here.`;
}

/** Why a project column is disabled: its settings file is not trusted yet. */
export function lockedColumnTip(project: string): string {
  return `Not applied until you review ${project}'s settings file`;
}

export function originLabel(origin: SettingsOrigin, project?: string): string {
  switch (origin.kind) {
    case "project":
      return project ?? "Project";
    case "user":
      return "User";
    case "builtin":
      return "Built-in";
    case "agent-browser":
      return "Agent Browser";
    case "extension":
      return origin.name;
  }
}

export function originTip(origin: SettingsOrigin, project?: string): string {
  switch (origin.kind) {
    case "project": {
      const name = project ?? "the project";
      return `Defined in ${name}'s .nerve folder and shared with everyone who opens the repository. Only exists in ${name}.`;
    }
    case "user":
      return "Defined in your Nerve home. Available in every project.";
    case "builtin":
      return "Comes with Nerve.";
    case "agent-browser":
      return "Provided by Agent Browser.";
    case "extension":
      return `Provided by ${origin.name}.`;
  }
}
