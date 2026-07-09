# AWS sandbox infrastructure

Terraform for AWS is split into reusable modules and environment roots.

```text
deploy/aws/
  modules/
    sandbox-manager/        # reusable ECS/Fargate + ALB + EFS + RDS/ECR stack
  environments/
    nonprod/
      dev/                  # low-cost public-HTTP demo/test environment
```

## Environments

- `environments/nonprod/dev`: disposable, non-HA, cost-conscious demo stack. It uses Fargate Spot, a minimal single-AZ RDS PostgreSQL instance, short CloudWatch log retention, and Terraform-managed ECR repositories for the sandbox-manager and sandbox-agent images.
- Future production roots should live under `environments/prod/...` and reuse `modules/sandbox-manager` with stricter defaults: private task subnets, HTTPS/auth proxy, required API/encryption key parameters, longer retention, backups/deletion protection, and on-demand or mixed Fargate capacity.

## Resource tags

The module applies standard tags to taggable resources:

- `Project = "nerve"`
- `ManagedBy = "Terraform"`
- `Owner = var.owner`

Environment roots add tags such as `Environment`, `Stage`, and `CostProfile`.

## Image workflow

Terraform can create ECR repositories, but it does not build images. Build and push:

```sh
pnpm build-image:sandbox-agent
NERVE_SANDBOX_MANAGER_INSTALL_LOCAL_RUNTIMES=false pnpm build-image:sandbox-manager
```

The sandbox-manager image build bundles `packages/sandbox-manager-ui/dist` into the manager image so the manager serves the UI itself.
