#!/usr/bin/env python3
"""Safe, narrow KDE/Wayland control for a single native GPUI window."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import struct
import subprocess
import sys
import time
from typing import Any, Sequence

DEFAULT_CLASS = "nerve-gpui-workbench"
WINDOW_ID_RE = re.compile(r"^\{[0-9a-fA-F-]{36}\}$")
GEOMETRY_RE = re.compile(
    r"Position:\s*(-?\d+),(-?\d+).*?Geometry:\s*(\d+)x(\d+)", re.DOTALL
)
POINTER_RE = re.compile(r"\bX=(-?\d+)\s+Y=(-?\d+)\b")
KEY_CODES = {
    "escape": 1,
    "tab": 15,
    "enter": 28,
    "space": 57,
    "left": 105,
    "right": 106,
    "up": 103,
    "down": 108,
}
MOVE_TOLERANCE = 4
MOVE_STEPS = 40


class DriverError(RuntimeError):
    pass


def run(
    command: Sequence[str],
    *,
    timeout: float = 10,
    env: dict[str, str] | None = None,
) -> str:
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
    except subprocess.TimeoutExpired as error:
        raise DriverError(f"Command timed out: {command[0]}") from error
    except OSError as error:
        raise DriverError(f"Could not run {command[0]}: {error}") from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        suffix = f": {detail[-1]}" if detail else ""
        raise DriverError(f"{command[0]} failed with exit {result.returncode}{suffix}")
    return result.stdout.strip()


def ydotool_socket() -> Path:
    configured = os.environ.get("YDOTOOL_SOCKET")
    return Path(configured) if configured else Path(f"/run/user/{os.getuid()}/.ydotool_socket")


def preflight() -> dict[str, Any]:
    tools = {name: shutil.which(name) for name in ("kdotool", "ydotool", "spectacle")}
    missing = [name for name, path in tools.items() if path is None]
    desktop_values = " ".join(
        os.environ.get(name, "")
        for name in ("XDG_CURRENT_DESKTOP", "DESKTOP_SESSION", "XDG_SESSION_DESKTOP")
    ).lower()
    socket_path = ydotool_socket()
    socket_ok = False
    try:
        socket_ok = stat.S_ISSOCK(socket_path.stat().st_mode) and os.access(
            socket_path, os.R_OK | os.W_OK
        )
    except OSError:
        pass

    failures: list[str] = []
    if platform.system() != "Linux":
        failures.append("Linux is required")
    if os.environ.get("XDG_SESSION_TYPE", "").lower() != "wayland":
        failures.append("a Wayland session is required")
    if "kde" not in desktop_values and "plasma" not in desktop_values:
        failures.append("KDE Plasma is required")
    if missing:
        failures.append(f"missing commands: {', '.join(missing)}")
    if not socket_ok:
        failures.append(f"ydotool socket is unavailable: {socket_path}")

    result = {
        "ok": not failures,
        "platform": platform.system(),
        "session": os.environ.get("XDG_SESSION_TYPE"),
        "desktop": desktop_values.strip(),
        "tools": tools,
        "ydotoolSocket": str(socket_path),
    }
    if failures:
        raise DriverError("; ".join(failures))
    return result


def validate_window_id(window_id: str) -> str:
    if not WINDOW_ID_RE.fullmatch(window_id):
        raise DriverError(f"Invalid KWin window UUID: {window_id!r}")
    return window_id


def resolve_window(window_class: str, explicit_id: str | None) -> str:
    if explicit_id:
        window_id = validate_window_id(explicit_id)
    else:
        pattern = f"^{re.escape(window_class)}$"
        output = run(["kdotool", "search", "--class", pattern])
        matches = [line.strip() for line in output.splitlines() if line.strip()]
        matches = [validate_window_id(match) for match in matches]
        if not matches:
            raise DriverError(f"No window has exact class {window_class!r}")
        if len(matches) != 1:
            raise DriverError(
                f"Expected exactly one {window_class!r} window, found {len(matches)}; "
                "pass --window with the intended KWin UUID"
            )
        window_id = matches[0]

    actual_class = run(["kdotool", "getwindowclassname", window_id])
    if actual_class != window_class:
        raise DriverError(
            f"Window {window_id} has class {actual_class!r}, expected {window_class!r}"
        )
    return window_id


def geometry(window_id: str) -> dict[str, int]:
    output = run(["kdotool", "getwindowgeometry", window_id])
    match = GEOMETRY_RE.search(output)
    if not match:
        raise DriverError(f"Could not parse KWin geometry for {window_id}")
    x, y, width, height = (int(value) for value in match.groups())
    return {"x": x, "y": y, "width": width, "height": height}


def active_window_id() -> str:
    output = run(["kdotool", "getactivewindow", "getwindowid"])
    candidates = [line.strip() for line in output.splitlines() if WINDOW_ID_RE.fullmatch(line.strip())]
    if not candidates:
        raise DriverError("KWin did not report an active window UUID")
    return candidates[-1]


def window_info(window_class: str, explicit_id: str | None) -> dict[str, Any]:
    window_id = resolve_window(window_class, explicit_id)
    return {
        "ok": True,
        "window": window_id,
        "class": run(["kdotool", "getwindowclassname", window_id]),
        "title": run(["kdotool", "getwindowname", window_id]),
        "active": active_window_id() == window_id,
        "geometry": geometry(window_id),
    }


def activate(window_class: str, explicit_id: str | None) -> str:
    window_id = resolve_window(window_class, explicit_id)
    run(["kdotool", "windowactivate", window_id])
    for _ in range(30):
        if active_window_id() == window_id:
            actual_class = run(["kdotool", "getwindowclassname", window_id])
            if actual_class != window_class:
                raise DriverError("Target window class changed during activation")
            return window_id
        time.sleep(0.05)
    raise DriverError(f"KWin did not activate target window {window_id}")


def png_dimensions(path: Path) -> tuple[int, int]:
    try:
        header = path.read_bytes()[:24]
    except OSError as error:
        raise DriverError(f"Could not read screenshot {path}: {error}") from error
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        raise DriverError(f"Screenshot is not a valid PNG: {path}")
    return struct.unpack(">II", header[16:24])


def capture(
    window_class: str, explicit_id: str | None, output: str
) -> dict[str, Any]:
    window_id = activate(window_class, explicit_id)
    current_geometry = geometry(window_id)
    path = Path(output).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    run(
        ["spectacle", "-b", "-n", "-a", "-S", "-o", str(path)],
        timeout=20,
    )
    if not path.is_file() or path.stat().st_size == 0:
        raise DriverError(f"Spectacle did not create screenshot: {path}")
    width, height = png_dimensions(path)
    if (width, height) != (
        current_geometry["width"],
        current_geometry["height"],
    ):
        raise DriverError(
            "Screenshot dimensions do not match window geometry; coordinates would be unsafe "
            f"(png={width}x{height}, window={current_geometry['width']}x{current_geometry['height']})"
        )
    return {
        "ok": True,
        "window": window_id,
        "path": str(path),
        "png": {"width": width, "height": height},
        "geometry": current_geometry,
    }


def pointer_position() -> tuple[int, int]:
    output = run(["kdotool", "getmouselocation", "--shell"])
    match = POINTER_RE.search(output.replace("\n", " "))
    if not match:
        raise DriverError("Could not parse pointer location from KWin")
    return int(match.group(1)), int(match.group(2))


def ydotool_env() -> dict[str, str]:
    env = os.environ.copy()
    env["YDOTOOL_SOCKET"] = str(ydotool_socket())
    return env


def proportional_step(delta: int) -> int:
    if delta == 0:
        return 0
    step = int(delta / 4)
    if step == 0:
        return 1 if delta > 0 else -1
    return step


def move_pointer(
    window_class: str,
    explicit_id: str | None,
    relative_x: int,
    relative_y: int,
) -> dict[str, Any]:
    window_id = activate(window_class, explicit_id)
    bounds = geometry(window_id)
    if not (0 <= relative_x < bounds["width"] and 0 <= relative_y < bounds["height"]):
        raise DriverError(
            f"Point ({relative_x}, {relative_y}) is outside the {bounds['width']}x{bounds['height']} target window"
        )
    target_x = bounds["x"] + relative_x
    target_y = bounds["y"] + relative_y

    converged = False
    for _ in range(MOVE_STEPS):
        current_x, current_y = pointer_position()
        delta_x = target_x - current_x
        delta_y = target_y - current_y
        if abs(delta_x) <= MOVE_TOLERANCE and abs(delta_y) <= MOVE_TOLERANCE:
            converged = True
            break
        run(
            [
                "ydotool",
                "mousemove",
                "--",
                str(proportional_step(delta_x)),
                str(proportional_step(delta_y)),
            ],
            timeout=3,
            env=ydotool_env(),
        )
        time.sleep(0.08)

    final_x, final_y = pointer_position()
    if not converged and (
        abs(target_x - final_x) > MOVE_TOLERANCE
        or abs(target_y - final_y) > MOVE_TOLERANCE
    ):
        raise DriverError(
            f"Pointer did not converge safely (target={target_x},{target_y}, actual={final_x},{final_y})"
        )
    if not (
        bounds["x"] <= final_x < bounds["x"] + bounds["width"]
        and bounds["y"] <= final_y < bounds["y"] + bounds["height"]
    ):
        raise DriverError("Final pointer position is outside the target window")

    # Pointer traversal can change focus on focus-follows-mouse desktops. Raise
    # and verify the exact target again only after the pointer is safely inside.
    activate(window_class, window_id)
    if active_window_id() != window_id:
        raise DriverError("Target window lost focus after pointer movement")
    return {
        "ok": True,
        "window": window_id,
        "relative": {"x": final_x - bounds["x"], "y": final_y - bounds["y"]},
        "global": {"x": final_x, "y": final_y},
        "geometry": bounds,
    }


def click(
    window_class: str,
    explicit_id: str | None,
    relative_x: int,
    relative_y: int,
) -> dict[str, Any]:
    moved = move_pointer(window_class, explicit_id, relative_x, relative_y)
    window_id = moved["window"]
    if active_window_id() != window_id:
        raise DriverError("Refusing to click because the target window is not active")
    run(["ydotool", "click", "0xC0"], timeout=3, env=ydotool_env())
    time.sleep(0.12)
    if active_window_id() != window_id:
        raise DriverError("Target window changed immediately after click")
    moved["clicked"] = "left"
    return moved


def send_key(window_class: str, explicit_id: str | None, name: str) -> dict[str, Any]:
    window_id = activate(window_class, explicit_id)
    code = KEY_CODES[name]
    if active_window_id() != window_id:
        raise DriverError("Refusing to send a key because the target window is not active")
    run(
        ["ydotool", "key", f"{code}:1", f"{code}:0"],
        timeout=3,
        env=ydotool_env(),
    )
    time.sleep(0.08)
    return {"ok": True, "window": window_id, "key": name}


def resize(
    window_class: str,
    explicit_id: str | None,
    width: int,
    height: int,
) -> dict[str, Any]:
    if not (320 <= width <= 8192 and 240 <= height <= 8192):
        raise DriverError("Resize dimensions must be within 320x240 and 8192x8192")
    window_id = resolve_window(window_class, explicit_id)
    run(["kdotool", "windowsize", window_id, str(width), str(height)])
    actual = geometry(window_id)
    for _ in range(30):
        if actual["width"] == width and actual["height"] == height:
            break
        time.sleep(0.05)
        actual = geometry(window_id)
    if actual["width"] != width or actual["height"] != height:
        raise DriverError(
            f"Window resize did not settle at {width}x{height}; actual is {actual['width']}x{actual['height']}"
        )
    return {"ok": True, "window": window_id, "geometry": actual}


def add_window_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--class", dest="window_class", default=DEFAULT_CLASS)
    parser.add_argument("--window", help="Exact KWin UUID, including braces")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        description="Safely inspect and control one GPUI window on KDE Wayland"
    )
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("preflight")

    for name in ("info", "activate"):
        command = commands.add_parser(name)
        add_window_arguments(command)

    command = commands.add_parser("capture")
    add_window_arguments(command)
    command.add_argument("--output", required=True)

    for name in ("move", "click"):
        command = commands.add_parser(name)
        add_window_arguments(command)
        command.add_argument("--x", type=int, required=True, help="Window-relative x")
        command.add_argument("--y", type=int, required=True, help="Window-relative y")

    command = commands.add_parser("key")
    add_window_arguments(command)
    command.add_argument("--name", choices=sorted(KEY_CODES), required=True)

    command = commands.add_parser("resize")
    add_window_arguments(command)
    command.add_argument("--width", type=int, required=True)
    command.add_argument("--height", type=int, required=True)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "preflight":
            result = preflight()
        else:
            preflight()
            if args.command == "info":
                result = window_info(args.window_class, args.window)
            elif args.command == "activate":
                window_id = activate(args.window_class, args.window)
                result = window_info(args.window_class, window_id)
            elif args.command == "capture":
                result = capture(args.window_class, args.window, args.output)
            elif args.command == "move":
                result = move_pointer(
                    args.window_class, args.window, args.x, args.y
                )
            elif args.command == "click":
                result = click(args.window_class, args.window, args.x, args.y)
            elif args.command == "key":
                result = send_key(args.window_class, args.window, args.name)
            elif args.command == "resize":
                result = resize(
                    args.window_class,
                    args.window,
                    args.width,
                    args.height,
                )
            else:
                raise DriverError(f"Unknown command: {args.command}")
        print(json.dumps(result, sort_keys=True))
        return 0
    except DriverError as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
