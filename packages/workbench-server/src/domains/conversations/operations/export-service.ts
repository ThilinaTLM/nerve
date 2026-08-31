import type { AgentRecord } from "@nervekit/contracts/agents";
import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import { escapeHtml } from "../../../adapters/http/html.js";

export interface ExportedConversationBundle {
  format: "nerve.conversation.v1";
  exportedAt: string;
  project: ProjectRecord;
  conversation: ConversationRecord;
  agents: AgentRecord[];
  entries: ConversationEntry[];
}

export class ExportService {
  constructor(
    private readonly getConversation: (
      conversationId: string,
    ) => ConversationRecord,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly listAgents: () => AgentRecord[],
    private readonly getConversationEntries: (
      conversationId: string,
    ) => Promise<ConversationEntry[]>,
  ) {}

  async exportConversation(
    conversationId: string,
  ): Promise<ExportedConversationBundle> {
    const conversation = this.getConversation(conversationId);
    const project = this.getProject(conversation.projectId);
    const agents = this.listAgents().filter(
      (agent) => agent.conversationId === conversation.id,
    );
    return {
      format: "nerve.conversation.v1",
      exportedAt: new Date().toISOString(),
      project,
      conversation,
      agents,
      entries: await this.getConversationEntries(conversation.id),
    };
  }

  async exportConversationMarkdown(conversationId: string): Promise<string> {
    const exported = await this.exportConversation(conversationId);
    return conversationExportMarkdown(exported.conversation, exported.entries);
  }

  async exportConversationHtml(conversationId: string): Promise<string> {
    const exported = await this.exportConversation(conversationId);
    return conversationExportHtml(exported.conversation, exported.entries);
  }
}

export function conversationExportMarkdown(
  conversation: ConversationRecord,
  entries: ConversationEntry[],
): string {
  const lines = [
    `# ${conversation.title}`,
    "",
    `- Conversation: ${conversation.id}`,
    `- Mode: ${conversation.mode}`,
    `- Permission: ${conversation.permissionLevel}`,
    `- Exported: ${new Date().toISOString()}`,
    "",
  ];
  for (const entry of entries) {
    const label =
      entry.kind && entry.kind !== "message"
        ? `${entry.role} / ${entry.kind.replace("_", " ")}`
        : entry.role;
    lines.push(`## ${label}`, "", entry.text, "");
  }
  return `${lines.join("\n").trim()}\n`;
}

export function conversationExportHtml(
  conversation: ConversationRecord,
  entries: ConversationEntry[],
): string {
  const body = entries
    .map((entry) => {
      const label =
        entry.kind && entry.kind !== "message"
          ? `${entry.role} / ${entry.kind.replace("_", " ")}`
          : entry.role;
      return `<article><h2>${escapeHtml(label)}</h2><pre>${escapeHtml(entry.text)}</pre></article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(conversation.title)}</title>
<style>
body{font-family:Geist,ui-sans-serif,system-ui,sans-serif;line-height:1.5;max-width:900px;margin:40px auto;padding:0 24px;color:#0f172a;background:#f8fafc}article{border:1px solid #cbd5e1;border-radius:16px;background:white;padding:20px;margin:16px 0;box-shadow:0 10px 30px rgba(15,23,42,.06)}pre{white-space:pre-wrap;font:inherit}small{color:#64748b}
</style>
</head>
<body>
<h1>${escapeHtml(conversation.title)}</h1>
<small>${escapeHtml(conversation.id)} · exported ${new Date().toISOString()}</small>
${body}
</body>
</html>`;
}
