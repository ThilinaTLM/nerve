/** Uniform shape for repository policy rules and their findings. */

/** Tracked, non-ignored source files plus a cached reader. */
export interface SourceInventory {
  repoRoot: string;
  files: string[];
  read(file: string): string;
}

export interface Violation {
  rule: string;
  file: string;
  line?: number;
  message: string;
}

export interface PolicyRule {
  id: string;
  description: string;
  check(inventory: SourceInventory): Violation[];
}

/** Reports one finding; `line` is 1-based when known. */
export type Fail = (file: string, message: string, line?: number) => void;

/** Define a rule whose check reports through a `fail` callback. */
export function defineRule(
  id: string,
  description: string,
  run: (inventory: SourceInventory, fail: Fail) => void,
): PolicyRule {
  return {
    id,
    description,
    check(inventory) {
      const violations: Violation[] = [];
      run(inventory, (file, message, line) =>
        violations.push({ rule: id, file, message, ...(line ? { line } : {}) }),
      );
      return violations;
    },
  };
}

/** Define a rule that inspects every inventoried file independently. */
export function defineFileRule(
  id: string,
  description: string,
  inspect: (file: string, read: () => string) => string[],
): PolicyRule {
  return defineRule(id, description, (inventory, fail) => {
    for (const file of inventory.files)
      for (const message of inspect(file, () => inventory.read(file)))
        fail(file, message);
  });
}

export function formatViolation(violation: Violation): string {
  const location = violation.line
    ? `${violation.file}:${violation.line}`
    : violation.file;
  return `${location}: ${violation.message}`;
}
