#!/usr/bin/env python3
"""Prepare and inspect a Nerve development slot for hands-on QA.

Subcommands (all take --slot N, default 1):
  status         Paths, ports, running state, default model, OAuth expiry, launch definition.
  ensure-launch  Add/update the `desktop-dev-slot-N` launch definition with CDP enabled.
  set-model      Set the slot's default agent model (slot must be stopped).
  copy-secrets   API keys, provider config and refresh-free OAuth access tokens from ~/.nerve (slot must be stopped).

Ports mirror scripts/development/storage-slot.ts:
  HTTP 43967 + 2*(N-1), HTTPS HTTP+1, CDP 9230 + N (slot 1 -> 9231; avoids
  Chrome's common 9222).
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
LAUNCH_FILE = REPO / ".nerve" / "launches" / "definitions.json"
DEFAULT_PROVIDER = "anthropic"
DEFAULT_MODEL = "claude-haiku-5-5"
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def slot_info(slot: int) -> dict:
    if not 1 <= slot <= 100:
        sys.exit("--slot must be an integer from 1 to 100")
    http = 43967 + 2 * (slot - 1)
    home = REPO / "data" / f"storage-{slot}"
    return {
        "slot": slot,
        "home": home,
        "http": http,
        "https": http + 1,
        "cdp": 9230 + slot,
        "label": f"desktop-dev-slot-{slot}",
    }


def listening(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def cdp_owner(port: int) -> str | None:
    """"electron", "other" (for example a Chrome on the same port), or None."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1) as response:
            agent = json.load(response).get("User-Agent", "")
    except (OSError, ValueError):
        return "other" if listening(port) else None
    return "electron" if "Electron/" in agent else "other"


def running(info: dict) -> bool:
    return listening(info["http"]) or listening(info["https"])


def require_stopped(info: dict) -> None:
    if running(info):
        sys.exit(
            f"Slot {info['slot']} is running (port {info['http']}). Stop it with the "
            f"launch tool (`{info['label']}`) first; never kill daemons by name or port."
        )


def require_not_own_home(info: dict) -> None:
    own = os.environ.get("NERVE_HOME")
    if own and Path(own).resolve() == info["home"].resolve():
        sys.exit("Refusing: this agent runs inside that slot. Pick another slot.")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def ulid() -> str:
    value = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    return "".join(CROCKFORD[(value >> shift) & 31] for shift in range(125, -1, -5))


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    os.replace(tmp, path)


def agent_config_path(info: dict) -> Path:
    return info["home"] / "config" / "agent.json"


def launch_command(info: dict) -> str:
    return (
        f"NERVE_ELECTRON_REMOTE_DEBUGGING_PORT={info['cdp']} "
        f"pnpm run desktop:dev --slot {info['slot']}"
    )


def cmd_status(info: dict) -> None:
    model = None
    config = agent_config_path(info)
    if config.exists():
        model = json.loads(config.read_text()).get("overrides", {}).get("model")
    definition = None
    if LAUNCH_FILE.exists():
        definition = next(
            (
                d
                for d in json.loads(LAUNCH_FILE.read_text()).get("definitions", [])
                if d.get("label") == info["label"]
            ),
            None,
        )
    print(
        json.dumps(
            {
                "slot": info["slot"],
                "home": str(info["home"]),
                "homeExists": info["home"].exists(),
                "ports": {"http": info["http"], "https": info["https"], "cdp": info["cdp"]},
                "daemonRunning": running(info),
                "cdpOwner": cdp_owner(info["cdp"]),
                "defaultModel": model,
                "oauth": slot_oauth_status(info) if (info["home"] / "secrets" / "credentials.enc").is_file() else [],
                "launchDefinition": definition
                and {
                    "label": definition["label"],
                    "command": definition["command"],
                    "cdpEnabled": definition["command"] == launch_command(info),
                },
            },
            indent=2,
        )
    )


