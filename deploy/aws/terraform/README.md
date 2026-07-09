# AWS ECS/Fargate sandbox reference deployment

This Terraform is a configurable reference for running the sandbox manager on AWS with one sandbox per ECS/Fargate task and EFS-backed runtime storage.

## What it creates

- ECS cluster for the manager and sandbox tasks.
- Single-replica manager ECS service (recommended until manager websocket/session HA exists).
- EFS filesystem and mount targets by default, or an existing EFS filesystem if configured.
- Security groups for ALB, manager, sandbox tasks, and EFS.
- CloudWatch log groups for manager and sandbox-agent tasks.
- Task execution role, manager task role, and sandbox task role.
- Browser-facing ALB with HTTP and optional HTTPS listener.
- Optional Cloud Map service for private sandbox callbacks.

Images are not built by Terraform. Build and push `packages/sandbox-manager/Dockerfile` and `packages/sandbox-agent/Dockerfile` to ECR first, then pass their image URIs.

## Security model

The browser UI should be protected by your ALB/auth proxy. The manager still uses `NERVE_SANDBOX_MANAGER_API_KEY` for API and websocket requests; in this deployment the manager is configured with `NERVE_SANDBOX_MANAGER_UI_AUTH_COOKIE_MODE=trusted_proxy`, so it issues the HttpOnly browser API-key cookie only for HTTPS requests from trusted proxy CIDRs and only after the optional trusted auth header is present.

Sandbox callbacks are outbound-only from sandbox tasks to the manager. Prefer Cloud Map or an internal ALB for `NERVE_SANDBOX_MANAGER_PUBLIC_URL`; do not expose the manager callback URL publicly unless you also enforce API-key auth and network controls.

## Prerequisites

1. Existing VPC with at least two private subnets and ALB subnets.
2. PostgreSQL database reachable from the manager task.
3. Secrets Manager or SSM parameters for:
   - `NERVE_SANDBOX_MANAGER_DATABASE_URL`
   - `NERVE_SANDBOX_MANAGER_API_KEY` (recommended)
   - `NERVE_SANDBOX_MANAGER_SECRET_ENCRYPTION_KEY` (production)
4. ECR repositories containing manager and agent images.
5. Optional private Cloud Map namespace for sandbox callback DNS.

## Build image examples

```sh
pnpm build-image:sandbox-agent
NERVE_SANDBOX_MANAGER_INSTALL_LOCAL_RUNTIMES=false pnpm build-image:sandbox-manager
```

Tag and push those images to ECR, then set `manager_image` and `agent_image` in Terraform variables.

## Deploy

```sh
cd deploy/aws/terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars
terraform init
terraform plan
terraform apply
```

## Important variables

- `manager_image`, `agent_image`: externally built image URIs; `agent_image` is passed as `NERVE_SANDBOX_MANAGER_DEFAULT_SANDBOX_IMAGE` for create requests that omit an image.
- `database_url_secret_arn`, `api_key_secret_arn`, `secret_encryption_key_secret_arn`: secret/parameter ARNs injected as ECS secrets.
- `create_efs`, `efs_file_system_id`, `efs_root_directory`: EFS selection and root path.
- `enable_cloud_map`, `cloud_map_namespace_id`, `cloud_map_namespace_name`: private DNS for sandbox callbacks.
- `manager_callback_url`: explicit override for `NERVE_SANDBOX_MANAGER_PUBLIC_URL`.
- `alb_internal`, `alb_ingress_cidrs`, `alb_certificate_arn`: browser access posture.

## Known limitations

- The manager service defaults to one replica. Active sandbox websocket sessions are in-memory.
- Sandbox ECS task definitions are registered per sandbox and deregistered on delete; orphan cleanup is best-effort.
- EFS permissions must allow the manager task to materialize files and sandbox UID/GID `10001:10001` to write `/workspace`, `/state`, and `/tmp`.
- S3 is not used as the live sandbox filesystem.
- ECS Exec is not required by this deployment and is disabled by default.
