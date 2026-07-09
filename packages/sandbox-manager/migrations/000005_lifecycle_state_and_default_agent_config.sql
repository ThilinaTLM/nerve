-- Up Migration

alter table if exists sandbox.sandboxes
  add column if not exists lifecycle_state text;

with inferred as (
  select
    sandboxes.sandbox_id,
    case
      when sandboxes.record->>'desiredState' = 'removed'
        or sandboxes.record->>'observedState' = 'removed'
        then 'removed'
      when sandboxes.record->>'observedState' = 'failed'
        then 'failed'
      when sandboxes.record->>'observedState' = 'stopping'
        then 'stopping'
      when sandboxes.record->>'observedState' = 'exited'
        and sandboxes.record->>'desiredState' = 'stopped'
        then 'stopped'
      when sandboxes.record->>'observedState' = 'running'
        and sessions.record->>'agentStatus' in ('ready', 'degraded')
        then sessions.record->>'agentStatus'
      when sandboxes.record->>'observedState' = 'running'
        and sessions.record->>'state' = 'connected'
        then 'daemon_connected'
      when sandboxes.record->>'observedState' = 'running'
        then 'container_started'
      when sandboxes.record->>'observedState' = 'starting'
        then 'container_starting'
      when sandboxes.record->>'observedState' = 'creating'
        then 'container_creating'
      when sandboxes.record->>'desiredState' = 'created'
        and not (sandboxes.record ? 'containerRef')
        then 'record_created'
      else 'record_created'
    end as lifecycle_state,
    coalesce(sandboxes.record->>'updatedAt', to_jsonb(sandboxes.updated_at)::text) as updated_at
  from sandbox.sandboxes as sandboxes
  left join sandbox.sandbox_sessions as sessions
    on sessions.sandbox_id = sandboxes.sandbox_id
)
update sandbox.sandboxes as sandboxes
set
  lifecycle_state = inferred.lifecycle_state,
  record = jsonb_set(
    jsonb_set(
      sandboxes.record,
      '{lifecycleState}',
      to_jsonb(inferred.lifecycle_state),
      true
    ),
    '{lifecycleUpdatedAt}',
    to_jsonb(coalesce(sandboxes.record->>'updatedAt', now()::text)),
    true
  ),
  updated_at = now()
from inferred
where sandboxes.sandbox_id = inferred.sandbox_id
  and not (sandboxes.record ? 'lifecycleState');

update sandbox.sandboxes
set lifecycle_state = record->>'lifecycleState'
where record ? 'lifecycleState';

update sandbox.sandboxes
set
  materialized_config = jsonb_set(
    materialized_config,
    '{agent}',
    jsonb_strip_nulls(
      ((materialized_config->'agent') - 'mainModel' - 'exploreModel' - 'mode' - 'permissionLevel' - 'initialPrompt') ||
      jsonb_build_object(
        'defaultModel', materialized_config->'agent'->'mainModel',
        'defaultExploreModel', materialized_config->'agent'->'exploreModel',
        'defaultMode', materialized_config->'agent'->'mode',
        'defaultPermissionLevel', materialized_config->'agent'->'permissionLevel'
      )
    ),
    true
  ),
  record = record - 'configDigest',
  updated_at = now()
where materialized_config ? 'agent'
  and (
    materialized_config->'agent' ? 'mainModel'
    or materialized_config->'agent' ? 'exploreModel'
    or materialized_config->'agent' ? 'mode'
    or materialized_config->'agent' ? 'permissionLevel'
    or materialized_config->'agent' ? 'initialPrompt'
  );

-- Down Migration

alter table if exists sandbox.sandboxes
  drop column if exists lifecycle_state;

-- Irreversible data cleanup: old agent main/explore/initialPrompt config fields
-- are not restored once the mounted sandbox config has been normalized.
