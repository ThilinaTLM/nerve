# nerve API Protocol

This document sketches the initial orchestrator protocol.

## Transport

Use HTTP for commands/queries and WebSocket for live events.

```txt
HTTP      CLI/browser/API clients -> orchestrator commands/queries
WebSocket orchestrator -> clients live events and replay
```

The orchestrator should serve the web app and API from the same origin in local mode.

Default local binding:

```txt
127.0.0.1:<port>
```

## Core concepts

```ts
type Mode = "planning" | "coding";
type PermissionLevel = "autonomous" | "supervised" | "read_only";

type WorkerKind = "local";
type WorkerStatus = "online" | "offline" | "error";

type ToolRisk =
  | "read"
  | "plan_write"
  | "workspace_write"
  | "command"
  | "network"
  | "secret"
  | "destructive"
  | "agent_spawn"
  | "deployment";
```

Mode defines the agent objective. Permission level defines autonomy. The orchestrator enforces the effective policy.

Durable entity ids use prefixed ULIDs:

```txt
proj_01...
ses_01...
agent_01...
run_01...
proc_01...
evt_01...
```

## Event envelope

All WebSocket and replayed events use a common envelope.

```ts
interface EventEnvelope<T = unknown> {
  seq: number;
  id: string; // evt_<ulid>
  ts: string;
  type: string;
  data: T;
}
```

Event types are namespaced, for example:

```txt
daemon.started
session.created
agent.started
agent.message_delta
process.log
approval.requested
```

## HTTP endpoints

### Daemon/status

```txt
GET /api/status
```

Response:

```ts
interface StatusResponse {
  daemonId: string;
  version: string;
  startedAt: string;
  dataDir: string;
  storage: {
    home: string;
    sqlitePath: string;
    indexHealthy: boolean;
  };
}
```

### Settings and storage

```txt
GET  /api/settings
PUT  /api/settings
GET  /api/storage
POST /api/storage/rebuild-index
```

Settings response/body should contain readable non-secret settings only.

```ts
interface Settings {
  defaultMode: Mode;
  defaultPermissionLevel: PermissionLevel;
  defaultSubagentMode: Mode;
  defaultSubagentPermissionLevel: PermissionLevel;
  server: {
    host: string;
    port: number;
    allowRemote: boolean;
  };
  ui: {
    theme: "system" | "light" | "dark";
  };
  compaction: {
    auto: boolean;
    thresholdTokens: number;
    keepRecentTokens: number;
  };
}
```

Storage response:

```ts
interface StorageInfo {
  dataDir: string;
  sqlitePath: string;
  configPath: string;
  counts?: {
    projects: number;
    sessions: number;
    agents: number;
    processes: number;
  };
}
```

### Provider keys and local auth metadata

Secret values are never returned by the API.

```txt
GET    /api/provider-keys
PUT    /api/provider-keys
DELETE /api/provider-keys/:provider
```

Provider key metadata:

```ts
interface ProviderKeyMetadata {
  provider: string;
  envVar: string;
  configured: boolean;
}
```

Set provider key body:

```ts
interface SetProviderKeyRequest {
  provider: string;
  apiKey: string;
}
```

### Projects

```txt
POST   /api/projects
GET    /api/projects
GET    /api/projects/:projectId
DELETE /api/projects/:projectId
```

Create body:

```ts
interface CreateProjectRequest {
  dir: string;
  name?: string;
}
```

### Composer completions

```txt
GET /api/projects/:projectId/path-completions?q=<query>
GET /api/commands
```

Path completion response:

```ts
interface PathCompletion {
  path: string;
  kind: "file" | "directory";
  label: string;
}
```

Slash command response:

```ts
interface SlashCommand {
  id: string;
  name: string;
  description: string;
  args?: Array<{ name: string; required?: boolean; description?: string }>;
}
```

Future completion endpoints may include symbols, agents, sessions, and prompt templates.

### Sessions

```txt
POST   /api/sessions
POST   /api/import/session
GET    /api/sessions
GET    /api/sessions/:sessionId
GET    /api/sessions/:sessionId/messages
GET    /api/sessions/:sessionId/tree
GET    /api/sessions/:sessionId/export
GET    /api/sessions/:sessionId/export.md
GET    /api/sessions/:sessionId/export.html
POST   /api/sessions/:sessionId/navigate
POST   /api/sessions/:sessionId/compact
DELETE /api/sessions/:sessionId
```

Create body:

```ts
interface CreateSessionRequest {
  projectId: string;
  title?: string;
  mode?: Mode;
  permissionLevel?: PermissionLevel;
}
```

### Agents

```txt
POST  /api/agents
GET   /api/agents
GET   /api/agents/:agentId
PATCH /api/agents/:agentId
POST  /api/agents/:agentId/prompt
POST  /api/agents/:agentId/steer
POST  /api/agents/:agentId/follow-up
POST  /api/agents/:agentId/abort
POST  /api/agents/:agentId/mode
POST  /api/agents/:agentId/permission
```

