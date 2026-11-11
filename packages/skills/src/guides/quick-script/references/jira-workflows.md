# Creating and updating Jira tickets

Projects differ in issue types, workflows, required fields and naming. Learn the conventions first, confirm them with the user, then write. Use one script per step and print compact results.

## 1. Discover

Structure, in one call (`issueType` limits `fields` to one type):

```ts
const p = await jira.projects.get({
  key: "APP",
  include: ["fields", "statuses", "releases", "sprints", "epics"],
});
return {
  types: p.issueTypes,
  components: p.components,
  create: p.createFields,
  statuses: p.statuses,
  releases: p.releases?.slice(0, 8),
  sprints: p.sprints,
  epics: p.epics,
};
```

`createFields` lists each type's fields with `required` and `allowed` values. `boards` lists the boards. Custom fields appear by name; `jira.fields.list()` shows the rest.

Practice, from recent tickets per issue type:

```ts
const sample = await jira.issues.search({
  jql: 'project = APP AND issuetype = "Bug" ORDER BY created DESC',
  fields: [
    "summary",
    "description",
    "labels",
    "components",
    "fixVersions",
    "parent",
    "priority",
  ],
  limit: 10,
});
```

Look at title style, description structure, labels, components, fix version use, parent epic, and how many tickets a sprint holds. For workflows, `jira.issues.get({ key, transitions: true })` on a few tickets in different statuses shows reachable statuses and their `requiredFields`; `statuses` shows the full set per type.

## 2. Summarise and confirm

Tell the user the conventions you found (types and when to use them, required fields, labels/components/epics/versions, sprint rules, status flow) and anything ambiguous. Ask before creating anything. Offer to save them: [project-knowledge.md](project-knowledge.md).

## 3. Write

```ts
const t = await jira.issues.create({
  project: "APP",
  type: "Bug",
  summary: "Export fails for empty reports",
  description: "## Steps\n\n1. Open a report\n2. Export",
  fields: {
    Severity: "S2",
    Components: ["Export"],
    Assignee: "ann@example.com",
    "Fix versions": ["2.4"],
  },
});
await jira.issues.move({ keys: [t.key], sprint: 42 });
```

- `fields` use field names and plain values: users by email or name, options, priority, components and versions by name, Markdown for rich text. A wrong name or value throws and lists the valid ones.
- `issues.update({ key, fields })` replaces the given fields. For adding a single label or similar, use `jira.request` ([jira-raw.md](jira-raw.md)).
- `issues.transition({ key, to: "Done", fields: { Resolution: "Done" } })` takes the status name. A missing required field or unreachable status throws with the choices.
- Links, comments, worklogs and attachments: `issues.link`, `comments.add`, `worklogs.add`, `attachments.upload`.
- Anything else (epic changes, bulk edits, deleting links): [jira-raw.md](jira-raw.md).

Create a few tickets per script, print the keys and URLs, and check with `issues.get` when the fields matter.
