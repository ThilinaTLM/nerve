/**
 * Jira, Confluence and daemon payloads are read field by field by the checks
 * that consume them, and a missing field there is the failure being measured,
 * so these reads are deliberately untyped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;
