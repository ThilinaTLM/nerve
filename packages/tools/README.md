# `@nervekit/tools`

Canonical agent tool definitions, local execution, permission policy, host runtime contracts, result projection, and Git services.

- `catalog/definitions/`: core and orchestration tool definitions.
- `execution/`: provider executors plus named process/output/network/Atlassian/error infrastructure.
- `policy/`: permission, supervision, risk, path, and shell policy.
- `runtime/`: availability, host dispatch, and runtime permission checks.
- `result-projection/`: bounded agent-facing results.
- `git/`: repository and GitHub workflows consumed outside ordinary tool dispatch.

Do not recreate `execution/common`; shared code belongs to a named technical concern. Executors accept capability interfaces rather than host objects.
