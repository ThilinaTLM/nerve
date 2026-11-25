/**
 * Demo skills. A personal skill lives under the Nerve home; Aurora's team skills live in the
 * project's `.nerve/skills/` and show the three trust states of Settings → Skills.
 */

type DemoSkill = {
  name: string;
  description: string;
  /** Files of the skill folder by relative path. */
  files: Record<string, string>;
};

function skill(name: string, description: string, body: string, extra = {}) {
  return {
    name,
    description,
    files: {
      "SKILL.md": `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
      ...extra,
    },
  };
}

export const DEMO_USER_SKILLS: DemoSkill[] = [
  skill(
    "commit-style",
    "Use when writing a commit message. Imperative subject under 60 characters, then the reason.",
    "# Commit style\n\n1. Write the subject in the imperative mood.\n2. Explain why the change is needed in the body.\n",
  ),
];

export const DEMO_PROJECT_SKILLS: (DemoSkill & {
  decision: "trusted" | "needs_review" | "rejected";
})[] = [
  {
    ...skill(
      "release-notes",
      "Use when drafting Aurora release notes from the AUR Jira project into the REL Confluence space.",
      "# Release notes\n\n1. Search Jira for issues of the fix version.\n2. Group them by type.\n3. Create the page in REL.\n",
    ),
    decision: "trusted",
  },
  {
    ...skill(
      "rollout-checklist",
      "Use before enabling a feature on QA or production, to check flags, dashboards and the rollback note.",
      "# Rollout checklist\n\n- Enable the flag on QA first.\n- Watch the booking error rate for an hour.\n- Write the rollback note.\n",
    ),
    decision: "needs_review",
  },
  {
    ...skill(
      "seed-venues",
      "Use when a local database needs the demo venues.",
      "# Seed venues\n\nRun `scripts/seed.sh` from aurora-api.\n",
      { "scripts/seed.sh": "#!/bin/sh\necho 'Seeding 12 demo venues'\n" },
    ),
    decision: "rejected",
  },
];
