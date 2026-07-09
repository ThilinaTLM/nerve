terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.0"
    }
  }
}

locals {
  tags = merge(
    {
      Project   = "nerve"
      ManagedBy = "Terraform"
      Owner     = var.owner
      Component = "sandbox"
    },
    var.additional_tags,
  )

  efs_file_system_id = var.create_efs ? aws_efs_file_system.sandbox[0].id : var.efs_file_system_id

  manager_image_uri = var.manager_image != null ? var.manager_image : "${try(aws_ecr_repository.manager[0].repository_url, "missing-manager-repository")}:${var.image_tag}"
  agent_image_uri   = var.agent_image != null ? var.agent_image : "${try(aws_ecr_repository.agent[0].repository_url, "missing-agent-repository")}:${var.image_tag}"

  database_url_parameter_arn          = var.create_rds ? try(aws_ssm_parameter.manager_database_url[0].arn, null) : var.database_url_parameter_arn
  secret_encryption_key_parameter_arn = var.secret_encryption_key_parameter_arn != null ? var.secret_encryption_key_parameter_arn : try(aws_ssm_parameter.manager_secret_encryption_key[0].arn, null)
  manager_database_ssl                = var.database_ssl == null ? var.create_rds : var.database_ssl

  cloud_map_callback_url = var.enable_cloud_map && var.cloud_map_namespace_name != null ? "http://${var.cloud_map_service_name}.${var.cloud_map_namespace_name}:${var.manager_port}" : null
  callback_url           = coalesce(var.manager_callback_url, local.cloud_map_callback_url, "http://${aws_lb.manager.dns_name}")

  trusted_proxy_cidrs = join(",", concat(
    [for subnet in var.task_subnet_ids : data.aws_subnet.task[subnet].cidr_block],
    [for subnet in var.alb_subnet_ids : data.aws_subnet.alb[subnet].cidr_block],
  ))

  sandbox_capacity_provider_strategy = [
    for item in var.sandbox_capacity_provider_strategy : merge(
      { capacityProvider = item.capacity_provider },
      item.weight == null ? {} : { weight = item.weight },
      item.base == null ? {} : { base = item.base },
    )
  ]

  manager_secrets = concat(
    local.database_url_parameter_arn == null ? [] : [{ name = "NERVE_SANDBOX_MANAGER_DATABASE_URL", valueFrom = local.database_url_parameter_arn }],
    var.api_key_parameter_arn == null ? [] : [{ name = "NERVE_SANDBOX_MANAGER_API_KEY", valueFrom = var.api_key_parameter_arn }],
    local.secret_encryption_key_parameter_arn == null ? [] : [{ name = "NERVE_SANDBOX_MANAGER_SECRET_ENCRYPTION_KEY", valueFrom = local.secret_encryption_key_parameter_arn }],
  )

  manager_secret_sources = compact([
    local.database_url_parameter_arn,
    var.api_key_parameter_arn,
    local.secret_encryption_key_parameter_arn,
  ])

  ssm_parameter_arns = [for arn in local.manager_secret_sources : arn if strcontains(arn, ":parameter/")]
  secrets_manager_arns = [
    for arn in local.manager_secret_sources : arn
    if strcontains(arn, ":secret:") || strcontains(arn, ":secret/")
  ]

  execution_secret_policy_statements = concat(
    length(local.ssm_parameter_arns) == 0 ? [] : [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameter", "ssm:GetParameters"]
      Resource = local.ssm_parameter_arns
    }],
    length(local.secrets_manager_arns) == 0 ? [] : [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = local.secrets_manager_arns
    }],
    length(var.ssm_parameter_kms_key_arns) == 0 ? [] : [{
      Effect   = "Allow"
      Action   = ["kms:Decrypt"]
      Resource = var.ssm_parameter_kms_key_arns
    }],
  )

  ecr_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images"
        selection = {
          tagStatus   = "untagged"
          countType   = "imageCountMoreThan"
          countNumber = var.ecr_max_untagged_images
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Retain latest tagged images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.ecr_max_tagged_images
        }
        action = { type = "expire" }
      },
    ]
  })
}