def cmd_ensure_launch(info: dict) -> None:
    data = json.loads(LAUNCH_FILE.read_text()) if LAUNCH_FILE.exists() else {
        "version": 2,
        "folders": [],
        "definitions": [],
    }
    if data.get("version") != 2:
        sys.exit(f"Unsupported {LAUNCH_FILE} version {data.get('version')}; edit it manually.")
    command = launch_command(info)
    definitions = data["definitions"]
    existing = next((d for d in definitions if d.get("label") == info["label"]), None)
    if existing and existing["command"] == command:
        print(f"Launch definition `{info['label']}` is up to date.")
        return
    now = utc_now()
    if existing:
        existing["command"] = command
        existing["updatedAt"] = now
        action = "Updated"
    else:
        definitions.append(
            {
                "id": f"launchdef_{ulid()}",
                "label": info["label"],
                "command": command,
                "runPolicy": "single",
                "createdAt": now,
                "updatedAt": now,
                "scope": {"kind": "project"},
                "parentFolderId": None,
                "order": 1 + max((d.get("order", 0) for d in definitions), default=-1),
            }
        )
        action = "Added"
    LAUNCH_FILE.parent.mkdir(parents=True, exist_ok=True)
    write_json(LAUNCH_FILE, data)
    print(f"{action} launch definition `{info['label']}`: {command}")


def cmd_set_model(info: dict, provider: str, model: str) -> None:
    require_not_own_home(info)
    config = agent_config_path(info)
    if not config.exists():
        sys.exit(
            f"{config} does not exist yet. Start the slot once so it initializes, "
            "stop it, then rerun."
        )
    require_stopped(info)
    data = json.loads(config.read_text())
    overrides = data.setdefault("overrides", {})
    wanted = {"provider": provider, "modelId": model}
    if overrides.get("model") == wanted:
        print(f"Default model already {provider}/{model}.")
        return
    overrides["model"] = wanted
    data["revision"] = int(data.get("revision", 0)) + 1
    write_json(config, data)
    print(f"Default model set to {provider}/{model} in {config}.")


def backup_secrets(info: dict) -> None:
    target = info["home"] / "secrets"
    if not target.exists():
        return
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = REPO / "data" / "secrets-backups" / f"storage-{info['slot']}-{stamp}"
    backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    shutil.copytree(target, backup)
    print(f"Backed up previous secrets to {backup}")


def copy_full_secrets(info: dict, source: Path) -> None:
    """Old behaviour: copy the whole folder, including OAuth sessions (can log the source out)."""
    target = info["home"] / "secrets"
    backup_secrets(info)
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(mode=0o700)
    for item in source.iterdir():
        if item.is_file():
            shutil.copy2(item, target / item.name)
            os.chmod(target / item.name, 0o600)
    print(f"Copied {source} -> {target} (full copy, includes OAuth sessions).")


def copy_provider_config(info: dict, source_home: Path) -> None:
    """Copy provider/account config so credential ids match the copied API keys."""
    config = info["home"] / "config"
    config.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    def put(src: Path, name: str) -> None:
        dest = config / name
        if dest.exists():
            shutil.copy2(dest, config / f"{name}.bak-{stamp}")
        shutil.copy2(src, dest)
        print(f"Copied config/{src.name} -> config/{name}")

    def merge_accounts(src: Path, name: str) -> None:
        """Source accounts win by id; accounts only the slot has (test sites) stay."""
        dest = config / name
        if not dest.exists():
            put(src, name)
            return
        shutil.copy2(dest, config / f"{name}.bak-{stamp}")
        merged = json.loads(src.read_text())
        own = json.loads(dest.read_text()).get("profiles", {})
        for kind, profiles in own.items():
            ids = {p.get("id") for p in merged.setdefault("profiles", {}).setdefault(kind, [])}
            merged["profiles"][kind] += [p for p in profiles if p.get("id") not in ids]
        dest.write_text(json.dumps(merged, indent=2) + "\n")
        print(f"Merged config/{src.name} into config/{name} (slot-only accounts kept)")

    providers = source_home / "config" / "providers.json"
    if providers.is_file():
        put(providers, "providers.json")
    # Migration 0005 renamed integrations.json to accounts.json (same document).
    # Write the name the slot's version reads; if it has neither yet, write both.
    src = next(
        (p for p in (source_home / "config" / "accounts.json", source_home / "config" / "integrations.json") if p.is_file()),
        None,
    )
    if src:
        names = [n for n in ("accounts.json", "integrations.json") if (config / n).exists()] or [
            "accounts.json",
            "integrations.json",
        ]
        for name in names:
            merge_accounts(src, name)


