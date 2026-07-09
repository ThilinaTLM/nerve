-- Up Migration

update sandbox.sandboxes
set
  record =
    case
      when materialized_config ? 'identity'
        and materialized_config->'identity' ? 'name'
        and not (record ? 'name')
      then jsonb_set(record, '{name}', materialized_config->'identity'->'name', true)
      else record
    end,
  materialized_config = materialized_config
where materialized_config ? 'identity';

update sandbox.sandboxes
set
  record =
    case
      when materialized_config ? 'identity'
        and materialized_config->'identity' ? 'labels'
        and not (record ? 'labels')
      then jsonb_set(record, '{labels}', materialized_config->'identity'->'labels', true)
      else record
    end,
  materialized_config = materialized_config
where materialized_config ? 'identity';

with migrated_resources as (
  select
    sandbox_id,
    jsonb_strip_nulls(
      (materialized_config->'resources' - 'cpu') ||
      case
        when materialized_config->'resources' ? 'cpu'
          and (materialized_config->'resources'->>'cpu') ~ '^[0-9]+(\\.[0-9]+)?$'
          and record->>'backend' = 'ecs'
          and (materialized_config->'resources'->>'cpu') ~ '^[0-9]+$'
          and (materialized_config->'resources'->>'cpu')::int >= 128
        then jsonb_build_object('cpuUnits', (materialized_config->'resources'->>'cpu')::int)
        when materialized_config->'resources' ? 'cpu'
          and (materialized_config->'resources'->>'cpu') ~ '^[0-9]+(\\.[0-9]+)?$'
        then jsonb_build_object('vcpu', (materialized_config->'resources'->>'cpu')::numeric)
        else '{}'::jsonb
      end
    ) as resources
  from sandbox.sandboxes
  where materialized_config ? 'resources'
)
update sandbox.sandboxes as sandboxes
set
  record =
    case
      when not (sandboxes.record ? 'resources')
      then jsonb_set(sandboxes.record, '{resources}', migrated_resources.resources, true)
      else sandboxes.record
    end,
  materialized_config = sandboxes.materialized_config
from migrated_resources
where sandboxes.sandbox_id = migrated_resources.sandbox_id;

update sandbox.sandboxes
set
  materialized_config = materialized_config - 'identity' - 'resources',
  record = record - 'configDigest',
  updated_at = now()
where materialized_config ? 'identity' or materialized_config ? 'resources';

-- Down Migration

-- Irreversible data cleanup: launch metadata cannot be safely moved back into
-- sandbox-agent config without changing the mounted runtime contract again.
