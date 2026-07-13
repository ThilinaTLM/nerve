# Sandbox boot sequence

The daemon startup is deterministic:

1. load and strictly validate YAML configuration;
2. resolve paths, validate version-4 state, and acquire the state lock;
3. run filesystem/runtime preflight and recover journals, outbox, tasks, and checkpoints;
4. resolve secret stores and model credentials without exposing values;
5. prepare Git identity/credentials and GitHub access;
6. load context files and skills;
7. execute configured boot phases with persisted attempts and bounded logs;
8. compose tools, `TaskService`, and `RunCoordinator`;
9. connect/restore the manager protocol session and publish setup/readiness state.

Startup stages and failures are typed and visible through snapshots/events. Disconnect self-exit uses the configured controller policy (default 300 seconds where omitted); exit code 22 is reconciled by the manager as reconnecting. Other startup exit codes identify the failed stage.
