-- Up Migration

-- Event history from the sparse ACK-era protocol is not compatible with dense
-- per-stream sequence numbers. Preserve it for operators, then start a new
-- protocol epoch from empty authoritative journals.
create table sandbox.sandbox_events_pre_dense_v1
  as table sandbox.sandbox_events;

truncate table sandbox.sandbox_events restart identity;
alter table sandbox.sandbox_events drop column durability;
alter table sandbox.sandbox_events alter column event_id set not null;
alter table sandbox.sandbox_events alter column seq set not null;
alter table sandbox.sandbox_events alter column ts set not null;

-- Down Migration

alter table sandbox.sandbox_events add column durability text not null default 'durable';
alter table sandbox.sandbox_events alter column event_id drop not null;
alter table sandbox.sandbox_events alter column seq drop not null;
alter table sandbox.sandbox_events alter column ts drop not null;
truncate table sandbox.sandbox_events restart identity;
insert into sandbox.sandbox_events
  (id, sandbox_id, event_id, seq, type, ts, payload, received_at, durability)
select
  id, sandbox_id, event_id, seq, type, ts, payload, received_at, durability
from sandbox.sandbox_events_pre_dense_v1;
drop table sandbox.sandbox_events_pre_dense_v1;
