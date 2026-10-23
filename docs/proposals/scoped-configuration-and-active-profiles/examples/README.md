# Schema examples

These are design fixtures, not loaded configuration or a promise that the illustrative models/accounts exist. During implementation, validate their structural shape with the new contracts and use fixture catalogs for semantic reference checks.

- `user-agent.json`: explicit default model and source-level skill defaults.
- `project-agent.json`: independent reasoning, Jira account reference, skill selection, Developer launch model.
- `planning-profile.json`: recommendation for approval target plus required permission/tool enablement.
- `conversation-agent.json`: user choices remain unchanged beneath Planning; Developer model changes without replacing the project reasoning choice.

The conversation source digest identifies the exact example profile bytes, not a real installed project profile. Regenerate it if that fixture changes.

Expected combined result: default-model/high for the lead; planning permissions and plan presentation on despite the conversation's autonomous/off choices; Developer future launches use conversation-model/high. Switching to a Coding profile without requirements reveals autonomous/off. Existing children do not change.

Required invalid fixtures for implementation tests: partial model `{provider: ...}`; unknown field; future version; empty tool entry; child `subagents` entry; overlapping recommendation/requirement merge unit; requirement conflicting with role restriction; invalid account/model reference; stale revision/digest; incomplete frozen child baseline lacking required non-model defaults. An underlying child model may be absent if its required model makes the resolved configuration valid.
