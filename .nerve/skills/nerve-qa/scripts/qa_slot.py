#!/usr/bin/env python3
"""Prepare and inspect a Nerve development slot for hands-on QA.

Subcommands (all take --slot N, default 1):
  status         Paths, ports, running state, default model, launch definition.
  ensure-launch  Add/update the `desktop-dev-slot-N` launch definition with CDP enabled.
  set-model      Set the slot's default agent model (slot must be stopped).
  copy-secrets   Replace the slot's secrets with ~/.nerve/secrets (slot must be stopped).

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


def cmd_copy_secrets(info: dict, source: Path) -> None:
    require_not_own_home(info)
    if not (source / "credentials.enc").is_file():
        sys.exit(f"{source} has no credentials.enc; nothing to copy.")
    if not info["home"].exists():
        sys.exit(f"{info['home']} does not exist. Start the slot once first.")
    require_stopped(info)
    target = info["home"] / "secrets"
    if target.exists():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = REPO / "data" / "secrets-backups" / f"storage-{info['slot']}-{stamp}"
        backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.move(str(target), backup)
        print(f"Backed up previous secrets to {backup}")
    target.mkdir(mode=0o700)
    for item in source.iterdir():
        if item.is_file():
            shutil.copy2(item, target / item.name)
            os.chmod(target / item.name, 0o600)
    # File names only; never print secret contents.
    names = ", ".join(sorted(p.name for p in target.iterdir()))
    print(f"Copied {source} -> {target} ({names}).")


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
    args = parser.parse_args()
    info = slot_info(args.slot)
    if args.command == "status":
        cmd_status(info)
    elif args.command == "ensure-launch":
        cmd_ensure_launch(info)
    elif args.command == "set-model":
        cmd_set_model(info, args.provider, args.model)
    else:
        cmd_copy_secrets(info, args.source.expanduser())


if __name__ == "__main__":
    main()
