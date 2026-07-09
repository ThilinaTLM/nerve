#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: build-push-sandbox-manager-image.sh

Builds the sandbox-manager image for AWS nonprod/dev and pushes it to the ECR
image URI configured by this Terraform environment.

Environment:
  AWS_CLI                                      AWS CLI executable (default: aws)
  TERRAFORM_CLI                                Terraform executable (default: terraform)
  NERVE_CONTAINER_CLI                          Container CLI executable (default: docker)
  NERVE_SANDBOX_MANAGER_IMAGE                  Override the Terraform manager_image output
  NERVE_SANDBOX_MANAGER_INSTALL_LOCAL_RUNTIMES Manager image build arg (default: false)
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi
if [[ $# -ne 0 ]]; then
  echo "Unknown argument: $1" >&2
  usage
  exit 2
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../../../../.." && pwd)
# shellcheck source=../../../scripts/ecr-docker-auth.sh
source "$REPO_ROOT/deploy/aws/scripts/ecr-docker-auth.sh"

AWS_CLI=${AWS_CLI:-aws}
TERRAFORM_CLI=${TERRAFORM_CLI:-terraform}
CONTAINER_CLI=${NERVE_CONTAINER_CLI:-docker}
MANAGER_INSTALL_LOCAL_RUNTIMES=${NERVE_SANDBOX_MANAGER_INSTALL_LOCAL_RUNTIMES:-false}

terraform_output() {
  "$TERRAFORM_CLI" -chdir="$SCRIPT_DIR" output -raw "$1"
}

resolve_image() {
  if [[ -n "${NERVE_SANDBOX_MANAGER_IMAGE:-}" ]]; then
    printf '%s' "$NERVE_SANDBOX_MANAGER_IMAGE"
    return
  fi

  local image
  if ! image=$(terraform_output manager_image); then
    echo "Failed to read Terraform output 'manager_image'. Run terraform init/apply in $SCRIPT_DIR first." >&2
    exit 1
  fi
  if [[ -z "$image" || "$image" == "null" ]]; then
    echo "Terraform output 'manager_image' is empty." >&2
    exit 1
  fi
  printf '%s' "$image"
}

IMAGE=$(resolve_image)
ensure_ecr_docker_auth "$IMAGE"

echo "Building sandbox-manager image: $IMAGE"
(
  cd "$REPO_ROOT"
  NERVE_CONTAINER_CLI="$CONTAINER_CLI" \
    NERVE_SANDBOX_MANAGER_IMAGE="$IMAGE" \
    NERVE_SANDBOX_MANAGER_INSTALL_LOCAL_RUNTIMES="$MANAGER_INSTALL_LOCAL_RUNTIMES" \
    pnpm build-image:sandbox-manager
)

echo "Pushing sandbox-manager image: $IMAGE"
"$CONTAINER_CLI" push "$IMAGE"

echo "Pushed sandbox-manager image to AWS nonprod/dev: $IMAGE"
