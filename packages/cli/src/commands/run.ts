import { readDaemonConnection } from "../daemon/connection.js";
import { apiPost } from "../daemon/http-client.js";

export async function commandRun(args: string[]): Promise<void> {
  const dir = args[0] && !args[0].startsWith("-") ? args[0] : process.cwd();
  const promptParts = dir === args[0] ? args.slice(1) : args;
  const prompt = promptParts.join(" ").trim();

  const { project } = await apiPost<{ project: { id: string; name: string } }>(
    "/api/projects",
    { dir },
  );
  const { conversation } = await apiPost<{ conversation: { id: string } }>(
    "/api/conversations",
    { projectId: project.id, title: `CLI run: ${project.name}` },
  );
  const { agent } = await apiPost<{ agent: { id: string } }>("/api/agents", {
    projectId: project.id,
    conversationId: conversation.id,
  });

  console.log(`project: ${project.id}`);
  console.log(`conversation: ${conversation.id}`);
  console.log(`agent: ${agent.id}`);

  if (!prompt) {
    console.log(
      "No prompt supplied. Open the UI or pass prompt text after the directory.",
    );
    return;
  }

  await streamPrompt(agent.id, prompt);
}

async function streamPrompt(agentId: string, prompt: string): Promise<void> {
  const connection = await readDaemonConnection();
  const wsUrl = new URL(connection.url);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.pathname = "/ws";
  wsUrl.searchParams.set("token", connection.token);

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let done = false;
    socket.addEventListener("open", () => {
      apiPost(`/api/agents/${agentId}/prompt`, { text: prompt }).catch(reject);
    });
    socket.addEventListener("message", (message) => {
      const event = JSON.parse(String(message.data)) as {
        type?: string;
        data?: {
          agentId?: string;
          kind?: string;
          delta?: string;
          message?: string;
          aborted?: boolean;
        };
      };
      if (event.data?.agentId !== agentId) return;
      if (
        event.type === "conversation.live.content.delta" &&
        event.data.kind === "text"
      ) {
        process.stdout.write(event.data.delta ?? "");
      }
      if (event.type === "conversation.run.completed") {
        done = true;
        process.stdout.write("\n");
        socket.close();
        resolve();
      }
      if (event.type === "conversation.run.failed") {
        done = true;
        socket.close();
        if (event.data.aborted) resolve();
        else reject(new Error(event.data?.message ?? "Agent error"));
      }
    });
    socket.addEventListener("error", () =>
      reject(new Error("WebSocket error")),
    );
    socket.addEventListener("close", () => {
      if (!done) reject(new Error("WebSocket closed before completion"));
    });
  });
}
