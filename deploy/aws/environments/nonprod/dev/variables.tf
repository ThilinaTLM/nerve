variable "aws_region" {
  type        = string
  description = "AWS region for the nonprod/dev sandbox deployment."
}

variable "owner" {
  type        = string
  description = "Owner tag value applied to Terraform-managed resources. Set this in terraform.tfvars."
}

variable "name_prefix" {
  type        = string
  description = "Prefix used for named AWS resources in nonprod/dev."
  default     = "nerve-sandbox-nonprod-dev"
}

variable "vpc_id" {
  type        = string
  description = "Existing VPC ID."
}

variable "alb_subnet_ids" {
  type        = list(string)
  description = "Subnets for the public HTTP ALB. Use at least two public subnets in different AZs."
}

variable "task_subnet_ids" {
  type        = list(string)
  description = "Subnets for manager and sandbox ECS tasks. For lowest-cost no-NAT dev, use public subnets and keep public IP assignment enabled."
}

variable "rds_subnet_ids" {
  type        = list(string)
  description = "Subnets for the RDS DB subnet group. Defaults to task_subnet_ids when empty. Use at least two subnets in different AZs."
  default     = []
}

variable "alb_ingress_cidrs" {
  type        = list(string)
  description = "CIDR ranges allowed to reach the public HTTP ALB. Keep this to your tester IP/CIDR, for example [\"203.0.113.10/32\"]."
}

variable "manager_image" {
  type        = string
  description = "Optional prebuilt sandbox-manager image URI. When null, the Terraform-created ECR repo URL plus image_tag is used."
  default     = null
}

variable "agent_image" {
  type        = string
  description = "Optional prebuilt sandbox-agent image URI. When null, the Terraform-created ECR repo URL plus image_tag is used."
  default     = null
}

variable "image_tag" {
  type        = string
  description = "Image tag used for Terraform-created ECR repository image URIs."
  default     = "dev"
}

variable "manager_cpu" {
  type        = number
  description = "Fargate CPU units for the manager task."
  default     = 512
}

variable "manager_memory_mb" {
  type        = number
  description = "Fargate memory for the manager task."
  default     = 1024
}

variable "manager_desired_count" {
  type        = number
  description = "Manager replica count. Keep at 1 for non-HA dev."
  default     = 1
}

variable "manager_assign_public_ip" {
  type        = bool
  description = "Assign a public IP to the manager ECS task. True supports low-cost public-subnet demos without NAT."
  default     = true
}

variable "sandbox_assign_public_ip" {
  type        = bool
  description = "Assign public IPs to sandbox ECS tasks launched by the manager. True supports low-cost public-subnet demos without NAT."
  default     = true
}

variable "alb_internal" {
  type        = bool
  description = "Whether the ALB is internal. Defaults to public for HTTP demos."
  default     = false
}

variable "alb_certificate_arn" {
  type        = string
  description = "Optional ACM certificate ARN for HTTPS. Keep null for HTTP-only dev testing."
  default     = null
}

variable "create_rds" {
  type        = bool
  description = "Create minimal RDS PostgreSQL and SSM SecureString database URL parameter."
  default     = true
}

variable "database_url_parameter_arn" {
  type        = string
  description = "Existing SSM parameter or secret ARN containing the manager database URL when create_rds=false."
  default     = null
}

variable "database_url_parameter_name" {
  type        = string
  description = "Optional SSM parameter name for the module-created manager database URL."
  default     = null
}

variable "api_key_parameter_arn" {
  type        = string
  description = "Optional SSM parameter or secret ARN containing NERVE_SANDBOX_MANAGER_API_KEY. Leave null for narrow-CIDR HTTP browser UI testing."
  default     = null
}

variable "secret_encryption_key_parameter_arn" {
  type        = string
  description = "Optional SSM parameter or secret ARN containing NERVE_SANDBOX_MANAGER_SECRET_ENCRYPTION_KEY."
  default     = null
}

variable "database_ssl" {
  type        = bool
  description = "Whether the manager should use SSL for PostgreSQL. Defaults to true when create_rds=true."
  default     = null
}

