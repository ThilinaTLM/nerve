import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Resolve bundled skills and tool guides without exposing guides in the catalog. */
export function builtinSkillFilePath(name: string): string | undefined {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return undefined;
  for (const segment of ["builtin", "guides"]) {
    const path = fileURLToPath(
      new URL(`./${segment}/${name}/SKILL.md`, import.meta.url),
    );
    if (existsSync(path)) return path;
  }
  return undefined;
}

export function resolveSkillPlaceholders(text: string): string {
  return text.replace(
    /\{\{skill:([^{}]+)\}\}/g,
    (placeholder, name: string) => builtinSkillFilePath(name) ?? placeholder,
  );
}
