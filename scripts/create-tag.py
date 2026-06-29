#!/usr/bin/env python3
"""Create a Nerve release tag in one step.

Bumps the root and workspace package.json versions, commits the change,
deletes any existing local/remote tag, and creates a new annotated tag.
The commit/tag are not pushed automatically so you can review first.
"""

from __future__ import annotations

import argparse
import datetime
import pathlib
import re
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent


def run(cmd: list[str], check: bool = True, capture: bool = False) -> str:
    result = subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        text=True,
        capture_output=capture,
        check=check,
    )
    return result.stdout.strip() if capture else ""


def current_branch() -> str:
    return run(["git", "branch", "--show-current"], capture=True)


def working_tree_clean() -> bool:
    return run(["git", "status", "--short"], capture=True) == ""


def package_json_files() -> list[pathlib.Path]:
    files = [REPO_ROOT / "package.json"]
    files.extend(sorted((REPO_ROOT / "packages").glob("*/package.json")))
    return files


def update_version(path: pathlib.Path, version: str) -> bool:
    text = path.read_text(encoding="utf-8")
    updated = re.sub(
        r'^([ \t]*"version"[ \t]*:[ \t]*)"[^"]*"(.*)$',
        lambda m: f'{m.group(1)}"{version}"{m.group(2)}',
        text,
        flags=re.MULTILINE,
        count=1,
    )
    if updated == text:
        return False
    path.write_text(updated, encoding="utf-8")
    return True


def tag_exists_locally(tag: str) -> bool:
    return run(["git", "rev-parse", "-q", "--verify", f"refs/tags/{tag}"], check=False, capture=True) != ""


def tag_exists_remote(tag: str) -> bool:
    remote_ref = f"refs/tags/{tag}"
    return any(remote_ref in line for line in run(["git", "ls-remote", "--tags", "origin", remote_ref], check=False, capture=True).splitlines())


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a Nerve release tag.")
    parser.add_argument("version", help="Release version without the 'v' prefix (e.g. 0.3.0).")
    parser.add_argument(
        "-m", "--message",
        help="Tag annotation message. Defaults to 'v<version> - <date>'.",
    )
    parser.add_argument(
        "--branch",
        default="main",
        help="Branch the release must be made from (default: main).",
    )
    parser.add_argument(
        "--force-branch",
        action="store_true",
        help="Allow running from a branch other than the one specified by --branch.",
    )
    args = parser.parse_args()

    version = args.version.lstrip("v")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[-.A-Za-z0-9]+)?", version):
        print(f"Invalid version: {args.version}", file=sys.stderr)
        return 1

    tag = f"v{version}"
    today = datetime.date.today().isoformat()
    tag_message = args.message or f"{tag} - {today}"

    branch = current_branch()
    if branch != args.branch and not args.force_branch:
        print(f"Must be on the {args.branch} branch (currently on {branch}). Use --force-branch to override.", file=sys.stderr)
        return 1

    if not working_tree_clean():
        print("Working tree is not clean. Commit or stash changes first.", file=sys.stderr)
        return 1

    # Update versions.
    updated: list[pathlib.Path] = []
    for path in package_json_files():
        if update_version(path, version):
            updated.append(path)
            print(f"  updated {path.relative_to(REPO_ROOT)} -> {version}")

    if not updated:
        print("No package.json files were updated.", file=sys.stderr)
        return 1

    # Commit.
    run(["git", "add", "-u"])
    commit_message = f"chore(release): bump version to {tag}"
    run(["git", "commit", "-m", commit_message])
    commit = run(["git", "rev-parse", "HEAD"], capture=True)
    print(f"  committed {commit[:12]}: {commit_message}")

    # Remove existing tag locally and remotely.
    if tag_exists_locally(tag):
        run(["git", "tag", "-d", tag])
        print(f"  deleted local tag {tag}")

    if tag_exists_remote(tag):
        run(["git", "push", "--delete", "origin", tag])
        print(f"  deleted remote tag {tag}")

    # Create annotated tag.
    run(["git", "tag", "-a", tag, "-m", tag_message])
    print(f"  created annotated tag {tag}: {tag_message}")

    # Verify.
    try:
        run(["pnpm", "release:verify-tag", "--", tag])
        print(f"  verified {tag} against workspace versions")
    except subprocess.CalledProcessError as exc:
        print(f"  tag verification failed: {exc}", file=sys.stderr)
        return 1

    print()
    print("Review the commit/tag, then push:")
    print(f"  git show {tag}")
    print(f"  git push origin {branch} {tag}")
    if tag_exists_remote(tag):
        # Should not happen because we deleted it, but be explicit if the user re-runs.
        print(f"  (if origin already has {tag}, push with --force)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
