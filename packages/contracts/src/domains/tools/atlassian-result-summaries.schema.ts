import { z } from "zod";

export const jiraTextDisplaySchema = z.string().max(500);

export const jiraIssueSummarySchema = z
  .object({
    key: z.string().min(1),
    id: z.string().optional(),
    summary: jiraTextDisplaySchema.optional(),
    issueType: jiraTextDisplaySchema.optional(),
    status: jiraTextDisplaySchema.optional(),
    statusCategory: jiraTextDisplaySchema.optional(),
    assignee: jiraTextDisplaySchema.optional(),
    priority: jiraTextDisplaySchema.optional(),
    created: jiraTextDisplaySchema.optional(),
    updated: jiraTextDisplaySchema.optional(),
    resolution: jiraTextDisplaySchema.optional(),
    resolutionDate: jiraTextDisplaySchema.optional(),
    dueDate: jiraTextDisplaySchema.optional(),
    descriptionPreview: jiraTextDisplaySchema.optional(),
  })
  .passthrough();
export type JiraIssueSummaryPayload = z.infer<typeof jiraIssueSummarySchema>;

export const jiraProjectSummarySchema = z
  .object({
    key: z.string().min(1),
    id: z.string().optional(),
    name: jiraTextDisplaySchema.optional(),
    projectTypeKey: jiraTextDisplaySchema.optional(),
    lead: jiraTextDisplaySchema.optional(),
  })
  .passthrough();
export type JiraProjectSummaryPayload = z.infer<
  typeof jiraProjectSummarySchema
>;

export const jiraTransitionSummarySchema = z
  .object({
    id: z.string().min(1),
    name: jiraTextDisplaySchema.optional(),
    to: jiraTextDisplaySchema.optional(),
    toStatusCategory: jiraTextDisplaySchema.optional(),
  })
  .passthrough();
export type JiraTransitionSummaryPayload = z.infer<
  typeof jiraTransitionSummarySchema
>;

export const jiraUserSummarySchema = z
  .object({
    accountId: z.string().min(1),
    displayName: jiraTextDisplaySchema.optional(),
    emailAddress: jiraTextDisplaySchema.optional(),
    active: z.boolean().optional(),
    accountType: jiraTextDisplaySchema.optional(),
  })
  .passthrough();
export type JiraUserSummaryPayload = z.infer<typeof jiraUserSummarySchema>;

export const jiraFieldSummarySchema = z
  .object({
    id: z.string().min(1),
    name: jiraTextDisplaySchema.optional(),
    key: jiraTextDisplaySchema.optional(),
    required: z.boolean().optional(),
    type: jiraTextDisplaySchema.optional(),
    custom: z.boolean().optional(),
    allowedValues: z.array(jiraTextDisplaySchema).optional(),
  })
  .passthrough();
export type JiraFieldSummaryPayload = z.infer<typeof jiraFieldSummarySchema>;

export const jiraBoardSummarySchema = z
  .object({
    id: z.string().min(1),
    name: jiraTextDisplaySchema.optional(),
    type: jiraTextDisplaySchema.optional(),
    projectKey: jiraTextDisplaySchema.optional(),
    projectName: jiraTextDisplaySchema.optional(),
  })
  .passthrough();
export type JiraBoardSummaryPayload = z.infer<typeof jiraBoardSummarySchema>;

export const jiraSprintSummarySchema = z
  .object({
    id: z.string().min(1),
    name: jiraTextDisplaySchema.optional(),
    state: jiraTextDisplaySchema.optional(),
    goal: jiraTextDisplaySchema.optional(),
    startDate: jiraTextDisplaySchema.optional(),
    endDate: jiraTextDisplaySchema.optional(),
    completeDate: jiraTextDisplaySchema.optional(),
    originBoardId: z.string().optional(),
  })
  .passthrough();
export type JiraSprintSummaryPayload = z.infer<typeof jiraSprintSummarySchema>;

export const jiraAttachmentSummarySchema = z
  .object({
    id: z.string().optional(),
    filename: jiraTextDisplaySchema.optional(),
    mediaType: jiraTextDisplaySchema.optional(),
    bytes: z.number().int().nonnegative().optional(),
    author: jiraTextDisplaySchema.optional(),
    created: jiraTextDisplaySchema.optional(),
    path: z.string().optional(),
  })
  .passthrough();
export type JiraAttachmentSummaryPayload = z.infer<
  typeof jiraAttachmentSummarySchema
>;

export const jiraCommentSummarySchema = z
  .object({
    id: z.string().optional(),
    author: jiraTextDisplaySchema.optional(),
    bodyPreview: jiraTextDisplaySchema.optional(),
    visibility: jiraTextDisplaySchema.optional(),
    created: jiraTextDisplaySchema.optional(),
    updated: jiraTextDisplaySchema.optional(),
  })
  .passthrough();
export type JiraCommentSummaryPayload = z.infer<
  typeof jiraCommentSummarySchema
>;

export const jiraWorklogSummarySchema = z
  .object({
    id: z.string().optional(),
    author: jiraTextDisplaySchema.optional(),
    timeSpent: jiraTextDisplaySchema.optional(),
    timeSpentSeconds: z.number().int().nonnegative().optional(),
    started: jiraTextDisplaySchema.optional(),
    commentPreview: jiraTextDisplaySchema.optional(),
  })
  .passthrough();
