import type {
  MobileInboxItem,
  MobileInboxModel,
} from "$lib/presentation/shell";
import { workspaceSelectors } from "$lib/application/workspace";
export function mobileInboxModel(): MobileInboxModel {
  const rows: MobileInboxItem[] = workspaceSelectors.conversations.map(
    (row) => {
      const activity = workspaceSelectors.conversationActivityById[row.id];
      return {
        id: row.id,
        conversationId: row.id,
        title: row.title,
        kind:
          row.status === "running"
            ? "running"
            : row.status === "waiting"
              ? "question"
              : row.status === "failed" || row.status === "interrupted"
                ? "error"
                : "recent",
        kindLabel: row.status === "waiting" ? "Needs attention" : row.status,
        detail: activity?.label ?? "",
        projectLabel: workspaceSelectors.projects.find(
          (project) => project.id === row.projectId,
        )?.name,
        tone: activity?.tone ?? "neutral",
        pulse: activity?.pulse ?? false,
        at: row.updatedAt,
      };
    },
  );
  return {
    needsYou: rows.filter(
      (row) => row.kind === "question" || row.kind === "error",
    ),
    running: rows.filter((row) => row.kind === "running"),
    awaitingAsync: [],
    recent: rows
      .filter((row) => row.kind === "recent")
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
      .slice(0, 8),
  };
}
