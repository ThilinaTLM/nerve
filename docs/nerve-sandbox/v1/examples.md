# Sandbox examples

## Minimal runtime configuration

```yaml
controller:
  url: ws://sandbox-manager:7869/ws/sandbox
  auth:
    apiKey:
      secretRef: controller-key
agent:
  defaultModel:
    provider: anthropic
    model: claude-sonnet-4-5
  workspaceRoot: /workspace
tools:
  groups: [coding, tasks]
context:
  files: [AGENTS.md]
skills:
  project: true
storage:
  stateDir: /state
security:
  workspaceRoot: /workspace
```

Use the generated/current config schema for exact required fields and supported enum values; secret references must resolve through manager-provided stores.

## Targeted task request

A manager UI operation targets the sandbox identity:

```json
{
  "source": { "role": "ui", "id": "cli_example" },
  "target": { "role": "sandbox_agent", "id": "sbx_example" },
  "data": {
    "method": "task.list",
    "params": {}
  }
}
```

The full wire envelope fields are shown in `docs/nerve-protocol/v1/examples.md`. The selected browser stream is `sandbox:sbx_example`; manager lifecycle remains on `manager`.

## Local image build

```sh
NERVE_CONTAINER_CLI=docker pnpm build-image:sandbox-agent
NERVE_SANDBOX_MANAGER_INSTALL_LOCAL_RUNTIMES=false pnpm build-image:sandbox-manager
```
