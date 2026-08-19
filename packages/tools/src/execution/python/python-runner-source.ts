// These guards block ordinary stdin/file-write/network APIs used by agent
// snippets. They are not a hard security sandbox against malicious Python,
// native extensions, interpreter internals, or symlink tricks.
export const RUNNER_SOURCE = `
import builtins
import io
import json
import os
import pathlib
import runpy
import shutil
import socket
import subprocess
import sys

user_path = sys.argv[1]
policy = json.loads(sys.argv[2])
allow_network = bool(policy.get("allowNetwork", True))
allow_filewrite = bool(policy.get("allowFileWrite", True))
artifact_dir_value = policy.get("artifactDir")
artifact_dir = os.path.abspath(artifact_dir_value) if isinstance(artifact_dir_value, str) and artifact_dir_value else None

STDIN_ERROR = "stdin is not available to the python_exec tool."
FILEWRITE_ERROR = "file writes are disabled for the python_exec tool in planning mode. Write generated artifacts under NERVE_PYTHON_ARTIFACT_DIR instead."
NETWORK_ERROR = "network access is disabled for the python_exec tool."

class _NoStdin:
    encoding = "utf-8"
    errors = "strict"
    closed = False

    def read(self, *args, **kwargs):
        raise RuntimeError(STDIN_ERROR)

    def readline(self, *args, **kwargs):
        raise RuntimeError(STDIN_ERROR)

    def readlines(self, *args, **kwargs):
        raise RuntimeError(STDIN_ERROR)

    def __iter__(self):
        raise RuntimeError(STDIN_ERROR)

    def fileno(self):
        raise RuntimeError(STDIN_ERROR)

    def isatty(self):
        return False

    def readable(self):
        return False

    def writable(self):
        return False

    def seekable(self):
        return False

builtins.input = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError(STDIN_ERROR))
sys.stdin = _NoStdin()

_WRITE_MODE_CHARS = set("wax+")
_WRITE_FLAG_BITS = 0
for _name in ("O_WRONLY", "O_RDWR", "O_CREAT", "O_TRUNC", "O_APPEND"):
    _WRITE_FLAG_BITS |= int(getattr(os, _name, 0) or 0)

def _mode_writes(mode):
    if mode is None:
        return False
    return any(ch in str(mode) for ch in _WRITE_MODE_CHARS)

def _flags_write(flags):
    try:
        return (int(flags) & _WRITE_FLAG_BITS) != 0
    except Exception:
        return False

def _path_in_artifact(path):
    if artifact_dir is None:
        return False
    try:
        target = os.path.abspath(os.fspath(path))
    except Exception:
        return False
    try:
        return os.path.commonpath([artifact_dir, target]) == artifact_dir
    except Exception:
        return False

def _check_filewrite_target(path):
    if allow_filewrite:
        return
    if _path_in_artifact(path):
        return
    raise PermissionError(FILEWRITE_ERROR)

def _deny_filewrite(*args, **kwargs):
    raise PermissionError(FILEWRITE_ERROR)

def _guarded_open_factory(original):
    def _guarded_open(file, mode="r", *args, **kwargs):
        if not allow_filewrite and _mode_writes(mode):
            _check_filewrite_target(file)
        return original(file, mode, *args, **kwargs)
    return _guarded_open

def _guarded_path_method(original):
    def _guarded(self, *args, **kwargs):
        _check_filewrite_target(self)
        return original(self, *args, **kwargs)
    return _guarded

def _guarded_path_move(original):
    def _guarded(self, target, *args, **kwargs):
        _check_filewrite_target(self)
        _check_filewrite_target(target)
        return original(self, target, *args, **kwargs)
    return _guarded

def _guarded_os_one(original):
    def _guarded(path, *args, **kwargs):
        _check_filewrite_target(path)
        return original(path, *args, **kwargs)
    return _guarded

def _guarded_os_two(original):
    def _guarded(src, dst, *args, **kwargs):
        _check_filewrite_target(src)
        _check_filewrite_target(dst)
        return original(src, dst, *args, **kwargs)
    return _guarded

def _guarded_shutil_copy(original):
    def _guarded(src, dst, *args, **kwargs):
        _check_filewrite_target(dst)
        return original(src, dst, *args, **kwargs)
    return _guarded

def _install_filewrite_guards():
    if allow_filewrite:
        return

    builtins.open = _guarded_open_factory(builtins.open)
    io.open = _guarded_open_factory(io.open)

    _path_open = pathlib.Path.open
    def _guarded_path_open(self, mode="r", *args, **kwargs):
        if _mode_writes(mode):
            _check_filewrite_target(self)
        return _path_open(self, mode, *args, **kwargs)
    pathlib.Path.open = _guarded_path_open

    for name in ("write_text", "write_bytes", "mkdir", "unlink", "rmdir", "touch"):
        if hasattr(pathlib.Path, name):
            setattr(pathlib.Path, name, _guarded_path_method(getattr(pathlib.Path, name)))
    for name in ("rename", "replace"):
        if hasattr(pathlib.Path, name):
            setattr(pathlib.Path, name, _guarded_path_move(getattr(pathlib.Path, name)))

    for module, names in (
        (os, ("remove", "unlink", "rmdir", "mkdir", "makedirs", "removedirs", "truncate")),
    ):
        for name in names:
            if hasattr(module, name):
                setattr(module, name, _guarded_os_one(getattr(module, name)))
    for name in ("rename", "replace"):
        if hasattr(os, name):
            setattr(os, name, _guarded_os_two(getattr(os, name)))

    for name in ("copy", "copy2", "copyfile", "copytree"):
        if hasattr(shutil, name):
            setattr(shutil, name, _guarded_shutil_copy(getattr(shutil, name)))
    for name in ("move",):
        if hasattr(shutil, name):
            setattr(shutil, name, _guarded_os_two(getattr(shutil, name)))
    for name in ("rmtree",):
        if hasattr(shutil, name):
            setattr(shutil, name, _guarded_os_one(getattr(shutil, name)))

    def _blocked_popen(*args, **kwargs):
        raise PermissionError(FILEWRITE_ERROR)
    subprocess.Popen = _blocked_popen
    subprocess.run = _blocked_popen
    subprocess.call = _blocked_popen
    subprocess.check_call = _blocked_popen
    subprocess.check_output = _blocked_popen

def _install_network_guards():
    if allow_network:
        return

    class _BlockedSocket(socket.socket):
        def __init__(self, *args, **kwargs):
            raise PermissionError(NETWORK_ERROR)

    def _blocked_create_connection(*args, **kwargs):
        raise PermissionError(NETWORK_ERROR)

    socket.socket = _BlockedSocket
    socket.create_connection = _blocked_create_connection

def _audit(event, args):
    if not allow_filewrite:
        if event == "open":
            path = args[0] if len(args) > 0 else None
            mode = args[1] if len(args) > 1 else None
            flags = args[2] if len(args) > 2 else 0
            if _mode_writes(mode) or _flags_write(flags):
                _check_filewrite_target(path)
        elif event in {
            "os.remove",
            "os.rmdir",
            "os.mkdir",
            "os.truncate",
            "shutil.rmtree",
        }:
            path = args[0] if len(args) > 0 else None
            _check_filewrite_target(path)
        elif event in {"os.rename", "os.replace"}:
            src = args[0] if len(args) > 0 else None
            dst = args[1] if len(args) > 1 else None
            _check_filewrite_target(src)
            _check_filewrite_target(dst)
        elif event == "subprocess.Popen":
            raise PermissionError(FILEWRITE_ERROR)
    if not allow_network and event.startswith("socket."):
        raise PermissionError(NETWORK_ERROR)

try:
    sys.addaudithook(_audit)
except Exception:
    pass

_install_filewrite_guards()
_install_network_guards()
user_dir = os.path.dirname(os.path.abspath(user_path))
if user_dir:
    sys.path.insert(0, user_dir)
runpy.run_path(user_path, run_name="__main__")
`;
