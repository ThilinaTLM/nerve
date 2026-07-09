#!/usr/bin/env bash
# Shared ECR/Docker auth helpers for AWS deployment scripts.

extract_ecr_registry() {
  local image_uri=$1
  local registry=${image_uri#*://}
  registry=${registry%%/*}
  if [[ ! "$registry" =~ ^[0-9]+\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com(\.cn)?$ ]]; then
    echo "Expected an AWS ECR image URI, got: $image_uri" >&2
    return 2
  fi
  printf '%s' "$registry"
}

extract_ecr_region() {
  local registry=$1
  if [[ ! "$registry" =~ ^[0-9]+\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com(\.cn)?$ ]]; then
    echo "Expected an AWS ECR registry, got: $registry" >&2
    return 2
  fi
  printf '%s' "${BASH_REMATCH[1]}"
}

image_auth_probe_uri() {
  local image_uri=${1%@*}
  if [[ "$image_uri" == */*:* ]]; then
    printf '%s:__nerve_auth_probe__' "${image_uri%:*}"
  else
    printf '%s:__nerve_auth_probe__' "$image_uri"
  fi
}

has_ecr_docker_auth() {
  local image_uri=$1
  local probe_uri output status
  probe_uri=$(image_auth_probe_uri "$image_uri")

  set +e
  output=$("$CONTAINER_CLI" manifest inspect "$probe_uri" 2>&1 >/dev/null)
  status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    return 0
  fi

  # A missing probe tag means Docker reached ECR with credentials accepted.
  if grep -Eiq 'manifest unknown|no such manifest|not found|name unknown|requested image not found' <<<"$output"; then
    return 0
  fi

  # Auth failures vary by Docker/credential helper version.
  if grep -Eiq 'no basic auth credentials|unauthorized|authentication required|authorization required|access.*denied|denied:' <<<"$output"; then
    return 1
  fi

  # Unknown probe failures are treated as unauthenticated so login can refresh credentials.
  return 1
}

ensure_ecr_docker_auth() {
  local image_uri=$1
  local registry region
  registry=$(extract_ecr_registry "$image_uri")
  region=$(extract_ecr_region "$registry")

  if has_ecr_docker_auth "$image_uri"; then
    echo "Docker is already authenticated to $registry"
    return 0
  fi

  echo "Docker is not authenticated to $registry; logging in with $AWS_CLI"
  "$AWS_CLI" ecr get-login-password --region "$region" |
    "$CONTAINER_CLI" login --username AWS --password-stdin "$registry"
}
