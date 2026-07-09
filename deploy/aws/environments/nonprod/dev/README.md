# AWS nonprod/dev sandbox environment

This root deploys a disposable, low-cost AWS demo stack for the sandbox manager:

- public HTTP ALB restricted by `alb_ingress_cidrs`;
- ECS/Fargate manager service using `FARGATE_SPOT`;
- sandbox-agent ECS tasks launched by the manager using `FARGATE_SPOT`;
- EFS for manager materialization and sandbox runtime mounts;
- a module-created EFS access point rooted at `efs_root_directory` so the manager can materialize sandbox files;
- minimal single-AZ RDS PostgreSQL (`db.t4g.micro`, 20 GiB by default);
- SSM SecureString parameter for the manager database URL;
- SSM SecureString parameter for the manager secret encryption key when one is not supplied;
- private Cloud Map namespace for sandbox-to-manager callbacks;
- ECR repositories for `sandbox-manager` and `sandbox-agent` images.

This environment is for testing/demos only. Destroy it when finished.

## Prerequisites

- AWS credentials with permissions for ECS, ECR, ELBv2, EFS, RDS, SSM, IAM, CloudWatch Logs, and security groups.
- Existing VPC and subnets.
- Terraform >= 1.6.
- Docker or Podman for image builds.
- Your current public IP/CIDR for `alb_ingress_cidrs`.

## Configure

```sh
cd deploy/aws/environments/nonprod/dev
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars
```

Set at minimum:

- `owner`
- `aws_region`
- `vpc_id`
- `alb_subnet_ids`
- `task_subnet_ids`
- `alb_ingress_cidrs`

For the lowest-cost no-NAT demo, use public subnets for `task_subnet_ids` and keep `manager_assign_public_ip = true` and `sandbox_assign_public_ip = true`. For a more prod-like network, use private task subnets and provide NAT Gateway or VPC endpoints for ECR, CloudWatch Logs, SSM/Secrets Manager, and other AWS APIs.

## Create ECR repositories first

Terraform creates the ECR repositories, but ECS cannot start until images exist. For a fresh stack, create the repos first:

```sh
terraform init
terraform apply \
  -target='module.sandbox_manager.aws_ecr_repository.manager[0]' \
  -target='module.sandbox_manager.aws_ecr_repository.agent[0]'
```

Then login and push images:

```sh
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(terraform output -raw manager_ecr_repository_url | sed -E 's#^[0-9]+\.dkr\.ecr\.([^./]+)\.amazonaws\.com/.*#\1#')
CONTAINER_CLI=${NERVE_CONTAINER_CLI:-docker}
aws ecr get-login-password --region "$REGION" |
  "$CONTAINER_CLI" login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

MANAGER_REPO=$(terraform output -raw manager_ecr_repository_url)
AGENT_REPO=$(terraform output -raw agent_ecr_repository_url)
TAG=$(terraform output -raw manager_image | awk -F: '{print $NF}')

NERVE_SANDBOX_AGENT_IMAGE="$AGENT_REPO:$TAG" pnpm build-image:sandbox-agent
"$CONTAINER_CLI" push "$AGENT_REPO:$TAG"

NERVE_SANDBOX_MANAGER_IMAGE="$MANAGER_REPO:$TAG" \
NERVE_SANDBOX_MANAGER_INSTALL_LOCAL_RUNTIMES=false \
  pnpm build-image:sandbox-manager
"$CONTAINER_CLI" push "$MANAGER_REPO:$TAG"
```

The manager image build bundles and serves the sandbox-manager UI from the manager container. No separate UI service is deployed.

If you already have images, set `manager_image` and `agent_image` in `terraform.tfvars` and skip Terraform-created ECR repos if desired.

## Deploy

```sh
terraform plan
terraform apply
```

Get the manager URL:

```sh
MANAGER_URL=$(terraform output -raw manager_url)
echo "$MANAGER_URL"
```

## Smoke tests

Without API key auth:

```sh
curl "$MANAGER_URL/health"
curl "$MANAGER_URL/api/manager/status"
```

With API key auth configured via `api_key_parameter_arn`, use API headers for HTTP tests:

```sh
curl -H "Authorization: Bearer $NERVE_SANDBOX_MANAGER_API_KEY" "$MANAGER_URL/api/manager/status"
```

HTTP browser UI testing is intended only with a narrow `alb_ingress_cidrs` allowlist. Sandbox callbacks use private Cloud Map by default (`create_cloud_map_namespace = true`), so sandbox tasks do not need to call the manager through the public ALB. The built-in trusted-proxy browser auth cookie flow requires HTTPS, so API-key-protected browser UI testing should use an ACM certificate or an authenticated HTTPS proxy.

## Cleanup

```sh
terraform destroy
```

RDS deletion protection and final snapshots are disabled by default here because this is a disposable dev environment.
