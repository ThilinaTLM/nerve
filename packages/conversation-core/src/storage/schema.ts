export const coreSchemaV1 = `
CREATE TABLE project (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, directory TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE trusted_resource (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('prompt_suggestion','skill','project_permissions','project_capabilities')),
  project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
  path TEXT NOT NULL, name TEXT, content_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('trusted','rejected')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX trusted_resource_project_path ON trusted_resource(kind, project_id, path) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX trusted_resource_user_path ON trusted_resource(kind, path) WHERE project_id IS NULL;
CREATE TABLE conversation (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  parent_conversation_id TEXT, parent_tool_call_id TEXT, head_event_id TEXT, title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('idle','running','waiting','failed','interrupted')),
  status_event_sequence INTEGER NOT NULL CHECK(status_event_sequence >= 0), status_cleared_at TEXT,
  paused INTEGER NOT NULL CHECK(paused IN (0,1)), next_input_sequence INTEGER NOT NULL CHECK(next_input_sequence > 0),
  pinned_at TEXT, completed_at TEXT, last_user_message_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id, parent_conversation_id) REFERENCES conversation(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(id, head_event_id) REFERENCES conversation_event(conversation_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK(parent_conversation_id IS NULL OR parent_conversation_id <> id)
) STRICT;
CREATE INDEX conversation_project_parent_updated ON conversation(project_id, parent_conversation_id, updated_at, id);
CREATE INDEX conversation_parent ON conversation(parent_conversation_id);
CREATE INDEX conversation_pinned ON conversation(project_id, pinned_at) WHERE pinned_at IS NOT NULL;
CREATE TABLE conversation_config (
  conversation_id TEXT PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
  model TEXT NOT NULL CHECK(json_valid(model)),
  reasoning_level TEXT NOT NULL CHECK(reasoning_level IN ('off','minimal','low','medium','high','xhigh','max')),
  system_prompt TEXT, permission_rule_set_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('planning','coding')),
  enabled_tools TEXT CHECK(enabled_tools IS NULL OR json_valid(enabled_tools)),
  enabled_skills TEXT CHECK(enabled_skills IS NULL OR json_valid(enabled_skills)), working_directory TEXT NOT NULL
) STRICT;
CREATE TABLE conversation_event (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence > 0), previous_event_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('user_message','assistant_message','system_event','tool_call_response','compaction')),
  llm_representation TEXT NOT NULL CHECK(llm_representation IN ('none','user','assistant','tool_result')),
  turn_id TEXT, input_id TEXT, payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL,
  UNIQUE(conversation_id, sequence), UNIQUE(conversation_id, id),
  FOREIGN KEY(conversation_id, previous_event_id) REFERENCES conversation_event(conversation_id, id),
  CHECK(previous_event_id IS NULL OR previous_event_id <> id)
) STRICT;
CREATE INDEX conversation_event_previous ON conversation_event(previous_event_id);
CREATE UNIQUE INDEX conversation_event_input ON conversation_event(input_id) WHERE input_id IS NOT NULL;
CREATE TABLE tool_call (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL, provider_call_id TEXT, assistant_event_id TEXT, content_index INTEGER CHECK(content_index >= 0),
  origin TEXT NOT NULL CHECK(origin IN ('model','user')), tool_name TEXT NOT NULL, arguments TEXT NOT NULL CHECK(json_valid(arguments)),
  state TEXT NOT NULL CHECK(state IN ('supervising','awaiting_approval','ready','running','awaiting_input')),
  supervision TEXT CHECK(supervision IS NULL OR json_valid(supervision)), interaction TEXT CHECK(interaction IS NULL OR json_valid(interaction)),
  execution_claim TEXT, updated_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id, assistant_event_id) REFERENCES conversation_event(conversation_id, id),
  CHECK((origin = 'model' AND provider_call_id IS NOT NULL AND assistant_event_id IS NOT NULL AND content_index IS NOT NULL)
    OR (origin = 'user' AND provider_call_id IS NULL AND assistant_event_id IS NULL AND content_index IS NULL))
) STRICT;
CREATE INDEX tool_call_conversation_turn ON tool_call(conversation_id, turn_id);
CREATE INDEX tool_call_state ON tool_call(state);
CREATE TABLE input_queue (
  input_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  acceptance_sequence INTEGER NOT NULL CHECK(acceptance_sequence > 0),
  source TEXT NOT NULL CHECK(source IN ('user','parent_conversation','system')),
  sender_conversation_id TEXT REFERENCES conversation(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK(json_valid(content)),
  delivery_target TEXT NOT NULL CHECK(delivery_target IN ('next_turn','specific_execution','next_execution')),
  target_execution_id TEXT, command_preparation TEXT CHECK(command_preparation IS NULL OR json_valid(command_preparation)),
  prepared_text TEXT, wake_when_idle INTEGER NOT NULL CHECK(wake_when_idle IN (0,1)), accepted_at TEXT NOT NULL,
  UNIQUE(conversation_id, acceptance_sequence),
  FOREIGN KEY(conversation_id, target_execution_id) REFERENCES conversation_event(conversation_id, id),
  CHECK(delivery_target <> 'specific_execution' OR target_execution_id IS NOT NULL),
  CHECK((source = 'parent_conversation' AND sender_conversation_id IS NOT NULL)
    OR (source <> 'parent_conversation' AND sender_conversation_id IS NULL))
) STRICT;
CREATE TABLE async_bash (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL, command TEXT NOT NULL, working_directory TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','timed_out','cancelled','lost')),
  process_ref TEXT, exit_code INTEGER, started_at TEXT NOT NULL, finished_at TEXT,
  UNIQUE(conversation_id, id)
) STRICT;
CREATE INDEX async_bash_conversation_status ON async_bash(conversation_id, status);
CREATE TABLE asset (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  event_id TEXT, tool_call_id TEXT, async_bash_id TEXT,
  category TEXT NOT NULL CHECK(category IN ('payload','report','image','plan','bash_output')),
  logical_path TEXT NOT NULL, digest TEXT, byte_length INTEGER NOT NULL CHECK(byte_length >= 0), media_type TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id, event_id) REFERENCES conversation_event(conversation_id, id),
  FOREIGN KEY(conversation_id, async_bash_id) REFERENCES async_bash(conversation_id, id)
) STRICT;
CREATE INDEX asset_conversation ON asset(conversation_id);
CREATE INDEX asset_event ON asset(event_id);
CREATE TABLE scratch_note (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX scratch_note_project_updated ON scratch_note(project_id, updated_at, id);
`;
