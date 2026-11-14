import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Resolve a bundled skill's `SKILL.md`. */
export function builtinSkillFilePath(name: string): string | undefined {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return undefined;
  const path = fileURLToPath(
    new URL(`./builtin/${name}/SKILL.md`, import.meta.url),
  );
  return existsSync(path) ? path : undefined;
}

export function resolveSkillPlaceholders(text: string): string {
  return text.replace(
    /\{\{skill:([^{}]+)\}\}/g,
    (placeholder, name: string) => builtinSkillFilePath(name) ?? placeholder,
  );
}