def run_secrets_tool(*args: str) -> dict:
    cmd = ["pnpm", "exec", "tsx", str(Path(__file__).with_name("copy-secrets.ts")), *args]
    result = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "secrets tool failed")
    return json.loads(result.stdout.strip().splitlines()[-1])


def describe_expiry(provider: str, expires_ms: int) -> tuple[str, bool]:
    now = time.time() * 1000
    minutes = int((expires_ms - now) // 60000)
    local = datetime.fromtimestamp(expires_ms / 1000).strftime("%Y-%m-%d %H:%M:%S")
    remaining = f"{minutes} min left" if minutes > 0 else f"EXPIRED {-minutes} min ago"
    return f"OAuth {provider}: access token expires {local} local ({remaining})", minutes < 15


def cmd_copy_secrets(info: dict, source: Path, full: bool) -> None:
    require_not_own_home(info)
    if not (source / "credentials.enc").is_file():
        sys.exit(f"{source} has no credentials.enc; nothing to copy.")
    if not info["home"].exists():
        sys.exit(f"{info['home']} does not exist. Start the slot once first.")
    require_stopped(info)
    if full:
        copy_full_secrets(info, source)
        return
    if not (source / "master.key").is_file():
        sys.exit(f"{source} has no master.key; cannot decrypt it.")
    backup_secrets(info)
    (info["home"] / "secrets").mkdir(mode=0o700, exist_ok=True)
    try:
        summary = run_secrets_tool("copy", "--source", str(source.parent), "--target", str(info["home"]))
    except RuntimeError as error:
        sys.exit(f"copy failed (previous secrets are backed up):\n{error}")
    print(f"API keys copied from {source.parent} (read-only): {len(summary['apiKeys'])}")
    for name in summary["apiKeys"]:
        print(f"  {name}")
    copy_provider_config(info, source.parent)
    for s in summary["oauth"]:
        line, soon = describe_expiry(s["provider"], s["expires"])
        print(line + " (no refresh token copied)")
        if soon:
            print(
                f"  WARNING: {s['provider']} expires within 15 minutes; production may refresh it soon. "
                "Make a production request with that provider first, or rerun copy-secrets later."
            )
    if not summary["oauth"]:
        print("No OAuth sessions in the source: log in on production (Settings -> Providers -> Subscriptions).")
    print("Rerun copy-secrets when an access token expires; the slot cannot refresh it.")


def slot_oauth_status(info: dict) -> list | str:
    try:
        sessions = run_secrets_tool("oauth-status", "--home", str(info["home"]))["oauth"]
    except Exception as error:  # status must not fail on unreadable secrets
        return f"unreadable: {error}"
    return [
        {"provider": s["provider"], "expires": datetime.fromtimestamp(s["expires"] / 1000).astimezone().isoformat(timespec="seconds"),
         "minutesLeft": int((s["expires"] - time.time() * 1000) // 60000)}
        for s in sessions
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("status", "ensure-launch", "set-model", "copy-secrets"):
        p = sub.add_parser(name)
        p.add_argument("--slot", type=int, default=1)
        if name == "set-model":
            p.add_argument("--provider", default=DEFAULT_PROVIDER)
            p.add_argument("--model", default=DEFAULT_MODEL)
        if name == "copy-secrets":
            p.add_argument("--from", dest="source", type=Path, default=Path.home() / ".nerve" / "secrets")
            p.add_argument("--full", action="store_true", help="old behaviour: copy the whole folder incl. OAuth (can log the source out)")
    args = parser.parse_args()
    info = slot_info(args.slot)
    if args.command == "status":
        cmd_status(info)
    elif args.command == "ensure-launch":
        cmd_ensure_launch(info)
    elif args.command == "set-model":
        cmd_set_model(info, args.provider, args.model)
    else:
        cmd_copy_secrets(info, args.source.expanduser(), args.full)


if __name__ == "__main__":
    main()
