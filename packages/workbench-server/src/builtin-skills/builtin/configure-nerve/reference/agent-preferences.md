# Agent preferences (`agent.json`)

`<home>/config/agent.json` and `<project>/.nerve/config/agent.json` hold the default model, thinking level, rule set selection and tool and skill toggles. The user changes them in Settings; edit them only when the user asks for exactly that change. How the layers combine: `SKILL.md`, "Precedence and approval".

The fields are the settings object of agent profiles (`reference/agent-profiles.md`, "Settings object"), wrapped as `{ "schemaVersion": 1, "revision": <n>, "overrides": { ... } }`. Skill toggles: `reference/skills.md`, "On and off"; MCP server toggles: `reference/mcp.md`.

- Keep `revision` as it is.
- The project file also carries a top-level `"version": 2`; keep it.
- `permissionRuleSetId` must name a rule set that exists, or the file is refused.