Create body:

```ts
interface CreateAgentRequest {
  sessionId: string;
  projectId: string;
  projectDir?: string;
  workerId?: string;
  parentAgentId?: string;
  task?: string;
  mode?: Mode;
  permissionLevel?: PermissionLevel;
  workspaceScope?: {
    roots: string[];
    readonly?: boolean;
  };
  budget?: {
    depth?: number;
    maxDepth?: number;
    maxRuns?: number;
    usedRuns?: number;
  };
  model?: {
    provider: string;
    modelId: string;
  };
}
```

Prompt body:

```ts
interface PromptRequest {
  text: string;
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
  behavior?: "reject-if-busy" | "steer" | "follow-up";
}
```

Set mode body:

```ts
interface SetModeRequest {
  mode: Mode;
}
```

Set permission body:

```ts
interface SetPermissionRequest {
  permissionLevel: PermissionLevel;
}
```

### Messages and tree

```txt
GET  /api/sessions/:sessionId/messages
GET  /api/sessions/:sessionId/tree
POST /api/sessions/:sessionId/navigate
POST /api/sessions/:sessionId/compact
POST /api/sessions/:sessionId/label
```

Navigate body may set `summarize: true` to append a branch-summary entry for the abandoned branch before moving the active leaf. Compact body may include `instructions` and `keepRecentTokens`; the orchestrator appends a durable compaction entry and updates the harness session mirror.

```ts
interface SessionEntry {
  id: string;
  role: "user" | "assistant" | "system";
  kind: "message" | "compaction" | "branch_summary" | "subagent_summary";
  text: string;
  summary?: string;
  tokensBefore?: number;
  firstKeptEntryId?: string;
  fromEntryId?: string;
}
```

### Models

```txt
GET  /api/models
GET  /api/models/active
POST /api/models/active
POST /api/thinking-level
```

### Tool calls and approvals

```txt
GET  /api/tools
GET  /api/tool-calls
GET  /api/tool-calls/:toolCallId
POST /api/agents/:agentId/tools
GET  /api/approvals
GET  /api/approvals/:approvalId
POST /api/approvals/:approvalId/grant
POST /api/approvals/:approvalId/deny
```

Approval decision body:

```ts
interface ApprovalDecisionRequest {
  message?: string;
  rememberForSession?: boolean;
}
```

Policy evaluation shape:

```ts
interface PolicyEvaluation {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
  mode: Mode;
  permissionLevel: PermissionLevel;
  toolRisk: ToolRisk;
}
```

### Workers

```txt
GET /api/workers
GET /api/workers/:workerId
```

Initial worker records are local-only:

```ts
interface WorkerRecord {
  id: string;
  kind: WorkerKind;
  name: string;
  status: WorkerStatus;
  capabilities: Array<"agent" | "process">;
  endpoint?: {
    pid?: number;
    host?: string;
    port?: number;
  };
  createdAt: string;
  updatedAt: string;
}
```

### Background processes

```txt
POST /api/processes
GET  /api/processes
GET  /api/processes/:processId
POST /api/processes/:processId/stop
POST /api/processes/:processId/restart
GET  /api/processes/:processId/logs
```

Start body:

```ts
interface StartProcessRequest {
  name?: string;
  workerId?: string;
  projectId?: string;
  sessionId?: string;
  agentId?: string;
  cwd: string;
  command: string;
  env?: Record<string, string>; // used for spawn only; not persisted in process.json
  readyPattern?: string;
  readyOnUrl?: boolean;
  readyTimeoutMs?: number;
}
```

Process records are durable under `proc/<process-id>/process.json` and include the selected `workerId`, status, readiness outcome, owner refs, command, cwd, timestamps, exit metadata, and log paths.

Logs query:

```ts
interface ProcessLogQuery {
  mode?: "recent" | "errors" | "warnings" | "since_cursor" | "first_failure";
  sinceSeq?: number;
  contains?: string;
  regex?: string;
  contextLines?: number;
  limit?: number;
}
```

Log query responses include structured stdout/stderr events with `seq`, `ts`, `stream`, `level`, and `line`, plus `nextCursor` for incremental reads.

### Child agents / sub-agents

Sub-agents are normal agents with `parentAgentId` and `rootAgentId`. The first implementation exposes child delegation through the tool-call API with `toolName: "subagent_run"`; direct `POST /api/agents` with `parentAgentId` can also create a child when it stays within parent authority.

```txt
POST /api/agents/:agentId/tools
```

Tool body:

```ts
interface SubagentRunArgs {
  task: string;
  mode?: Mode; // default: planning
  permissionLevel?: PermissionLevel; // default: read_only
  workspaceRoots?: string[]; // must remain inside parent workspace scope
}
```

Result:

```ts
interface SubagentRunResult {
  agent: AgentRecord;
  summary: string;
}
```

