variable "aws_region" {
  type        = string
  description = "AWS region for the sandbox manager deployment."
}

variable "name_prefix" {
  type        = string
  description = "Prefix used for named AWS resources."
  default     = "nerve-sandbox"
}

variable "owner" {
  type        = string
  description = "Owner tag value for all taggable resources. Pass this from the environment tfvars file."
}

variable "additional_tags" {
  type        = map(string)
  description = "Additional tags applied to taggable resources."
  default     = {}
}

variable "vpc_id" {
  type        = string
  description = "Existing VPC ID."
}

variable "alb_subnet_ids" {
  type        = list(string)
  description = "Subnets for the browser-facing ALB. Use public subnets for public HTTP/HTTPS, or private subnets for an internal ALB."
}

variable "task_subnet_ids" {
  type        = list(string)
  description = "Subnets for ECS/Fargate manager and sandbox tasks. For low-cost dev without NAT, these may be public subnets with public IP assignment enabled."
}

variable "manager_image" {
  type        = string
  description = "Prebuilt sandbox-manager image URI. If null, create_ecr_repositories must be true and the module uses the created repository URL plus image_tag."
  default     = null
}

variable "agent_image" {
  type        = string
  description = "Prebuilt sandbox-agent image URI used as the manager default sandbox image. If null, create_ecr_repositories must be true and the module uses the created repository URL plus image_tag."
  default     = null
}

variable "image_tag" {
  type        = string
  description = "Image tag used when manager_image or agent_image is derived from Terraform-created ECR repositories."
  default     = "dev"
}

variable "manager_cpu" {
  type        = number
  description = "Fargate CPU units for the manager task."
  default     = 1024
}

variable "manager_memory_mb" {
  type        = number
  description = "Fargate memory for the manager task."
  default     = 2048
}

variable "manager_desired_count" {
  type        = number
  description = "Manager replica count. Keep at 1 until websocket/session HA is designed."
  default     = 1
}

variable "manager_port" {
  type        = number
  description = "Manager HTTP port."
  default     = 7869
}

variable "manager_assign_public_ip" {
  type        = bool
  description = "Whether the manager ECS task should receive a public IP. Useful for no-NAT nonprod demos in public subnets; keep false for production."
  default     = false
}

variable "manager_capacity_provider_strategy" {
  type = list(object({
    capacity_provider = string
    weight            = optional(number)
    base              = optional(number)
  }))
  description = "Optional ECS capacity provider strategy for the manager service. When set, launch_type is omitted."
  default     = []
}

variable "sandbox_capacity_provider_strategy" {
  type = list(object({
    capacity_provider = string
    weight            = optional(number)
    base              = optional(number)
  }))
  description = "Optional ECS capacity provider strategy passed to the sandbox manager for sandbox RunTask calls."
  default     = []
}

variable "database_url_parameter_arn" {
  type        = string
  description = "SSM parameter or Secrets Manager secret ARN containing NERVE_SANDBOX_MANAGER_DATABASE_URL when create_rds=false."
  default     = null
}

variable "api_key_parameter_arn" {
  type        = string
  description = "Optional SSM parameter or Secrets Manager secret ARN containing NERVE_SANDBOX_MANAGER_API_KEY."
  default     = null
}

variable "secret_encryption_key_parameter_arn" {
  type        = string
  description = "Optional SSM parameter or Secrets Manager secret ARN containing NERVE_SANDBOX_MANAGER_SECRET_ENCRYPTION_KEY."
  default     = null
}

variable "database_ssl" {
  type        = bool
  description = "Whether the manager should use SSL for PostgreSQL. Defaults to true when create_rds=true, otherwise false."
  default     = null
}

variable "ssm_parameter_kms_key_id" {
  type        = string
  description = "Optional KMS key ID/ARN used to encrypt module-created SSM SecureString parameters."
  default     = null
}

variable "ssm_parameter_kms_key_arns" {
  type        = list(string)
  description = "Optional KMS key ARNs the ECS task execution role may decrypt for SecureString ECS secrets. Required for customer-managed SSM parameter KMS keys."
  default     = []
}

variable "create_rds" {
  type        = bool
  description = "Create a minimal RDS PostgreSQL instance and SSM SecureString database URL parameter."
  default     = false
}