export type JiraWorklogSummaryPayload = z.infer<
  typeof jiraWorklogSummarySchema
>;

export const jiraChangelogSummarySchema = z
  .object({
    id: z.string().optional(),
    author: jiraTextDisplaySchema.optional(),
    created: jiraTextDisplaySchema.optional(),
    changes: z.array(jiraTextDisplaySchema).max(3).optional(),
  })
  .passthrough();
export type JiraChangelogSummaryPayload = z.infer<
  typeof jiraChangelogSummarySchema
>;

export const jiraRemoteLinkSummarySchema = z
  .object({
    id: z.string().optional(),
    title: jiraTextDisplaySchema.optional(),
    url: z.string().optional(),
    relationship: jiraTextDisplaySchema.optional(),
  })
  .passthrough();
export type JiraRemoteLinkSummaryPayload = z.infer<
  typeof jiraRemoteLinkSummarySchema
>;

export const jiraIssueLinkSummarySchema = z
  .object({
    id: z.string().optional(),
    issueKey: z.string().optional(),
    otherIssueKey: z.string().optional(),
    linkType: jiraTextDisplaySchema.optional(),
    direction: z.enum(["outward", "inward"]).optional(),
  })
  .passthrough();
export type JiraIssueLinkSummaryPayload = z.infer<
  typeof jiraIssueLinkSummarySchema
>;

export const confluenceTextDisplaySchema = z.string().max(500);

export const confluenceSpaceSummarySchema = z
  .object({
    id: z.string().min(1),
    key: confluenceTextDisplaySchema.optional(),
    name: confluenceTextDisplaySchema.optional(),
    type: confluenceTextDisplaySchema.optional(),
    status: confluenceTextDisplaySchema.optional(),
    homepageId: z.string().optional(),
  })
  .passthrough();
export type ConfluenceSpaceSummaryPayload = z.infer<
  typeof confluenceSpaceSummarySchema
>;

export const confluencePageSummarySchema = z
  .object({
    id: z.string().min(1),
    title: confluenceTextDisplaySchema.optional(),
    spaceId: z.string().optional(),
    spaceKey: confluenceTextDisplaySchema.optional(),
    parentId: z.string().optional(),
    status: confluenceTextDisplaySchema.optional(),
    versionNumber: z.number().int().nonnegative().optional(),
    created: confluenceTextDisplaySchema.optional(),
    updated: confluenceTextDisplaySchema.optional(),
    bodyPreview: confluenceTextDisplaySchema.optional(),
    webui: z.string().optional(),
    webUrl: z.string().optional(),
    storagePath: z.string().optional(),
    markdownPath: z.string().optional(),
    attachmentDir: z.string().optional(),
  })
  .passthrough();
export type ConfluencePageSummaryPayload = z.infer<
  typeof confluencePageSummarySchema
>;

export const confluenceAttachmentSummarySchema = z
  .object({
    id: z.string().optional(),
    fileId: z.string().optional(),
    filename: confluenceTextDisplaySchema.optional(),
    title: confluenceTextDisplaySchema.optional(),
    mediaType: confluenceTextDisplaySchema.optional(),
    fileSize: z.number().int().nonnegative().optional(),
    versionNumber: z.number().int().nonnegative().optional(),
    downloadLink: z.string().optional(),
    path: z.string().optional(),
    snippet: z.string().optional(),
  })
  .passthrough();
export type ConfluenceAttachmentSummaryPayload = z.infer<
  typeof confluenceAttachmentSummarySchema
>;

export const confluenceCommentSummarySchema = z
  .object({
    id: z.string().optional(),
    pageId: z.string().optional(),
    kind: z.enum(["footer", "inline"]).optional(),
    author: confluenceTextDisplaySchema.optional(),
    bodyPreview: confluenceTextDisplaySchema.optional(),
    resolutionStatus: confluenceTextDisplaySchema.optional(),
    versionNumber: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type ConfluenceCommentSummaryPayload = z.infer<
  typeof confluenceCommentSummarySchema
>;

export const confluencePropertySummarySchema = z
  .object({
    id: z.string().optional(),
    key: confluenceTextDisplaySchema,
    versionNumber: z.number().int().nonnegative().optional(),
    valuePreview: confluenceTextDisplaySchema.optional(),
  })
  .passthrough();
export type ConfluencePropertySummaryPayload = z.infer<
  typeof confluencePropertySummarySchema
>;

export const confluenceLabelSummarySchema = z
  .object({
    name: confluenceTextDisplaySchema,
    prefix: confluenceTextDisplaySchema.optional(),
  })
  .passthrough();
export type ConfluenceLabelSummaryPayload = z.infer<
  typeof confluenceLabelSummarySchema
>;

export const confluenceRestrictionSummarySchema = z
  .object({
    operation: z.enum(["read", "update"]),
    subjectType: z.enum(["user", "group"]).optional(),
    subjectId: z.string().optional(),
  })
  .passthrough();
export type ConfluenceRestrictionSummaryPayload = z.infer<
  typeof confluenceRestrictionSummarySchema
>;
