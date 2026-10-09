import { capabilityOverridesDocumentSchema } from "@nervekit/contracts/capabilities";
import { createId } from "@nervekit/contracts";
import {
  conversationChannelOperations,
  type ConversationEvent,
} from "@nervekit/contracts/core";
import {
  conversationStream,
  parseConversationStream,
  type EventEnvelope,
} from "@nervekit/contracts/events";
import {
  STREAM_SUBSCRIPTION_CAPABILITY,
  type ProtocolV1Message,
} from "@nervekit/contracts/wire";
import { slashCommandCompletionItems } from "@nervekit/contracts/completions";
import { listAvailableModels } from "@nervekit/harness/models";
import { allToolDescriptors } from "@nervekit/tools/catalog";
import { createMessageFactory, ProtocolConnection } from "@nervekit/protocol";
import { ProtocolServerSession } from "@nervekit/protocol/server";
import {
  RpcDispatcher,
  type OperationHandlerRegistry,
} from "@nervekit/protocol/rpc";
import {
  websocketTransport,
  type WebSocketLike,
} from "@nervekit/protocol/adapters";
import { ZodError } from "zod";
import type WebSocket from "ws";
import type { ServerAdapterContexts } from "../../app/bootstrap/create-server-adapter-contexts.js";
import { listAvailableSkills } from "../../core-host/resource-loader.js";
import { listPermissionRuleSets } from "../../core-host/permission-rule-sets.js";
import { orchestratorSource } from "./messages.js";
import { PROTOCOL_HEARTBEAT, PROTOCOL_SESSION_LIMITS } from "./constants.js";
import type { LocalProtocolSession } from "./protocol-websocket.js";

type ChannelContext = ServerAdapterContexts["websocket"];
const capabilities = [
  "encoding.json",
  "event.notify",
  STREAM_SUBSCRIPTION_CAPABILITY,
  ...conversationChannelOperations.map(
    (operation) => operation.requiredCapability,
  ),
];

function eventEnvelope(event: ConversationEvent): EventEnvelope {
  return {
    seq: event.sequence,
    id: event.id,
    ts: event.createdAt,
    type: "conversation.event",
    data: event,
  };
}