variable "rds_subnet_ids" {
  type        = list(string)
  description = "Subnets for the RDS DB subnet group when create_rds=true. Use at least two subnets in different AZs."
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
  description = "RDS instance class."
  default     = "db.t4g.micro"
}

variable "rds_allocated_storage_gb" {
  type        = number
  description = "Allocated RDS storage in GiB."
  default     = 20
}

variable "rds_backup_retention_period" {
  type        = number
  description = "RDS backup retention period in days."
  default     = 0
}

variable "rds_deletion_protection" {
  type        = bool
  description = "Whether deletion protection is enabled for the RDS instance."
  default     = false
}

variable "rds_skip_final_snapshot" {
  type        = bool
  description = "Whether to skip final snapshot on RDS destroy."
  default     = true
}

variable "database_url_parameter_name" {
  type        = string
  description = "Optional SSM parameter name for the module-created manager database URL."
  default     = null
}

variable "create_ecr_repositories" {
  type        = bool
  description = "Create ECR repositories for sandbox-manager and sandbox-agent images."
  default     = false
}

variable "manager_ecr_repository_name" {
  type        = string
  description = "Optional ECR repository name for the sandbox-manager image. Defaults to <name_prefix>-sandbox-manager."
  default     = null
}

variable "agent_ecr_repository_name" {
  type        = string
  description = "Optional ECR repository name for the sandbox-agent image. Defaults to <name_prefix>-sandbox-agent."
  default     = null
}

variable "ecr_force_delete" {
  type        = bool
  description = "Whether Terraform may delete non-empty ECR repositories. Useful for disposable dev environments."
  default     = false
}

variable "ecr_max_untagged_images" {
  type        = number
  description = "Maximum untagged images retained in each ECR repository."
  default     = 3
}

variable "ecr_max_tagged_images" {
  type        = number
  description = "Maximum tagged images retained in each ECR repository."
  default     = 10
}

variable "create_efs" {
  type        = bool
  description = "Create an EFS filesystem and mount targets. If false, efs_file_system_id must be set and mount targets/security must exist."
  default     = true
}

variable "efs_file_system_id" {
  type        = string
  description = "Existing EFS filesystem ID when create_efs=false."
  default     = null
}

variable "efs_root_directory" {
  type        = string
  description = "EFS root directory prefix used in sandbox task definitions."
  default     = "/"
}

variable "efs_manager_mount_path" {
  type        = string
  description = "Path where the manager container mounts EFS."
  default     = "/mnt/nerve-sandbox"
}

variable "efs_transition_to_ia" {
  type        = string
  description = "Optional EFS lifecycle transition to infrequent access, such as AFTER_7_DAYS."
  default     = null
}

variable "alb_internal" {
  type        = bool
  description = "Whether the ALB is internal."
  default     = false
}

variable "alb_ingress_cidrs" {
  type        = list(string)
  description = "CIDR ranges allowed to reach the ALB. Keep narrow for HTTP dev deployments."
  default     = ["0.0.0.0/0"]
}

variable "alb_certificate_arn" {
  type        = string
  description = "Optional ACM certificate ARN for an HTTPS listener."
  default     = null
}

variable "trusted_proxy_auth_header" {
  type        = string
  description = "Optional header set by an auth proxy/ALB integration before the manager issues the UI API-key cookie."
  default     = null
}

variable "manager_callback_url" {
  type        = string
  description = "Optional explicit private URL sandboxes use to call back to the manager. Defaults to Cloud Map when enabled, otherwise ALB HTTP URL."
  default     = null
}

variable "enable_cloud_map" {
  type        = bool
  description = "Register the manager service in an existing private Cloud Map namespace."
  default     = false
}

variable "cloud_map_namespace_id" {
  type        = string
  description = "Existing private DNS namespace ID for Cloud Map. Required when enable_cloud_map=true."
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

variable "sandbox_assign_public_ip" {
  type        = bool
  description = "Whether sandbox ECS tasks launched by the manager should receive public IPs. Useful for no-NAT nonprod demos in public subnets; keep false for production."
  default     = false
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention in days for manager and sandbox task logs."
  default     = 30
}
