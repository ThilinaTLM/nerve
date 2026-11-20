import type { AvailableSkill } from "@nervekit/contracts/skills";

/** One row of "In this project" on a user page: what the project has, with its open problems. */
export type ProjectGuide = {
  /** The project page the row opens; the same id as the user page. */
  pageId: string;
  /** Section description: what lives in project settings. */
  description: string;
  title: string;
  /** What the project has, when nothing needs the user. */
  summary?: string;
  /** Pending items, as the row's problem line. */
  problem?: string;
  openLabel: string;
};

const NOUNS: Record<string, string> = {
  agents: "agent profiles",
  "sub-agents": "sub-agent profiles",
  "permission-rules": "permission rules",
  suggestions: "suggestions",
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Guide rows by user page id. Absent pages have nothing in the project to point at. */
export function projectGuides(input: {
  projectName: string;
  /** The project's `skill.list`; only project-source skills count. */
  skills?: readonly AvailableSkill[];
  /** Extensions that come with the project (installed in it). */
  projectExtensions?: number;
  /** Attention items in project scope, per project page id. */
  pending: Readonly<Record<string, number>>;
}): Record<string, ProjectGuide> {
  const { projectName, pending } = input;
  const guides: Record<string, ProjectGuide> = {};

  const projectSkills = (input.skills ?? []).filter(
    (skill) => skill.source === "project",
  );
  if (projectSkills.length) {
    const waiting = projectSkills.filter((skill) => skill.approval).length;
    guides.skills = {
      pageId: "skills",
      description: `Skills that come with ${projectName} are managed in its project settings.`,
      title: `${projectName} · ${plural(projectSkills.length, "project skill", "project skills")}`,
      ...(waiting
        ? {
            problem: `${waiting === 1 ? "1 is" : `${waiting} are`} waiting for your review`,
          }
        : { summary: `${projectSkills.length} approved` }),
      openLabel: `Open ${projectName} skills`,
    };
  }

  const extensions = input.projectExtensions ?? 0;
  const extensionProblems = pending.extensions ?? 0;
  if (extensions > 0 || extensionProblems > 0) {
    guides.extensions = {
      pageId: "extensions",
      description: `Extensions that come with ${projectName} are managed in its project settings.`,
      title: `${projectName} · ${plural(Math.max(extensions, extensionProblems), "project extension", "project extensions")}`,
      ...(extensionProblems
        ? {
            problem: `${plural(extensionProblems, "needs", "need")} your attention`,
          }
        : {}),
      openLabel: `Open ${projectName} extensions`,
    };
  }

  // Without a cheap count of what the project has, the row shows when something there needs the user.
  for (const [pageId, noun] of Object.entries(NOUNS)) {
    const count = pending[pageId] ?? 0;
    if (!count) continue;
    guides[pageId] = {
      pageId,
      description: `The ${noun} that come with ${projectName} are managed in its project settings.`,
      title: `${projectName} · project ${noun}`,
      problem: `${plural(count, "needs", "need")} your attention`,
      openLabel: `Open ${projectName} ${noun}`,
    };
  }
  return guides;
}
