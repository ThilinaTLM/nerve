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

Terraform can create ECR repositories, but it does not build images. For nonprod/dev, build and push the Terraform-configured ECR images with:

```sh
cd deploy/aws/environments/nonprod/dev
./build-push-sandbox-agent-image.sh
./build-push-sandbox-manager-image.sh
```

The helpers check Docker authentication for the target ECR registry and log in through `aws ecr get-login-password` when needed. The sandbox-manager image build bundles `packages/sandbox-manager-ui/dist` into the manager image so the manager serves the UI itself.
