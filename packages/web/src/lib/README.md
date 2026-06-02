# Web module ownership

The web package owns presentation, browser routing, UI state, API adapters, and websocket event routing for the workbench.

Do not place secrets, dangerous capability decisions, or daemon-side policy in frontend code. Those remain in orchestrator/tool layers; shared schemas remain in `@nerve/shared`.
