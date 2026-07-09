output "manager_url" {
  description = "Browser-facing manager URL through the ALB."
  value       = module.sandbox_manager.manager_url
}

output "manager_callback_url" {
  description = "URL configured as NERVE_SANDBOX_MANAGER_PUBLIC_URL for sandbox callbacks."
  value       = module.sandbox_manager.manager_callback_url
}

output "cloud_map_namespace_id" {
  description = "Private Cloud Map namespace ID used for sandbox callbacks when created/enabled."
  value       = local.cloud_map_namespace_id
}

output "cloud_map_namespace_name" {
  description = "Private Cloud Map namespace name used for sandbox callbacks when created/enabled."
  value       = local.cloud_map_namespace_name
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = module.sandbox_manager.ecs_cluster_name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN."
  value       = module.sandbox_manager.ecs_cluster_arn
}

output "manager_service_name" {
  description = "ECS service name for the sandbox manager."
  value       = module.sandbox_manager.manager_service_name
}

output "manager_task_definition_arn" {
  description = "Manager ECS task definition ARN."
  value       = module.sandbox_manager.manager_task_definition_arn
}

output "manager_log_group" {
  description = "CloudWatch log group for manager tasks."
  value       = module.sandbox_manager.manager_log_group
}

output "sandbox_log_group" {
  description = "CloudWatch log group for sandbox-agent tasks."
  value       = module.sandbox_manager.sandbox_log_group
}

output "efs_file_system_id" {
  description = "EFS filesystem ID."
  value       = module.sandbox_manager.efs_file_system_id
}

output "manager_security_group_id" {
  description = "Security group ID for manager tasks."
  value       = module.sandbox_manager.manager_security_group_id
}

output "sandbox_security_group_id" {
  description = "Security group ID for sandbox tasks."
  value       = module.sandbox_manager.sandbox_security_group_id
}

output "rds_security_group_id" {
  description = "Security group ID for RDS when create_rds=true."
  value       = module.sandbox_manager.rds_security_group_id
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint when create_rds=true."
  value       = module.sandbox_manager.rds_endpoint
}

output "database_url_parameter_arn" {
  description = "SSM parameter or secret ARN used for the manager database URL."
  value       = module.sandbox_manager.database_url_parameter_arn
}

output "secret_encryption_key_parameter_arn" {
  description = "SSM parameter or secret ARN used for the manager secret encryption key."
  value       = module.sandbox_manager.secret_encryption_key_parameter_arn
}

output "manager_ecr_repository_url" {
  description = "Sandbox-manager ECR repository URL."
  value       = module.sandbox_manager.manager_ecr_repository_url
}

output "agent_ecr_repository_url" {
  description = "Sandbox-agent ECR repository URL."
  value       = module.sandbox_manager.agent_ecr_repository_url
}

output "manager_image" {
  description = "Manager image URI configured on ECS."
  value       = module.sandbox_manager.manager_image
}

output "agent_image" {
  description = "Sandbox-agent image URI configured as the manager default."
  value       = module.sandbox_manager.agent_image
}
