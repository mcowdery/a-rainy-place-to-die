"""The GPU queue of scripts/shotServer.mjs, for Python jobs that fill the GPU (the music generator).

    import gpu_lock
    gpu_lock.exclusive("radio generate")

waits until the shot scripts and benchmarks now running have finished, and holds new ones back until this process
ends. A holder is a file <pid>-<mode>.json in the temp folder's citypop-gpu/; see shotServer.mjs for the rules.
CITYPOP_GPU=off skips it.
"""
import atexit
import ctypes
import json
import os
import re
import sys
import tempfile
import time

DIR = os.path.join(tempfile.gettempdir(), "citypop-gpu")
WAIT = 15 * 60


def alive(pid):
    # Never os.kill(pid, 0) on Windows: any signal but Ctrl+C and Ctrl+Break terminates the process.
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except PermissionError:
            return True
        except OSError:
            return False
    kernel = ctypes.windll.kernel32
    handle = kernel.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return ctypes.GetLastError() == 5  # access denied: it's there
    code = ctypes.c_ulong()
    ok = kernel.GetExitCodeProcess(handle, ctypes.byref(code))
    kernel.CloseHandle(handle)
    return bool(ok) and code.value == 259  # STILL_ACTIVE


def holders():
    out = []
    try:
        names = os.listdir(DIR)
    except OSError:
        return out
    for name in names:
        m = re.match(r"^(\d+)-(shared|exclusive)\.json$", name)
        if not m or int(m.group(1)) == os.getpid():
            continue
        pid = int(m.group(1))
        path = os.path.join(DIR, name)
        if not alive(pid):
            try:
                os.remove(path)
            except OSError:
                pass
            continue
        info = {}
        try:
            with open(path, encoding="utf-8") as f:
                info = json.load(f)
        except (OSError, ValueError):
            pass
        out.append({"pid": pid, "mode": m.group(2), "since": info.get("since", 0), "label": info.get("label", "?")})
    return out


def exclusive(label):
    if os.environ.get("CITYPOP_GPU", "exclusive") != "exclusive":
        return
    os.makedirs(DIR, exist_ok=True)
    path = os.path.join(DIR, f"{os.getpid()}-exclusive.json")
    since = int(time.time() * 1000)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"label": label, "since": since, "cwd": os.getcwd()}, f)

    def drop():
        try:
            os.remove(path)
        except OSError:
            pass

    atexit.register(drop)
    start = time.time()
    said = 0.0
    while True:
        before = [h for h in holders() if h["mode"] == "shared" or h["since"] < since or (h["since"] == since and h["pid"] < os.getpid())]
        if not before:
            return
        names = ", ".join(f"{h['label']} ({h['mode']}, pid {h['pid']})" for h in before)
        if time.time() - start > WAIT:
            print(f"GPU: still busy after {WAIT // 60} minutes ({names}); going ahead", file=sys.stderr, flush=True)
            return
        if time.time() - said > 30:
            print(f"GPU: waiting for {names}", file=sys.stderr, flush=True)
            said = time.time()
        time.sleep(1.5)
