import type {
  AgentRecord,
  ProjectRecord,
  SessionEntry,
  SessionRecord,
} from "@nerve/shared";

export interface ExportedSessionBundle {
  format: "nerve.session.v1";
  exportedAt: string;
  project: ProjectRecord;
  session: SessionRecord;
  agents: AgentRecord[];
  entries: SessionEntry[];
}

export class ExportService {
  constructor(
    private readonly getSession: (sessionId: string) => SessionRecord,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly listAgents: () => AgentRecord[],
    private readonly entriesBySessionId: Map<string, SessionEntry[]>,
  ) {}

  exportSession(sessionId: string): ExportedSessionBundle {
    const session = this.getSession(sessionId);
    const project = this.getProject(session.projectId);
    const agents = this.listAgents().filter(
      (agent) => agent.sessionId === session.id,
    );
    return {
      format: "nerve.session.v1",
      exportedAt: new Date().toISOString(),
      project,
      session,
      agents,
      entries: this.entriesBySessionId.get(session.id) ?? [],
    };
  }

  exportSessionMarkdown(sessionId: string): string {
    const exported = this.exportSession(sessionId);
    return sessionExportMarkdown(exported.session, exported.entries);
  }

  exportSessionHtml(sessionId: string): string {
    const exported = this.exportSession(sessionId);
    return sessionExportHtml(exported.session, exported.entries);
  }
}

export function sessionExportMarkdown(
  session: SessionRecord,
  entries: SessionEntry[],
): string {
  const lines = [
    `# ${session.title}`,
    "",
    `- Session: ${session.id}`,
    `- Mode: ${session.mode}`,
    `- Permission: ${session.permissionLevel}`,
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

export function sessionExportHtml(
  session: SessionRecord,
  entries: SessionEntry[],
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
<title>${escapeHtml(session.title)}</title>
<style>
body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.5;max-width:900px;margin:40px auto;padding:0 24px;color:#0f172a;background:#f8fafc}article{border:1px solid #cbd5e1;border-radius:16px;background:white;padding:20px;margin:16px 0;box-shadow:0 10px 30px rgba(15,23,42,.06)}pre{white-space:pre-wrap;font:inherit}small{color:#64748b}
</style>
</head>
<body>
<h1>${escapeHtml(session.title)}</h1>
<small>${escapeHtml(session.id)} · exported ${new Date().toISOString()}</small>
${body}
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
