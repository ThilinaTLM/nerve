import { code, line, type ReviewLine } from "./review-lines.js";

export type SkillFile = { path: string; bytes: number; script: boolean };

const DESCRIPTION_MAX = 140;

const cut = (text: string) =>
  text.length > DESCRIPTION_MAX
    ? `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`
    : text;

/** The lines of a skill folder: scripts it may run, how it is offered, what else it reads. */
export function skillLines(input: {
  description: string;
  scope: "user" | "project";
  files: readonly SkillFile[];
}): ReviewLine[] {
  const scripts = input.files.filter((file) => file.script);
  const others = input.files.filter(
    (file) => !file.script && file.path !== "SKILL.md",
  );
  const lines: ReviewLine[] = [];
  if (scripts.length > 0)
    lines.push(
      line(
        `May run ${scripts.length === 1 ? "a script" : "scripts"}: ${scripts
          .slice(0, 3)
          .map((file) => code(file.path))
          .join(
            ", ",
          )}${scripts.length > 3 ? ` and ${scripts.length - 3} more` : ""}`,
        true,
        scripts.length === 1 ? "May run a script" : "May run scripts",
      ),
    );
  lines.push(
    line(
      `Offered to agents in ${input.scope === "user" ? "every project" : "this project"} as “${cut(input.description)}”`,
      false,
      "Offered to agents",
    ),
  );
  if (others.length > 0)
    lines.push(
      line(
        `Reads ${others.length === 1 ? "a file" : `${others.length} files`} that ${others.length === 1 ? "comes" : "come"} with it`,
        false,
        "Comes with files",
      ),
    );
  return lines;
}
