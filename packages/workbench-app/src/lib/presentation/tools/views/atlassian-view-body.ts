import type { ToolView } from "./tool-view-types";

type JiraView = Extract<ToolView, { kind: "jira" }>;
type ConfluenceView = Extract<ToolView, { kind: "confluence" }>;

export type AtlassianBannerModel = {
  text: string;
  tone: "success" | "info" | "default";
};

/**
 * Pure view models for the rich Jira/Confluence tool bodies. Kept out of the
 * Svelte components so the outcome wording and the structured/fallback split
 * stay unit-testable under the node test runner.
 */

function banner(
  text: string,
  dryRun: boolean | undefined,
): AtlassianBannerModel {
  return { text, tone: dryRun ? "info" : "success" };
}

/** One-line mutation outcome for a completed Jira call, if any. */
export function jiraBanner(
  view: JiraView,
  status: string | undefined,
): AtlassianBannerModel | undefined {
  if (status !== "completed") return undefined;
  switch (view.action) {
    case "create_issue": {
      if (view.dryRun) {
        return banner(
          view.issueKey
            ? `Dry run — would create ${view.issueKey}`
            : "Dry run — would create issue",
          true,
        );
      }
      if (!view.issueKey) return undefined;
      const summary = view.summary ? ` · ${view.summary}` : "";
      return banner(`Created ${view.issueKey}${summary}`, false);
    }
    case "update_issue": {
      if (!view.issueKey) return undefined;
      if (view.dryRun) {
        return banner(`Dry run — would update ${view.issueKey}`, true);
      }
      const updated = view.updatedFieldCount ?? view.updatedFields?.length;
      const fields =
        updated !== undefined
          ? ` · ${updated} field${updated === 1 ? "" : "s"}`
          : "";
      return banner(`Updated ${view.issueKey}${fields}`, false);
    }
    case "add_comment": {
      if (!view.issueKey) return undefined;
      const id = view.commentId ? ` · id ${view.commentId}` : "";
      return banner(`Comment added to ${view.issueKey}${id}`, false);
    }
    case "transition_issue": {
      if (!view.transition || !view.issueKey) return undefined;
      return view.dryRun
        ? banner(`Dry run — would transition ${view.issueKey}`, true)
        : banner(`Transitioned ${view.issueKey}`, false);
    }
    default:
      return undefined;
  }
}

/** One-line outcome for a completed Confluence call, if any. */
export function confluenceBanner(
  view: ConfluenceView,
  status: string | undefined,
): AtlassianBannerModel | undefined {
  if (status !== "completed") return undefined;
  switch (view.action) {
    case "create_page": {
      const title = view.title ?? view.page?.title;
      if (view.dryRun) {
        return banner(
          title
            ? `Dry run — would create page "${title}"`
            : "Dry run — would create page",
          true,
        );
      }
      return title ? banner(`Created page "${title}"`, false) : undefined;
    }
    case "update_page": {
      const title = view.title ?? view.page?.title;
      if (view.dryRun) {
        return banner(
          title
            ? `Dry run — would update page "${title}"`
            : "Dry run — would update page",
          true,
        );
      }
      if (!title) return undefined;
      const version = view.page?.versionNumber;
      const suffix = version !== undefined ? ` · v${version}` : "";
      return banner(`Updated page "${title}"${suffix}`, false);
    }
    case "upload_attachment": {
      const name = view.attachment?.filename ?? view.attachment?.title;
      return name ? banner(`Uploaded ${name}`, view.dryRun) : undefined;
    }
    case "download_pages": {
      const count = view.pageCount ?? view.pages.length;
      if (count <= 0) return undefined;
      return banner(`Downloaded ${count} page${count === 1 ? "" : "s"}`, false);
    }
    case "publish_pages": {
      const count = view.outcomeCount ?? view.outcomes.length;
      if (count <= 0) return undefined;
      const pages = `${count} page${count === 1 ? "" : "s"}`;
      return view.dryRun
        ? banner(`Dry run — ${pages}`, true)
        : banner(`Published ${pages}`, false);
    }
    default:
      return undefined;
  }
}

/**
 * Friendly empty state for completed searches that explicitly returned zero
 * results. Text-only historical records (no explicit count) fall back to the
 * text summary instead.
 */
export function jiraEmptyMessage(
  view: JiraView,
  status: string | undefined,
): string | undefined {
  if (status !== "completed") return undefined;
  if (view.action === "search_issues" && view.issueCount === 0) {
    return "No issues found.";
  }
  if (view.action === "search_users" && view.userCount === 0) {
    return "No users found.";
  }
  return undefined;
}

/** Confluence counterpart of {@link jiraEmptyMessage}. */
export function confluenceEmptyMessage(
  view: ConfluenceView,
  status: string | undefined,
): string | undefined {
  if (status !== "completed") return undefined;
  if (view.action === "search_pages" && view.pageCount === 0) {
    return "No pages found.";
  }
  if (view.action === "search_spaces" && view.spaceCount === 0) {
    return "No spaces found.";
  }
  return undefined;
}

/** Whether the Jira view carries structured data worth rich rendering. */
export function hasStructuredJira(
  view: JiraView,
  status: string | undefined,
): boolean {
  return Boolean(
    view.issue ||
    view.issues.length > 0 ||
    view.users.length > 0 ||
    view.project ||
    view.transitions.length > 0 ||
    view.fields.length > 0 ||
    view.commentId ||
    view.updatedFields?.length ||
    view.updatedFieldCount !== undefined ||
    view.includedCounts ||
    view.resolvedAssignee ||
    jiraBanner(view, status) ||
    jiraEmptyMessage(view, status),
  );
}

/** Whether the Confluence view carries structured data worth rich rendering. */
export function hasStructuredConfluence(
  view: ConfluenceView,
  status: string | undefined,
): boolean {
  return Boolean(
    view.page ||
    view.pages.length > 0 ||
    view.space ||
    view.spaces.length > 0 ||
    view.attachment ||
    view.attachments.length > 0 ||
    view.outcomes.length > 0 ||
    view.includedCounts ||
    view.downloadDir ||
    confluenceBanner(view, status) ||
    confluenceEmptyMessage(view, status),
  );
}
