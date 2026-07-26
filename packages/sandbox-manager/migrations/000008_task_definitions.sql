-- Up Migration

alter table sandbox.pinned_commands rename to task_definitions;
alter table sandbox.task_definitions rename column command_id to definition_id;
alter index sandbox.sandbox_pinned_commands_sandbox_idx rename to sandbox_task_definitions_sandbox_idx;
update sandbox.task_definitions
set definition_id = regexp_replace(definition_id, '^pin_', 'taskdef_'),
    record = (record - 'sandboxId') || jsonb_build_object(
      'id', regexp_replace(record->>'id', '^pin_', 'taskdef_'),
      'scope', jsonb_build_object('kind', 'sandbox', 'sandboxId', sandbox_id),
      'runPolicy', coalesce(record->'runPolicy', '"single"'::jsonb)
    );

-- Down Migration

update sandbox.task_definitions
set definition_id = regexp_replace(definition_id, '^taskdef_', 'pin_'),
    record = (record - 'scope' - 'runPolicy') || jsonb_build_object(
      'id', regexp_replace(record->>'id', '^taskdef_', 'pin_'),
      'sandboxId', sandbox_id
    );
alter index sandbox.sandbox_task_definitions_sandbox_idx rename to sandbox_pinned_commands_sandbox_idx;
alter table sandbox.task_definitions rename column definition_id to command_id;
alter table sandbox.task_definitions rename to pinned_commands;
