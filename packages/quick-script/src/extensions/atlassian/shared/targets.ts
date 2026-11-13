/** Normalized resource targets (`<system>:<type>/<id>`) the policy matches on; `jira:project/APP`, `confluence:page/123`. */
const target = (system: string, type: string, id: string | number) =>
  `${system}:${type}/${String(id)}`;

export const jiraProject = (key: string) => target("jira", "project", key);
export const jiraIssue = (key: string) => target("jira", "issue", key);
export const jiraSprint = (id: string | number) => target("jira", "sprint", id);
export const jiraBoard = (id: string | number) => target("jira", "board", id);
export const jiraComment = (id: string | number) =>
  target("jira", "comment", id);
export const jiraAttachment = (id: string | number) =>
  target("jira", "attachment", id);
export const confluenceSpace = (key: string) =>
  target("confluence", "space", key);
export const confluencePage = (id: string | number) =>
  target("confluence", "page", id);
export const confluenceAttachment = (id: string | number) =>
  target("confluence", "attachment", id);
export const confluenceComment = (id: string | number) =>
  target("confluence", "comment", id);

/** A raw request: `jira:request/DELETE /rest/api/3/issue/APP-12`. */
export const rawRequest = (system: "jira" | "confluence", call: string) =>
  target(system, "request", call);

/** Project key of an issue key (`APP-12` -> `APP`), when it has one. */
export function projectOfIssue(key: string): string | undefined {
  return /^([A-Za-z][A-Za-z0-9_]*)-\d+$/.exec(key)?.[1];
}