Agent budget metadata:

```ts
interface AgentBudget {
  depth: number;
  maxDepth: number;
  maxRuns: number;
  usedRuns: number;
}
```

Rules:

- default child mode is `planning` and default permission is `read_only`
- child authority cannot exceed parent authority unless the `subagent_run` tool call is approved by the user
- child workspace roots cannot exceed parent workspace scope
- parent budget enforces child depth and child run count
- aborting a parent propagates abort requests to descendants

### Events

```txt
GET /api/events?since=<seq>
```

The WebSocket supports the same replay cursor:

```txt
/ws?since=1234
```

## WebSocket events

WebSocket messages carry the `EventEnvelope` shape described above. The following types describe event `type` values and their `data` payloads.

### Agent events

```ts
type AgentEvent =
  | { type: "agent.started"; agentId: string; runId: string }
  | { type: "agent.status_changed"; agentId: string; status: string }
  | { type: "agent.message_complete"; agentId: string; runId: string; sessionId: string; entry: unknown }
  | { type: "agent.error"; agentId: string; runId: string; message: string; aborted?: boolean }
  | { type: "agent.cancelled"; agentId: string }
  | { type: "agent.mode_changed"; agentId: string; mode: Mode }
  | { type: "agent.permission_changed"; agentId: string; permissionLevel: PermissionLevel }
  | { type: "agent.turn_started"; agentId: string; sessionId: string }
  | { type: "agent.turn_ended"; agentId: string; sessionId: string }
  | { type: "agent.message_started"; agentId: string; message: unknown }
  | { type: "agent.message_delta"; agentId: string; delta: string }
  | { type: "agent.thinking_delta"; agentId: string; delta: string }
  | { type: "agent.message_ended"; agentId: string; message: unknown };
```

### Tool and policy events

```ts
type ToolEvent =
  | {
      type: "agent.tool_call.requested";
      agentId: string;
      toolCallId: string;
      toolName: string;
      toolRisk: ToolRisk;
      args: unknown;
    }
  | {
      type: "policy.evaluated";
      agentId: string;
      toolCallId: string;
      evaluation: PolicyEvaluation;
    }
  | {
      type: "agent.tool_call.started";
      agentId: string;
      toolCallId: string;
    }
  | {
      type: "agent.tool_call.updated";
      agentId: string;
      toolCallId: string;
      partial: unknown;
    }
  | {
      type: "agent.tool_call.completed";
      agentId: string;
      toolCallId: string;
      result: unknown;
      isError: boolean;
    }
  | {
      type: "agent.tool_call.denied";
      agentId: string;
      toolCallId: string;
      reason: string;
    };
```

### Approval events

```ts
type ApprovalEvent =
  | {
      type: "approval.requested";
      approvalId: string;
      agentId: string;
      toolCallId: string;
      reason: string;
    }
  | { type: "approval.granted"; approvalId: string; agentId: string; toolCallId: string }
  | { type: "approval.denied"; approvalId: string; agentId: string; toolCallId: string; reason?: string };
```

### Session/project events

```ts
type SessionEvent =
  | { type: "project.created"; projectId: string; dir: string }
  | { type: "session.created"; sessionId: string; projectId: string }
  | { type: "session.updated"; sessionId: string }
  | { type: "session.tree_updated"; sessionId: string }
  | { type: "session.navigated"; sessionId: string; activeEntryId?: string }
  | { type: "session.compacted"; sessionId: string; entry: SessionEntry }
  | { type: "session.branch_summarized"; sessionId: string; entry: SessionEntry }
  | { type: "model.changed"; agentId?: string; sessionId?: string; provider: string; modelId: string };
```

### Process events

```ts
type ProcessEvent =
  | { type: "process.started"; processId: string; ownerAgentId?: string; name?: string }
  | { type: "process.log"; processId: string; stream: "stdout" | "stderr"; line: string }
  | { type: "process.ready"; processId: string; urls?: string[] }
  | { type: "process.exited"; processId: string; exitCode: number | null }
  | { type: "process.stopped"; processId: string };
```

### Child-agent events

```ts
type ChildAgentEvent =
  | { type: "agent.subagent_started"; parentAgentId: string; childAgentId: string; task: string }
  | { type: "agent.subagent_completed"; parentAgentId: string; childAgentId: string; summary: string };
```

## Event replay

The WebSocket should support reconnect with last seen sequence:

```txt
/ws?since=1234
```

The orchestrator should keep a bounded event buffer for fast replay and persist durable events for full recovery. Durable session state remains the source of truth; the event buffer is for UI continuity.

## Error shape

HTTP errors should return:

```ts
interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

Common policy errors:

```txt
POLICY_DENIED
APPROVAL_REQUIRED
WORKSPACE_SCOPE_VIOLATION
MODE_RESTRICTION
PERMISSION_RESTRICTION
```
