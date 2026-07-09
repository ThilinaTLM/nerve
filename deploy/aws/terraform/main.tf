terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  tags = merge(var.tags, {
    Project   = "nerve"
    Component = "sandbox"
  })

  efs_file_system_id     = var.create_efs ? aws_efs_file_system.sandbox[0].id : var.efs_file_system_id
  cloud_map_callback_url = var.enable_cloud_map && var.cloud_map_namespace_name != null ? "http://${var.cloud_map_service_name}.${var.cloud_map_namespace_name}:${var.manager_port}" : null
  callback_url           = coalesce(var.manager_callback_url, local.cloud_map_callback_url, "http://${aws_lb.manager.dns_name}")
  trusted_proxy_cidrs = join(",", concat(
    [for subnet in var.private_subnet_ids : data.aws_subnet.private[subnet].cidr_block],
    [for subnet in var.public_subnet_ids : data.aws_subnet.public[subnet].cidr_block]
  ))
  manager_secrets = concat(
    [{ name = "NERVE_SANDBOX_MANAGER_DATABASE_URL", valueFrom = var.database_url_secret_arn }],
    var.api_key_secret_arn == null ? [] : [{ name = "NERVE_SANDBOX_MANAGER_API_KEY", valueFrom = var.api_key_secret_arn }],
    var.secret_encryption_key_secret_arn == null ? [] : [{ name = "NERVE_SANDBOX_MANAGER_SECRET_ENCRYPTION_KEY", valueFrom = var.secret_encryption_key_secret_arn }]
  )
}

data "aws_subnet" "private" {
  for_each = toset(var.private_subnet_ids)
  id       = each.value
}

data "aws_subnet" "public" {
  for_each = toset(var.public_subnet_ids)
  id       = each.value
}

resource "aws_ecs_cluster" "sandbox" {
  name = "${var.name_prefix}-cluster"
  tags = local.tags
}

resource "aws_cloudwatch_log_group" "manager" {
  name              = "/aws/ecs/${var.name_prefix}/manager"
  retention_in_days = 30
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "sandbox" {
  name              = "/aws/ecs/${var.name_prefix}/sandbox-agent"
  retention_in_days = 30
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

resource "aws_efs_file_system" "sandbox" {
  count          = var.create_efs ? 1 : 0
  encrypted      = true
  creation_token = var.name_prefix
  tags           = local.tags
}

resource "aws_efs_mount_target" "sandbox" {
  for_each        = toset(var.create_efs ? var.private_subnet_ids : [])
  file_system_id  = aws_efs_file_system.sandbox[0].id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

resource "aws_iam_role" "execution" {
  name = "${var.name_prefix}-execution"
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

resource "aws_iam_role" "manager_task" {
  name = "${var.name_prefix}-manager-task"
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
  name = "${var.name_prefix}-sandbox-task"
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
  subnets            = var.public_subnet_ids
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

  health_check_custom_config {
    failure_threshold = 1
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
      root_directory     = var.efs_root_directory
      transit_encryption = "ENABLED"
    }
  }

  container_definitions = jsonencode([
    {
      name      = "sandbox-manager"
      image     = var.manager_image
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
        { name = "NERVE_SANDBOX_MANAGER_BACKEND", value = "ecs" },
        { name = "NERVE_SANDBOX_MANAGER_VOLUME_BACKEND", value = "efs" },
        { name = "NERVE_SANDBOX_MANAGER_AWS_REGION", value = var.aws_region },
        { name = "NERVE_SANDBOX_MANAGER_PUBLIC_URL", value = local.callback_url },
        { name = "NERVE_SANDBOX_MANAGER_ECS_CLUSTER_ARN", value = aws_ecs_cluster.sandbox.arn },
        { name = "NERVE_SANDBOX_MANAGER_ECS_SUBNETS", value = join(",", var.private_subnet_ids) },
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
        { name = "NERVE_SANDBOX_MANAGER_DEFAULT_SANDBOX_IMAGE", value = var.agent_image }
        ], var.trusted_proxy_auth_header == null ? [] : [
        { name = "NERVE_SANDBOX_MANAGER_TRUSTED_PROXY_AUTH_HEADER", value = var.trusted_proxy_auth_header }
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
}

resource "aws_ecs_service" "manager" {
  name            = "${var.name_prefix}-manager"
  cluster         = aws_ecs_cluster.sandbox.id
  task_definition = aws_ecs_task_definition.manager.arn
  desired_count   = var.manager_desired_count
  launch_type     = "FARGATE"
  tags            = local.tags

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.manager.id]
    assign_public_ip = false
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
    aws_lb_listener.http,
    aws_iam_role_policy.manager_runtime,
    aws_iam_role_policy_attachment.execution
  ]
}
