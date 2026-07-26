# Tools, tasks, runs, and Git

Sandbox composition uses `@nervekit/host-runtime`:

- `HostToolFactory` creates the canonical coding/tool surface;
- `TaskService` owns task transitions and durable logs;
- `RunCoordinator` is the sole run lifecycle and interaction authority;
- `GitService` supplies the same Git workflow behavior as the local host.

Sandbox adapters provide process spawning, process-group termination, paths, persisted task launch environments, checkpoints, event publication, and container constraints. The daemon does not maintain a second task/run implementation.

Commands run with an explicit working directory and allowlisted environment. Secret launch values are stored in protected state and redacted from task records/events. Cancellation targets a verified process tree. After host restart, verified-live processes become recovered (with frozen captured output), verified-gone processes become interrupted, and unverifiable identities become recovery_unknown with destructive PID actions blocked. Tool policy validates path, command, network, approval, and output limits before execution.