variable "ssm_parameter_kms_key_id" {
  type        = string
  description = "Optional KMS key ID/ARN for Terraform-created SSM SecureString parameters."
  default     = null
}

variable "ssm_parameter_kms_key_arns" {
  type        = list(string)
  description = "Optional KMS key ARNs the ECS task execution role may decrypt for SecureString ECS secrets."
  default     = []
}

variable "rds_database_name" {
  type        = string
  description = "Initial PostgreSQL database name."
  default     = "nerve"
}

variable "rds_username" {
  type        = string
  description = "RDS PostgreSQL master username."
  default     = "nerve_manager"
}

variable "rds_engine_version" {
  type        = string
  description = "Optional PostgreSQL engine version for RDS."
  default     = null
}

variable "rds_instance_class" {
  type        = string
  description = "Minimal nonprod/dev RDS instance class."
  default     = "db.t4g.micro"
}

variable "rds_allocated_storage_gb" {
  type        = number
  description = "Allocated RDS storage in GiB."
  default     = 20
}

variable "rds_backup_retention_period" {
  type        = number
  description = "RDS backup retention in days. Zero minimizes disposable dev cost."
  default     = 0
}

variable "rds_deletion_protection" {
  type        = bool
  description = "Whether deletion protection is enabled for RDS."
  default     = false
}

variable "rds_skip_final_snapshot" {
  type        = bool
  description = "Whether to skip final snapshot on destroy. True is intended for disposable dev."
  default     = true
}

variable "create_ecr_repositories" {
  type        = bool
  description = "Create sandbox-manager and sandbox-agent ECR repositories."
  default     = true
}

variable "manager_ecr_repository_name" {
  type        = string
  description = "Optional sandbox-manager ECR repository name."
  default     = null
}

variable "agent_ecr_repository_name" {
  type        = string
  description = "Optional sandbox-agent ECR repository name."
  default     = null
}

variable "ecr_force_delete" {
  type        = bool
  description = "Allow Terraform destroy to remove non-empty ECR repositories. Intended for disposable dev."
  default     = true
}

variable "create_efs" {
  type        = bool
  description = "Create EFS for manager materialization and sandbox runtime mounts."
  default     = true
}

variable "efs_file_system_id" {
  type        = string
  description = "Existing EFS filesystem ID when create_efs=false."
  default     = null
}

variable "efs_root_directory" {
  type        = string
  description = "EFS root directory prefix used in sandbox task definitions. The module-created manager access point creates this path with writable dev permissions."
  default     = "/nerve"
}

variable "efs_transition_to_ia" {
  type        = string
  description = "EFS lifecycle transition to infrequent access for cost control."
  default     = "AFTER_7_DAYS"
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention in days."
  default     = 7
}

variable "trusted_proxy_auth_header" {
  type        = string
  description = "Optional header set by an auth proxy/ALB integration before the manager issues the UI API-key cookie."
  default     = null
}

variable "manager_callback_url" {
  type        = string
  description = "Optional explicit URL sandboxes use to call back to the manager. Defaults to Cloud Map when enabled, otherwise the ALB HTTP URL."
  default     = null
}

variable "create_cloud_map_namespace" {
  type        = bool
  description = "Create a private Cloud Map namespace for sandbox-to-manager callbacks."
  default     = true
}

variable "cloud_map_private_dns_namespace_name" {
  type        = string
  description = "Private DNS namespace name created when create_cloud_map_namespace=true."
  default     = "nerve-sandbox-dev.local"
}

variable "enable_cloud_map" {
  type        = bool
  description = "Register the manager service in an existing private Cloud Map namespace."
  default     = false
}

variable "cloud_map_namespace_id" {
  type        = string
  description = "Existing private DNS namespace ID for Cloud Map."
  default     = null
}

variable "cloud_map_namespace_name" {
  type        = string
  description = "Private DNS namespace name used to build the callback URL output."
  default     = null
}

variable "cloud_map_service_name" {
  type        = string
  description = "Cloud Map service name for the manager."
  default     = "sandbox-manager"
}

variable "tags" {
  type        = map(string)
  description = "Extra nonprod/dev tags merged with the environment defaults."
  default     = {}
}
