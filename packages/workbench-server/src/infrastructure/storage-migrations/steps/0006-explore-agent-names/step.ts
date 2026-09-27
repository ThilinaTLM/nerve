import { defineSchemaStep } from "../../kit/define-step/v1.js";

const SQL = `WITH valid_agent_docs AS (
  SELECT document_id,
    CASE WHEN json_valid(CAST(data AS TEXT))
      THEN CASE WHEN json_type(CAST(data AS TEXT)) = 'object'
        THEN CAST(data AS TEXT) END END AS json
  FROM domain_documents
  WHERE namespace = 'agent' AND scope_id = 'global'
),
agent_docs AS (
  SELECT document_id,
    json_extract(json, '$.conversationId') AS conversation_id,
    json_extract(json, '$.parentAgentId') AS parent_id,
    json_extract(json, '$.task') AS task
  FROM valid_agent_docs
  WHERE json IS NOT NULL
    AND json_extract(json, '$.parentAgentId') IS NOT NULL
    AND json_extract(json, '$.executionKind') IS NULL
    AND json_extract(json, '$.name') IS NULL
),
valid_tool_records AS (
  SELECT conversation_id, sequence,
    CASE WHEN json_valid(CAST(data AS TEXT))
      THEN CASE WHEN json_type(CAST(data AS TEXT)) = 'object'
        THEN CAST(data AS TEXT) END END AS json
  FROM conversation_records
  WHERE kind = 'tool_call'
),
explore_tasks AS (
  SELECT agent_docs.document_id, valid_tool_records.sequence,
    CASE WHEN json_valid(task.value)
      THEN CASE WHEN json_type(task.value) = 'object'
        THEN task.value END END AS json
  FROM agent_docs
  JOIN valid_tool_records
    ON valid_tool_records.conversation_id = agent_docs.conversation_id
    AND valid_tool_records.json IS NOT NULL
    AND json_extract(valid_tool_records.json, '$.toolName') = 'explore'
    AND json_extract(valid_tool_records.json, '$.agentId') = agent_docs.parent_id
  JOIN json_each(CASE
    WHEN json_type(valid_tool_records.json, '$.args.tasks') = 'array'
    THEN valid_tool_records.json ELSE '{"args":{"tasks":[]}}' END, '$.args.tasks') AS task
),
explore_labels AS (
  SELECT agent_docs.document_id,
    substr(trim(json_extract(explore_tasks.json, '$.label')), 1, 80) AS label,
    row_number() OVER (
      PARTITION BY agent_docs.document_id ORDER BY explore_tasks.sequence DESC
    ) AS rank
  FROM agent_docs
  JOIN explore_tasks ON explore_tasks.document_id = agent_docs.document_id
    AND explore_tasks.json IS NOT NULL
    AND trim(json_extract(explore_tasks.json, '$.task')) = agent_docs.task
  WHERE json_type(explore_tasks.json, '$.label') = 'text'
    AND length(trim(json_extract(explore_tasks.json, '$.label'))) > 0
)
UPDATE domain_documents
SET data = CAST(json_set(
      CAST(data AS TEXT),
      '$.executionKind', 'explore',
      '$.name', (
        SELECT label FROM explore_labels
        WHERE explore_labels.document_id = domain_documents.document_id
          AND rank = 1
      )
    ) AS BLOB),
  revision = revision + 1
WHERE namespace = 'agent' AND scope_id = 'global'
  AND document_id IN (SELECT document_id FROM explore_labels WHERE rank = 1);`;

export default defineSchemaStep({
  id: "0006-explore-agent-names",
  description: "Recover short labels for explore child agents.",
  run({ db }) {
    db.exec(SQL);
  },
});
