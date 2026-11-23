/**
 * The direct `launch` tool was removed; launch definitions are managed through
 * `quick_script` `launches.*` calls. Permission rules that name it drop the
 * name (and the rule when no other tool remains). Plain-JSON shapes only: this
 * must not follow later changes to the evolving contracts. The project
 * permission overlay chain (`permission-overlay` v4) shares it so home and
 * project files drop identically.
 */
type Json = Record<string, unknown>;
export type Loss = (reason: string) => void;

const isRecord = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

const MATCHERS = [
  "primaryArgument",
  "arguments",
  "primaryTarget",
  "targets",
] as const;

const isLaunchRule = (rule: unknown): boolean =>
  isRecord(rule) &&
  isRecord(rule.when) &&
  Array.isArray(rule.when.toolNames) &&
  rule.when.toolNames.includes("launch");

export function dropLaunchToolRules(
  rules: readonly unknown[],
  loss: Loss,
): { rules: unknown[]; changed: boolean } {
  let changed = false;
  const kept: unknown[] = [];
  for (const rule of rules) {
    if (!isLaunchRule(rule)) {
      kept.push(rule);
      continue;
    }
    changed = true;
    const source = rule as Json;
    const when = source.when as Json;
    const names = (when.toolNames as unknown[]).filter(
      (name) => name !== "launch",
    );
    const id = String(source.id);
    if (names.length) {
      const scoped = MATCHERS.some((key) => when[key] !== undefined);
      kept.push({
        ...source,
        ...(scoped ? { enabled: false } : {}),
        when: { ...when, toolNames: names },
      });
      loss(
        scoped
          ? `Permission rule "${id}" named the removed launch tool; the name was dropped and the rule was disabled because its argument or target matchers were written for launch. Review it before enabling. Launches now run through quick_script launches.* calls and are checked as bash commands.`
          : `Permission rule "${id}" named the removed launch tool; the name was dropped and the rule still applies to its other tools. Launches now run through quick_script launches.* calls and are checked as bash commands.`,
      );
    } else
      loss(
        `Permission rule "${id}" named only the removed launch tool and was removed. Launches now run through quick_script launches.* calls and are checked as bash commands.`,
      );
  }
  return { rules: kept, changed };
}

/** A permission overlay document (`overlays[].rules`) or a custom rule set (`rules`). */
export function dropLaunchToolDocument(
  document: unknown,
  loss: Loss,
): { document: unknown; changed: boolean } {
  if (!isRecord(document)) return { document, changed: false };
  let changed = false;
  let result: Json = document;
  if (Array.isArray(document.overlays)) {
    result = {
      ...result,
      overlays: document.overlays.map((overlay: unknown) => {
        if (!isRecord(overlay) || !Array.isArray(overlay.rules)) return overlay;
        const dropped = dropLaunchToolRules(overlay.rules, loss);
        if (!dropped.changed) return overlay;
        changed = true;
        return { ...overlay, rules: dropped.rules };
      }),
    };
  }
  if (Array.isArray(document.rules)) {
    const dropped = dropLaunchToolRules(document.rules, loss);
    if (dropped.changed) {
      changed = true;
      result = { ...result, rules: dropped.rules };
    }
  }
  return { document: changed ? result : document, changed };
}

export const hasLaunchToolRule = (document: unknown): boolean =>
  isRecord(document) &&
  ((Array.isArray(document.rules) && document.rules.some(isLaunchRule)) ||
    (Array.isArray(document.overlays) &&
      document.overlays.some(
        (overlay: unknown) =>
          isRecord(overlay) &&
          Array.isArray(overlay.rules) &&
          overlay.rules.some(isLaunchRule),
      )));