export function createConversationProtocolSession(
  ws: WebSocket,
  state: ChannelContext,
  onDispose: () => void,
): LocalProtocolSession {
  const core = state.conversationCore;
  const platform = state.operationContexts.platform;
  const projects = new Set<string>();
  const activatingStreams = new Set<string>();
  // Remember only ownership for deletion notices: the core row is gone when the notice arrives.
  const owners = new Map<string, string>();
  for (const project of core.projects.list())
    for (const conversation of core.listConversations({
      projectId: project.id,
    }))
      owners.set(conversation.id, project.id);
  const peer = orchestratorSource(state.daemonId);
  const messages = createMessageFactory({
    source: peer,
    target: { role: "ui" },
  });
  const transport = websocketTransport(ws as unknown as WebSocketLike);
  let unsubscribe = () => {};
  let disposed = false;
  let resolveClosed = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    session.dispose();
    connection.dispose();
    onDispose();
    resolveClosed();
  };
  const failed = (error: unknown) => {
    void state.logger.warn("Conversation channel failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    void connection
      .close(1011, "conversation_channel_error")
      .finally(dispose)
      .catch(() => undefined);
  };
  const bounds = (stream: string) => {
    const id = parseConversationStream(stream);
    if (!id) throw new Error("Unknown conversation stream");
    const snapshot = core.getSnapshot(id);
    owners.set(id, snapshot.conversation.projectId);
    projects.add(snapshot.conversation.projectId);
    const latestSeq = snapshot.lastSequence;
    return { stream, latestSeq, earliestAvailableSeq: 0 };
  };
  const handlers = {
    "capabilities.get": ({ projectId, conversationId }) => {
      projects.add(projectId);
      return state.capabilities.configuration(projectId, conversationId);
    },
    "capabilities.update": ({ replace, ...input }) =>
      state.capabilities.update({
        ...input,
        ...(replace !== undefined
          ? { replace: capabilityOverridesDocumentSchema.parse(replace) }
          : {}),
      }),
    "capabilities.reset": (input) => state.capabilities.reset(input),
    "capabilities.trust": ({ projectId, digest }) =>
      state.capabilities.trust(projectId, digest),
    "project.create": (input) => {
      const project = core.projects.create(input);
      projects.add(project.id);
      return project;
    },
    "project.list": () => {
      const rows = core.projects.list();
      for (const row of rows) projects.add(row.id);
      return rows;
    },
    "project.get": ({ projectId }) => {
      projects.add(projectId);
      return core.projects.get(projectId);
    },
    "project.update": ({ projectId, patch }) =>
      core.projects.update(projectId, patch),
    "project.delete": async ({ projectId }) => {
      await core.projects.delete(projectId);
      return null;
    },
    "trust.list": ({ projectId, kind }) => core.trust.list(projectId, kind),
    "trust.decide": (input) => core.trust.decide(input),
    "trust.delete": ({ trustedResourceId }) => {
      state.capabilities.deleteTrust(trustedResourceId);
      return null;
    },
    "conversation.create": async (input) => {
      projects.add(input.projectId);
      const snapshot = await core.createConversation(input);
      owners.set(input.id, input.projectId);
      return snapshot;
    },
    "conversation.list": (input) => {
      projects.add(input.projectId);
      return core.listConversations(input);
    },
    "conversation.getSnapshot": ({ conversationId }) =>
      core.getSnapshot(conversationId),
    "conversation.getHistory": ({ conversationId, ...page }) =>
      core.getHistory(conversationId, page),
    "conversation.getTree": ({ conversationId }) =>
      core.getTree(conversationId),
    "conversation.getEventsSince": ({ conversationId, sequence }) =>
      core.getEventsSince(conversationId, sequence),
    "conversation.configure": ({ conversationId, patch }) => {
      core.configure(conversationId, patch);
      return null;
    },
    "conversation.update": ({ conversationId, patch }) => {
      core.update(conversationId, patch);
      return null;
    },
    "conversation.selectHead": ({ conversationId, eventId }) => {
      core.selectHead(conversationId, eventId);
      return null;
    },
    "conversation.compact": async ({ conversationId }) => {
      await core.compact(conversationId);
      return null;
    },
    "conversation.delete": async ({ conversationId }) => {
      await core.delete(conversationId);
      return null;
    },
    "conversation.pause": ({ conversationId }) => {
      core.pause(conversationId);
      return null;
    },
    "conversation.resume": ({ conversationId }) => {
      core.resume(conversationId);
      return null;
    },
    "conversation.stop": async ({ conversationId }) => {
      await core.stop(conversationId);
      return null;
    },
    "conversation.forcePush": async ({ conversationId }) => {
      await core.forcePush(conversationId);
      return null;
    },
    "conversation.continue": ({ conversationId }) => {
      core.continue(conversationId);
      return null;
    },
    "input.submit": async (input) => {
      await core.submitInput(input);
      return null;
    },
    "input.cancel": ({ inputId }) => {
      core.cancelInput(inputId);
      return null;
    },
    "interaction.resolve": async (input) => {
      await core.resolveInteraction(input);
      return null;
    },
    "asyncBash.cancel": async ({ bashId }) => {
      await core.cancelAsyncBash(bashId);
      return null;
    },
    "model.list": async () => ({
      models: listAvailableModels(
        await platform.providerCatalog.resolvedModelsWithCredentials((name) =>
          platform.secrets.get(name),
        ),
      ).map((model) => ({
        ...model,
        label: `${model.name} (${model.provider})`,
      })),
    }),
    "permissionRuleSet.list": async () => ({
      ruleSets: await listPermissionRuleSets(platform.storage.paths.home),
    }),
    "skill.list": ({ projectId } = {}) => {
      const project = projectId ? core.projects.get(projectId) : null;
      if (projectId && !project) throw new Error("Project not found");
      return listAvailableSkills(project?.directory, {
        storageHome: platform.storage.paths.home,
        nerveSkills: platform.nerveSkills.skills,
        agentBrowserSkills: platform.agentBrowserSkills.skills,
      });
    },
    "tool.list": () => ({ tools: allToolDescriptors }),
    "completion.slash.list": () => ({ items: slashCommandCompletionItems }),
  } satisfies Partial<OperationHandlerRegistry>;
  const session: ProtocolServerSession = new ProtocolServerSession({
    acceptingPeer: peer,
    allowedPeerRoles: ["ui"],
    createMessage: messages,
    capabilities,
    limits: PROTOCOL_SESSION_LIMITS,
    heartbeat: PROTOCOL_HEARTBEAT,
    sessionId: () => `ses_${crypto.randomUUID()}`,
    send: (message) => connection.send(message as ProtocolV1Message),
    close: (code, reason) => transport.close(code, reason),
    rpcDispatcher: ({ capabilities: acceptedCapabilities }) =>
      new RpcDispatcher({
        handlers,
        acceptedCapabilities,
        sessionContext: true,
        translateError: (error) => ({
          code:
            error instanceof ZodError
              ? "DOMAIN_VALIDATION_FAILED"
              : "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Operation failed",
          retryable: false,
        }),
      }),
    subscriptions: {
      resolve(cursors) {
        const streams = [];
        for (const cursor of cursors) {
          try {
            streams.push(bounds(cursor.stream));
            activatingStreams.add(cursor.stream);
          } catch {
            /* Unknown/deleted conversations are unavailable independently. */
          }
        }
        return { accepted: true, streams };
      },
      activate(_cursors, states) {
        // Cover appends between bounds resolution and stream activation. While
        // activating, the feed is suppressed; these facts come from the core log.
        for (const state of states) {
          const id = parseConversationStream(state.stream)!;
          for (const event of core.getEventsSince(id, state.latestSeq))
            void session
              .publish(state.stream, eventEnvelope(event))
              .catch(failed);
        }
        activatingStreams.clear();
      },
    },
    readStream(stream, fromSeq, limit) {
      const state = bounds(stream);
      const id = parseConversationStream(stream)!;
      return {
        ...state,
        events: core
          .getEventsSince(id, Math.max(0, fromSeq - 1))
          .slice(0, limit)
          .map(eventEnvelope),
      };
    },
  });
  const connection: ProtocolConnection = new ProtocolConnection({
    transport,
    onMessage: (message) => session.receive(message),
    onProtocolError: () => {
      void connection
        .close(1002, "protocol_error")
        .finally(dispose)
        .catch(() => undefined);
    },
    onError: failed,
  });
  const notify = (type: string, data: unknown) =>
    session
      .notify({ id: createId("evt"), ts: new Date().toISOString(), type, data })
      .catch(failed);
  const unsubscribeCapabilities = state.capabilities.subscribe((change) => {
    if (projects.has(change.projectId))
      void notify("capabilities.changed", change);
  });
  const unsubscribeSettings = state.events.subscribeNotify((event) => {
    if (event.type === "settings.updated")
      for (const projectId of projects)
        void notify("capabilities.changed", { projectId });
  });
  const unsubscribeCore = core.subscribe((change) => {
    switch (change.kind) {
      case "event_appended":
        if (activatingStreams.has(conversationStream(change.conversationId)))
          break;
        void session
          .publish(
            conversationStream(change.conversationId),
            eventEnvelope(change.event),
          )
          .catch(failed);
        break;
      case "conversation_changed": {
        const projectId = change.summary.projectId;
        owners.set(change.summary.id, projectId);
        if (projects.has(projectId))
          void notify("conversation.changed", {
            projectId,
            summary: change.summary,
          });
        break;
      }
      case "conversation_deleted": {
        const projectId = owners.get(change.conversationId);
        owners.delete(change.conversationId);
        if (projectId && projects.has(projectId))
          void notify("conversation.deleted", {
            projectId,
            conversationId: change.conversationId,
          });
        session.removeStream(conversationStream(change.conversationId));
        break;
      }
      case "head_changed":
        void notify("conversation.head", {
          conversationId: change.conversationId,
          headEventId: change.headEventId,
        });
        break;
      case "config_changed":
        void notify("conversation.config", {
          conversationId: change.conversationId,
          config: change.config,
        });
        break;
      case "tool_call_changed":
        void notify("conversation.toolCall", {
          conversationId: change.conversationId,
          toolCall: change.toolCall,
        });
        break;
      case "queue_changed":
        void notify("conversation.queue", {
          conversationId: change.conversationId,
          queue: change.queue,
        });
        break;
      case "async_bash_changed":
        void notify("conversation.asyncBash", {
          conversationId: change.conversationId,
          asyncBash: change.asyncBash,
        });
        break;
      case "live":
        void notify("conversation.live", {
          conversationId: change.conversationId,
          delta: change.delta,
        });
        break;
    }
  });
  unsubscribe = () => {
    unsubscribeCapabilities();
    unsubscribeSettings();
    unsubscribeCore();
  };
  return {
    closed,
    dispose,
    async shutdown(message = "Daemon shutting down") {
      if (disposed) return;
      unsubscribe();
      try {
        await session.shutdown("server_shutdown", message);
        await connection.close(1001, message);
      } finally {
        dispose();
      }
    },
  };
}
