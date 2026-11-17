/** One thing wrong with an extension project, written for an agent: what, where, and how to fix it. */
export type Problem = {
  what: string;
  where: string;
  fix: string;
};

export function formatProblem(problem: Problem): string {
  return `error: ${problem.what}\n  where: ${problem.where}\n  fix: ${problem.fix}`;
}

/** Thrown by the build and `init`; the CLI prints every problem and exits 1. */
export class ExtensionProjectError extends Error {
  readonly problems: Problem[];
  constructor(problems: Problem | Problem[]) {
    const list = Array.isArray(problems) ? problems : [problems];
    super(list.map(formatProblem).join("\n"));
    this.name = "ExtensionProjectError";
    this.problems = list;
  }
}
