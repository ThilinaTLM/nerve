locals {
  environment_tags = merge(
    {
      Environment = "nonprod"
      Stage       = "dev"
      CostProfile = "demo"
    },
    var.tags,
  )

  standard_tags = merge(
    {
      Project   = "nerve"
      ManagedBy = "Terraform"
      Owner     = var.owner
      Component = "sandbox"
    },
    local.environment_tags,
  )

  effective_rds_subnet_ids = length(var.rds_subnet_ids) == 0 ? var.task_subnet_ids : var.rds_subnet_ids
  cloud_map_enabled        = var.enable_cloud_map || var.create_cloud_map_namespace
  cloud_map_namespace_id   = var.create_cloud_map_namespace ? aws_service_discovery_private_dns_namespace.sandbox[0].id : var.cloud_map_namespace_id
  cloud_map_namespace_name = var.create_cloud_map_namespace ? aws_service_discovery_private_dns_namespace.sandbox[0].name : var.cloud_map_namespace_name
}

resource "aws_service_discovery_private_dns_namespace" "sandbox" {
  count       = var.create_cloud_map_namespace ? 1 : 0
  name        = var.cloud_map_private_dns_namespace_name
  description = "Private namespace for nonprod/dev sandbox manager callbacks"
  vpc         = var.vpc_id
  tags        = local.standard_tags
}

module "sandbox_manager" {
  source = "../../../modules/sandbox-manager"

  aws_region      = var.aws_region
  name_prefix     = var.name_prefix
  owner           = var.owner
  additional_tags = local.environment_tags

  vpc_id          = var.vpc_id
  alb_subnet_ids  = var.alb_subnet_ids
  task_subnet_ids = var.task_subnet_ids

  manager_image = var.manager_image
  agent_image   = var.agent_image
  image_tag     = var.image_tag

  create_ecr_repositories     = var.create_ecr_repositories
  manager_ecr_repository_name = var.manager_ecr_repository_name
  agent_ecr_repository_name   = var.agent_ecr_repository_name
  ecr_force_delete            = var.ecr_force_delete

  manager_cpu              = var.manager_cpu
  manager_memory_mb        = var.manager_memory_mb
  manager_desired_count    = var.manager_desired_count
  manager_assign_public_ip = var.manager_assign_public_ip
  sandbox_assign_public_ip = var.sandbox_assign_public_ip

  manager_capacity_provider_strategy = [
    {
      capacity_provider = "FARGATE_SPOT"
      weight            = 1
    }
  ]

  sandbox_capacity_provider_strategy = [
    {
      capacity_provider = "FARGATE_SPOT"
      weight            = 1
    }
  ]

  alb_internal        = var.alb_internal
  alb_ingress_cidrs   = var.alb_ingress_cidrs
  alb_certificate_arn = var.alb_certificate_arn

  create_rds                          = var.create_rds
  rds_subnet_ids                      = local.effective_rds_subnet_ids
  rds_database_name                   = var.rds_database_name
  rds_username                        = var.rds_username
  rds_engine_version                  = var.rds_engine_version
  rds_instance_class                  = var.rds_instance_class
  rds_allocated_storage_gb            = var.rds_allocated_storage_gb
  rds_backup_retention_period         = var.rds_backup_retention_period
  rds_deletion_protection             = var.rds_deletion_protection
  rds_skip_final_snapshot             = var.rds_skip_final_snapshot
  database_url_parameter_arn          = var.database_url_parameter_arn
  database_url_parameter_name         = var.database_url_parameter_name
  api_key_parameter_arn               = var.api_key_parameter_arn
  secret_encryption_key_parameter_arn = var.secret_encryption_key_parameter_arn
  database_ssl                        = var.database_ssl
  ssm_parameter_kms_key_id            = var.ssm_parameter_kms_key_id
  ssm_parameter_kms_key_arns          = var.ssm_parameter_kms_key_arns

  create_efs           = var.create_efs
  efs_file_system_id   = var.efs_file_system_id
  efs_root_directory   = var.efs_root_directory
  efs_transition_to_ia = var.efs_transition_to_ia

  log_retention_days = var.log_retention_days

  trusted_proxy_auth_header = var.trusted_proxy_auth_header
  manager_callback_url      = var.manager_callback_url
  enable_cloud_map          = local.cloud_map_enabled
  cloud_map_namespace_id    = local.cloud_map_namespace_id
  cloud_map_namespace_name  = local.cloud_map_namespace_name
  cloud_map_service_name    = var.cloud_map_service_name
}
