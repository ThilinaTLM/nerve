output "manager_url" {
  description = "Browser-facing manager URL through the ALB."
  value       = var.alb_certificate_arn == null ? "http://${aws_lb.manager.dns_name}" : "https://${aws_lb.manager.dns_name}"
}

output "manager_callback_url" {
  description = "URL configured as NERVE_SANDBOX_MANAGER_PUBLIC_URL for sandbox callbacks."
  value       = local.callback_url
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN used by the manager and sandbox tasks."
  value       = aws_ecs_cluster.sandbox.arn
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.sandbox.name
}

output "manager_service_name" {
  description = "ECS service name for the manager."
  value       = aws_ecs_service.manager.name
}

output "manager_task_definition_arn" {
  description = "Manager ECS task definition ARN."
  value       = aws_ecs_task_definition.manager.arn
}

output "manager_log_group" {
  description = "CloudWatch log group for the manager task."
  value       = aws_cloudwatch_log_group.manager.name
}

output "sandbox_log_group" {
  description = "CloudWatch log group for sandbox-agent tasks launched by the manager."
  value       = aws_cloudwatch_log_group.sandbox.name
}

output "efs_file_system_id" {
  description = "EFS filesystem ID used for manager materialization and sandbox mounts."
  value       = local.efs_file_system_id
}

output "manager_security_group_id" {
  description = "Security group ID for the manager task."
  value       = aws_security_group.manager.id
}

output "sandbox_security_group_id" {
  description = "Security group ID configured for sandbox tasks."
  value       = aws_security_group.sandbox.id
}

output "rds_security_group_id" {
  description = "Security group ID for the module-created RDS instance when enabled."
  value       = var.create_rds ? aws_security_group.rds[0].id : null
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint when create_rds=true."
  value       = var.create_rds ? aws_db_instance.manager[0].endpoint : null
}

output "database_url_parameter_arn" {
  description = "SSM parameter or secret ARN used for NERVE_SANDBOX_MANAGER_DATABASE_URL."
  value       = local.database_url_parameter_arn
}

output "manager_ecr_repository_url" {
  description = "Terraform-created sandbox-manager ECR repository URL when enabled."
  value       = var.create_ecr_repositories ? aws_ecr_repository.manager[0].repository_url : null
}

output "agent_ecr_repository_url" {
  description = "Terraform-created sandbox-agent ECR repository URL when enabled."
  value       = var.create_ecr_repositories ? aws_ecr_repository.agent[0].repository_url : null
}

output "manager_image" {
  description = "Manager image URI configured on the ECS task definition."
  value       = local.manager_image_uri
}

output "agent_image" {
  description = "Default sandbox-agent image URI passed to the manager."
  value       = local.agent_image_uri
}

output "cloud_map_service_arn" {
  description = "Cloud Map service ARN when enabled."
  value       = var.enable_cloud_map ? aws_service_discovery_service.manager[0].arn : null
}