data "aws_subnet" "task" {
  for_each = toset(var.task_subnet_ids)
  id       = each.value
}

data "aws_subnet" "alb" {
  for_each = toset(var.alb_subnet_ids)
  id       = each.value
}

resource "aws_ecr_repository" "manager" {
  count                = var.create_ecr_repositories ? 1 : 0
  name                 = coalesce(var.manager_ecr_repository_name, "${var.name_prefix}-sandbox-manager")
  image_tag_mutability = "MUTABLE"
  force_delete         = var.ecr_force_delete
  tags                 = local.tags

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_repository" "agent" {
  count                = var.create_ecr_repositories ? 1 : 0
  name                 = coalesce(var.agent_ecr_repository_name, "${var.name_prefix}-sandbox-agent")
  image_tag_mutability = "MUTABLE"
  force_delete         = var.ecr_force_delete
  tags                 = local.tags

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "manager" {
  count      = var.create_ecr_repositories ? 1 : 0
  repository = aws_ecr_repository.manager[0].name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "agent" {
  count      = var.create_ecr_repositories ? 1 : 0
  repository = aws_ecr_repository.agent[0].name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecs_cluster" "sandbox" {
  name = "${var.name_prefix}-cluster"
  tags = local.tags
}

resource "aws_ecs_cluster_capacity_providers" "sandbox" {
  cluster_name       = aws_ecs_cluster.sandbox.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
}

resource "aws_cloudwatch_log_group" "manager" {
  name              = "/aws/ecs/${var.name_prefix}/manager"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "sandbox" {
  name              = "/aws/ecs/${var.name_prefix}/sandbox-agent"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "Browser access to the sandbox manager ALB"
  vpc_id      = var.vpc_id
  tags        = local.tags

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.alb_ingress_cidrs
  }

  dynamic "ingress" {
    for_each = var.alb_certificate_arn == null ? [] : [1]
    content {
      description = "HTTPS"
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      cidr_blocks = var.alb_ingress_cidrs
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "manager" {
  name        = "${var.name_prefix}-manager"
  description = "Sandbox manager task"
  vpc_id      = var.vpc_id
  tags        = local.tags

  ingress {
    description     = "ALB to manager"
    from_port       = var.manager_port
    to_port         = var.manager_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "Sandbox callback traffic to manager"
    from_port       = var.manager_port
    to_port         = var.manager_port
    protocol        = "tcp"
    security_groups = [aws_security_group.sandbox.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "sandbox" {
  name        = "${var.name_prefix}-sandbox"
  description = "Sandbox agent tasks launched by the manager"
  vpc_id      = var.vpc_id
  tags        = local.tags

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "efs" {
  name        = "${var.name_prefix}-efs"
  description = "EFS NFS access from manager and sandbox tasks"
  vpc_id      = var.vpc_id
  tags        = local.tags

  ingress {
    description     = "NFS from manager"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.manager.id]
  }

  ingress {
    description     = "NFS from sandboxes"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.sandbox.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  count       = var.create_rds ? 1 : 0
  name        = "${var.name_prefix}-postgres"
  description = "PostgreSQL access for the sandbox manager"
  vpc_id      = var.vpc_id
  tags        = local.tags

  ingress {
    description     = "PostgreSQL from manager"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.manager.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_efs_file_system" "sandbox" {
  count          = var.create_efs ? 1 : 0
  encrypted      = true
  creation_token = var.name_prefix
  tags           = local.tags

  dynamic "lifecycle_policy" {
    for_each = var.efs_transition_to_ia == null ? [] : [var.efs_transition_to_ia]
    content {
      transition_to_ia = lifecycle_policy.value
    }
  }
}

resource "aws_efs_access_point" "manager" {
  count          = var.create_efs ? 1 : 0
  file_system_id = aws_efs_file_system.sandbox[0].id
  tags           = local.tags

  posix_user {
    uid = 0
    gid = 0
  }

  root_directory {
    path = var.efs_root_directory

    creation_info {
      owner_uid   = 0
      owner_gid   = 0
      permissions = "0777"
    }
  }
}

resource "aws_efs_mount_target" "sandbox" {
  for_each        = toset(var.create_efs ? var.task_subnet_ids : [])
  file_system_id  = aws_efs_file_system.sandbox[0].id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

resource "random_password" "rds" {
  count            = var.create_rds ? 1 : 0
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "random_password" "manager_secret_encryption_key" {
  count   = var.secret_encryption_key_parameter_arn == null ? 1 : 0
  length  = 64
  special = false
}

resource "aws_db_subnet_group" "manager" {
  count      = var.create_rds ? 1 : 0
  name       = substr(replace(lower("${var.name_prefix}-postgres"), "_", "-"), 0, 63)
  subnet_ids = var.rds_subnet_ids
  tags       = local.tags
}

resource "aws_db_instance" "manager" {
  count                        = var.create_rds ? 1 : 0
  identifier                   = substr(replace(lower("${var.name_prefix}-postgres"), "_", "-"), 0, 63)
  engine                       = "postgres"
  engine_version               = var.rds_engine_version
  instance_class               = var.rds_instance_class
  allocated_storage            = var.rds_allocated_storage_gb
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = var.rds_database_name
  username                     = var.rds_username
  password                     = random_password.rds[0].result
  port                         = 5432
  db_subnet_group_name         = aws_db_subnet_group.manager[0].name
  vpc_security_group_ids       = [aws_security_group.rds[0].id]
  publicly_accessible          = false
  multi_az                     = false
  backup_retention_period      = var.rds_backup_retention_period
  deletion_protection          = var.rds_deletion_protection
  skip_final_snapshot          = var.rds_skip_final_snapshot
  final_snapshot_identifier    = var.rds_skip_final_snapshot ? null : substr(replace(lower("${var.name_prefix}-postgres-final"), "_", "-"), 0, 63)
  auto_minor_version_upgrade   = true
  apply_immediately            = true
  performance_insights_enabled = false
  copy_tags_to_snapshot        = true
  tags                         = local.tags
}

resource "aws_ssm_parameter" "manager_database_url" {
  count  = var.create_rds ? 1 : 0
  name   = coalesce(var.database_url_parameter_name, "/${var.name_prefix}/sandbox-manager/database-url")
  type   = "SecureString"
  key_id = var.ssm_parameter_kms_key_id
  value  = "postgresql://${var.rds_username}:${urlencode(random_password.rds[0].result)}@${aws_db_instance.manager[0].address}:${aws_db_instance.manager[0].port}/${var.rds_database_name}"
  tags   = local.tags
}

resource "aws_ssm_parameter" "manager_secret_encryption_key" {
  count  = var.secret_encryption_key_parameter_arn == null ? 1 : 0
  name   = "/${var.name_prefix}/sandbox-manager/secret-encryption-key"
  type   = "SecureString"
  key_id = var.ssm_parameter_kms_key_id
  value  = random_password.manager_secret_encryption_key[0].result
  tags   = local.tags
}

resource "aws_iam_role" "execution" {
  name = substr("${var.name_prefix}-execution", 0, 64)
  tags = local.tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  count = var.create_rds || var.database_url_parameter_arn != null || var.api_key_parameter_arn != null || var.secret_encryption_key_parameter_arn != null || length(var.ssm_parameter_kms_key_arns) > 0 ? 1 : 0
  name  = "${var.name_prefix}-execution-secrets"
  role  = aws_iam_role.execution.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.execution_secret_policy_statements
  })
}

resource "aws_iam_role" "manager_task" {
  name = substr("${var.name_prefix}-manager-task", 0, 64)
  tags = local.tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role" "sandbox_task" {
  name = substr("${var.name_prefix}-sandbox-task", 0, 64)
  tags = local.tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "manager_runtime" {
  name = "${var.name_prefix}-manager-runtime"
  role = aws_iam_role.manager_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:DescribeClusters",
          "ecs:RegisterTaskDefinition",
          "ecs:DeregisterTaskDefinition",
          "ecs:RunTask",
          "ecs:StopTask",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:TagResource"
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = [aws_iam_role.execution.arn, aws_iam_role.sandbox_task.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:GetLogEvents", "logs:DescribeLogStreams"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lb" "manager" {
  name               = substr("${var.name_prefix}-manager", 0, 32)
  internal           = var.alb_internal
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.alb_subnet_ids
  tags               = local.tags
}

resource "aws_lb_target_group" "manager" {
  name        = substr("${var.name_prefix}-manager", 0, 32)
  port        = var.manager_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id
  tags        = local.tags

  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.manager.arn
  port              = 80
  protocol          = "HTTP"
  tags              = local.tags

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.manager.arn
  }
}

resource "aws_lb_listener" "https" {
  count             = var.alb_certificate_arn == null ? 0 : 1
  load_balancer_arn = aws_lb.manager.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.alb_certificate_arn
  tags              = local.tags

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.manager.arn
  }
}

resource "aws_service_discovery_service" "manager" {
  count = var.enable_cloud_map ? 1 : 0
  name  = var.cloud_map_service_name

  dns_config {
    namespace_id = var.cloud_map_namespace_id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  tags = local.tags
}

resource "aws_ecs_task_definition" "manager" {
  family                   = "${var.name_prefix}-manager"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.manager_cpu)
  memory                   = tostring(var.manager_memory_mb)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.manager_task.arn
  tags                     = local.tags

  volume {
    name = "sandbox-efs"

    efs_volume_configuration {
      file_system_id     = local.efs_file_system_id
      root_directory     = var.create_efs ? "/" : var.efs_root_directory
      transit_encryption = "ENABLED"

      dynamic "authorization_config" {
        for_each = var.create_efs ? [aws_efs_access_point.manager[0].id] : []
        content {
          access_point_id = authorization_config.value
        }
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = "sandbox-manager"
      image     = local.manager_image_uri
      essential = true
      portMappings = [{
        containerPort = var.manager_port
        hostPort      = var.manager_port
        protocol      = "tcp"
      }]
      mountPoints = [{
        sourceVolume  = "sandbox-efs"
        containerPath = var.efs_manager_mount_path
        readOnly      = false
      }]
      environment = concat([
        { name = "NERVE_SANDBOX_MANAGER_HOST", value = "0.0.0.0" },
        { name = "NERVE_SANDBOX_MANAGER_PORT", value = tostring(var.manager_port) },
        { name = "NERVE_SANDBOX_MANAGER_ALLOW_REMOTE_BIND", value = "true" },
        { name = "NERVE_SANDBOX_MANAGER_STORAGE_DIR", value = "${var.efs_manager_mount_path}/manager-state" },
        { name = "NERVE_SANDBOX_MANAGER_BACKEND", value = "ecs" },
        { name = "NERVE_SANDBOX_MANAGER_VOLUME_BACKEND", value = "efs" },
        { name = "NERVE_SANDBOX_MANAGER_DATABASE_SSL", value = local.manager_database_ssl ? "true" : "false" },
        { name = "NERVE_SANDBOX_MANAGER_AWS_REGION", value = var.aws_region },
        { name = "NERVE_SANDBOX_MANAGER_PUBLIC_URL", value = local.callback_url },
        { name = "NERVE_SANDBOX_MANAGER_ECS_CLUSTER_ARN", value = aws_ecs_cluster.sandbox.arn },
        { name = "NERVE_SANDBOX_MANAGER_ECS_SUBNETS", value = join(",", var.task_subnet_ids) },
        { name = "NERVE_SANDBOX_MANAGER_ECS_SECURITY_GROUPS", value = aws_security_group.sandbox.id },
        { name = "NERVE_SANDBOX_MANAGER_ECS_ASSIGN_PUBLIC_IP", value = var.sandbox_assign_public_ip ? "ENABLED" : "DISABLED" },
        { name = "NERVE_SANDBOX_MANAGER_ECS_TASK_EXECUTION_ROLE_ARN", value = aws_iam_role.execution.arn },
        { name = "NERVE_SANDBOX_MANAGER_ECS_SANDBOX_TASK_ROLE_ARN", value = aws_iam_role.sandbox_task.arn },
        { name = "NERVE_SANDBOX_MANAGER_ECS_LOG_GROUP", value = aws_cloudwatch_log_group.sandbox.name },
        { name = "NERVE_SANDBOX_MANAGER_ECS_LOG_STREAM_PREFIX", value = "sandbox" },
        { name = "NERVE_SANDBOX_MANAGER_EFS_FILE_SYSTEM_ID", value = local.efs_file_system_id },
        { name = "NERVE_SANDBOX_MANAGER_EFS_MOUNT_ROOT", value = var.efs_manager_mount_path },
        { name = "NERVE_SANDBOX_MANAGER_EFS_ROOT_DIRECTORY", value = var.efs_root_directory },
        { name = "NERVE_SANDBOX_MANAGER_EFS_TRANSIT_ENCRYPTION", value = "ENABLED" },
        { name = "NERVE_SANDBOX_MANAGER_SERVE_WEB_UI", value = "true" },
        { name = "NERVE_SANDBOX_MANAGER_UI_AUTH_COOKIE_MODE", value = "trusted_proxy" },
        { name = "NERVE_SANDBOX_MANAGER_TRUSTED_PROXY_CIDRS", value = local.trusted_proxy_cidrs },
        { name = "NERVE_SANDBOX_MANAGER_DEFAULT_SANDBOX_IMAGE", value = local.agent_image_uri }
        ], var.trusted_proxy_auth_header == null ? [] : [
        { name = "NERVE_SANDBOX_MANAGER_TRUSTED_PROXY_AUTH_HEADER", value = var.trusted_proxy_auth_header }
        ], length(local.sandbox_capacity_provider_strategy) == 0 ? [] : [
        { name = "NERVE_SANDBOX_MANAGER_ECS_CAPACITY_PROVIDER_STRATEGY", value = jsonencode(local.sandbox_capacity_provider_strategy) }
      ])
      secrets = local.manager_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.manager.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "manager"
        }
      }
    }
  ])

  lifecycle {
    precondition {
      condition     = var.manager_image != null || var.create_ecr_repositories
      error_message = "manager_image must be set when create_ecr_repositories=false."
    }

    precondition {
      condition     = var.agent_image != null || var.create_ecr_repositories
      error_message = "agent_image must be set when create_ecr_repositories=false."
    }

    precondition {
      condition     = var.create_rds || var.database_url_parameter_arn != null
      error_message = "database_url_parameter_arn must be set when create_rds=false."
    }

    precondition {
      condition     = var.create_efs || var.efs_file_system_id != null
      error_message = "efs_file_system_id must be set when create_efs=false."
    }

    precondition {
      condition     = !var.enable_cloud_map || (var.cloud_map_namespace_id != null && var.cloud_map_namespace_name != null)
      error_message = "cloud_map_namespace_id and cloud_map_namespace_name are required when enable_cloud_map=true."
    }
  }
}

resource "aws_ecs_service" "manager" {
  name            = "${var.name_prefix}-manager"
  cluster         = aws_ecs_cluster.sandbox.id
  task_definition = aws_ecs_task_definition.manager.arn
  desired_count   = var.manager_desired_count
  launch_type     = length(var.manager_capacity_provider_strategy) == 0 ? "FARGATE" : null
  tags            = local.tags

  dynamic "capacity_provider_strategy" {
    for_each = var.manager_capacity_provider_strategy
    content {
      capacity_provider = capacity_provider_strategy.value.capacity_provider
      weight            = capacity_provider_strategy.value.weight
      base              = capacity_provider_strategy.value.base
    }
  }

  network_configuration {
    subnets          = var.task_subnet_ids
    security_groups  = [aws_security_group.manager.id]
    assign_public_ip = var.manager_assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.manager.arn
    container_name   = "sandbox-manager"
    container_port   = var.manager_port
  }

  dynamic "service_registries" {
    for_each = var.enable_cloud_map ? [1] : []
    content {
      registry_arn = aws_service_discovery_service.manager[0].arn
    }
  }

  depends_on = [
    aws_ecs_cluster_capacity_providers.sandbox,
    aws_efs_mount_target.sandbox,
    aws_lb_listener.http,
    aws_iam_role_policy.manager_runtime,
    aws_iam_role_policy.execution_secrets,
    aws_iam_role_policy_attachment.execution,
  ]
}
