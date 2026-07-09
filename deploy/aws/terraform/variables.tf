variable "aws_region" {
  type        = string
  description = "AWS region for the reference deployment."
}

variable "name_prefix" {
  type        = string
  description = "Prefix used for named AWS resources."
  default     = "nerve-sandbox"
}

variable "vpc_id" {
  type        = string
  description = "Existing VPC ID."
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Subnets for the browser-facing ALB. Use private subnets for an internal ALB."
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnets for ECS/Fargate manager and sandbox tasks."
}

variable "tags" {
  type        = map(string)
  description = "Additional tags applied to resources."
  default     = {}
}

variable "manager_image" {
  type        = string
  description = "Prebuilt sandbox-manager image URI."
}

variable "agent_image" {
  type        = string
  description = "Prebuilt sandbox-agent image URI used as the manager default sandbox image."
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

variable "database_url_secret_arn" {
  type        = string
  description = "Secrets Manager or SSM parameter ARN containing NERVE_SANDBOX_MANAGER_DATABASE_URL."
}

variable "api_key_secret_arn" {
  type        = string
  description = "Optional Secrets Manager or SSM parameter ARN containing NERVE_SANDBOX_MANAGER_API_KEY."
  default     = null
}

variable "secret_encryption_key_secret_arn" {
  type        = string
  description = "Optional Secrets Manager or SSM parameter ARN containing NERVE_SANDBOX_MANAGER_SECRET_ENCRYPTION_KEY."
  default     = null
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

variable "alb_internal" {
  type        = bool
  description = "Whether the ALB is internal."
  default     = false
}

variable "alb_ingress_cidrs" {
  type        = list(string)
  description = "CIDR ranges allowed to reach the ALB."
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
  description = "Whether sandbox ECS tasks launched by the manager should receive public IPs."
  default     = false
}
