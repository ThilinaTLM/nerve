---
title: Python execution
description: Configure finite Python scripts and retrieve bounded results and artifacts.
sidebar:
  order: 2
---

Python is optional. Runtime discovery and execution happen on the workbench daemon host, so a remote connection uses Python installed on that host. Nerve omits `python_exec` when no runtime is discovered, and Settings can disable the tool or set the executable path. A Python path change is the server setting confirmed to refresh runtime availability immediately.

A call accepts exactly one inline script or script-file path. It is finite, non-interactive, has no stdin, and allows a timeout up to 600 seconds. Large output and files can be written under `NERVE_PYTHON_ARTIFACT_DIR` and returned as artifacts.

Environment overrides with sensitive-looking keys are rejected so an agent cannot casually supply obvious secrets through the tool argument. This does not scrub secrets inherited by the Python process or printed by user code.

## Choose tasks for servers

Do not use Python execution for web servers, watchers, daemons, or scripts waiting for input. Use a supervised [background task](/guides/background-tasks/).

:::caution[Not a hard sandbox]
Planning mode can restrict ordinary writes to the artifact directory and can disable network access, but source comments explicitly exclude protection against malicious Python, native extensions, or filesystem tricks. Treat Python as local code execution.
:::

## Next steps

- [Background tasks](/guides/background-tasks/)
- [Remote daemon behavior](/operations/remote-daemon/)
- [Tool and permission policy](/developers/tools-policy/)
