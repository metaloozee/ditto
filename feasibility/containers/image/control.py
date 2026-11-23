"""Control port (8081) for the owner's commands, reached only through the gated Worker.

GET  /ready           200 once Chrome's DevTools answers through the gate (not while it is locked)
GET  /decisions       the filter's JSON lines, with the workspace on each
GET  /isolation       whether the network fence applied
GET  /memory          the instance's memory use, in MiB
GET  /bypass          whether this (browser) user can resolve DNS or connect out without the filter
GET  /samples         memory, pressure and desktop processes, sampled every 3 s (#37)
GET  /sandbox         whether Chrome runs sandboxed, and why not (#37)
GET  /devtools-reach  which DevTools ports this (browser) user, standing in for a bot, can reach
GET  /screens         the extra screens and whether each Chrome is alive
POST /screens?url=    open one more screen on its own display, for the capacity measurement

It serves no page content, cookies or profile files.
"""

import json
import os
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STATE = Path("/run/egress")
BROWSER_STATE = Path("/run/browser")
SAMPLE_SECONDS = 3
# Two hours of samples; the owner's commands poll and keep their own copy.
samples: deque = deque(maxlen=2400)
screens: list[subprocess.Popen] = []
DESKTOP = ("Xvfb", "x11vnc", "websockify", "chromium")


def read_mib(path: str) -> float | None:
    try:
        return round(int(Path(path).read_text().split()[0]) / 2**20, 1)
    except (OSError, ValueError, IndexError):
        return None


def meminfo() -> dict[str, float]:
    fields = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        name, value = line.split(":", 1)
        if name in ("MemTotal", "MemAvailable"):
            fields[name] = round(int(value.split()[0]) / 1024, 1)
    return fields


def memory() -> dict:
    info = meminfo()
    current = read_mib("/sys/fs/cgroup/memory.current")
    total, available = info.get("MemTotal"), info.get("MemAvailable")
    return {
        "currentMib": current if current is not None else round(total - available, 1),
        "peakMib": read_mib("/sys/fs/cgroup/memory.peak"),
        "limitMib": read_mib("/sys/fs/cgroup/memory.max"),
        "memTotalMib": total,
        "memAvailableMib": available,
    }


def bypass() -> dict:
    result = {}
    try:
        socket.getaddrinfo("example.com", 443)
        result["dns"] = "resolved"
    except OSError as error:
        result["dns"] = "failed"
        result["dnsError"] = type(error).__name__
    try:
        socket.create_connection(("1.1.1.1", 443), timeout=3).close()
        result["direct"] = "connected"
    except OSError as error:
        result["direct"] = "failed"
        result["directError"] = type(error).__name__
    return result


def processes() -> list[tuple[str, float | None]]:
    """(name, PSS in MiB) of every process; PSS only for this user's, which include Chrome's."""
    found = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            name = (entry / "comm").read_text().strip()
        except OSError:
            continue
        pss = None
        try:
            for line in (entry / "smaps_rollup").read_text().splitlines():
                if line.startswith("Pss:"):
                    pss = int(line.split()[1]) / 1024
                    break
        except OSError:
            pass
        found.append((name, pss))
    return found


def pressure(resource: str) -> float | None:
    try:
        line = Path(f"/proc/pressure/{resource}").read_text().splitlines()[0]
        return float(dict(part.split("=") for part in line.split()[1:])["avg10"])
    except (OSError, ValueError, KeyError, IndexError):
        return None


def oom_kills() -> int | None:
    try:
        for line in Path("/sys/fs/cgroup/memory.events").read_text().splitlines():
            name, value = line.split()
            if name == "oom_kill":
                return int(value)
    except (OSError, ValueError):
        pass
    return None


def sample() -> dict:
    found = processes()
    chrome = [pss for name, pss in found if name.startswith("chrom")]
    return {
        "at": int(time.time() * 1000),
        "memory": memory(),
        "chromeProcesses": len(chrome),
        "chromePssMib": round(sum(pss or 0 for pss in chrome), 1),
        "desktop": {name: any(found_name == name for found_name, _ in found) for name in DESKTOP},
        "oomKills": oom_kills(),
        "pressure": {"cpu": pressure("cpu"), "memory": pressure("memory")},
        "load1": os.getloadavg()[0],
        "screens": sum(1 for screen in screens if screen.poll() is None),
    }


def sampler() -> None:
    while True:
        try:
            samples.append(sample())
        except Exception as error:  # a missed sample must not end the sampling
            samples.append({"at": int(time.time() * 1000), "error": type(error).__name__})
        time.sleep(SAMPLE_SECONDS)


def reach(port: int, path: str) -> str:
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2).close()
        return "reachable"
    except urllib.error.HTTPError:
        return "reachable"
    except OSError:
        return "refused"


def devtools_reach() -> dict:
    return {
        "chrome": reach(9222, "/json/version"),
        "gate": reach(9223, "/json/version"),
        "lock": reach(8082, "/"),
    }


def open_screen(url: str) -> dict:
    display = len(screens) + 1
    screens.append(
        subprocess.Popen(
            ["/opt/workspace/screen.sh", str(display), url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    )
    return {"screens": len(screens)}


def devtools_ready() -> bool:
    try:
        # Only the gate's user may reach Chrome's own port once the fence applies.
        with urllib.request.urlopen("http://127.0.0.1:9223/json/version", timeout=2) as response:
            return response.status == 200
    except OSError:
        return False


class Control(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/ready":
            ready = devtools_ready()
            self.send(200 if ready else 503, {"ready": ready})
        elif self.path == "/decisions":
            self.send(200, (STATE / "decisions.jsonl").read_text(), "application/x-ndjson")
        elif self.path == "/isolation":
            self.send(200, (STATE / "isolation.json").read_text(), "application/json")
        elif self.path == "/memory":
            self.send(200, memory())
        elif self.path == "/bypass":
            self.send(200, bypass())
        elif self.path == "/samples":
            self.send(200, list(samples))
        elif self.path == "/sandbox":
            self.send(200, (BROWSER_STATE / "sandbox.json").read_text(), "application/json")
        elif self.path == "/devtools-reach":
            self.send(200, devtools_reach())
        elif self.path == "/screens":
            self.send(
                200,
                [{"display": i + 1, "alive": s.poll() is None} for i, s in enumerate(screens)],
            )
        else:
            self.send(404, {"error": "not found"})

    def do_POST(self) -> None:
        url = urllib.parse.urlsplit(self.path)
        target = urllib.parse.parse_qs(url.query).get("url", [""])[0]
        if url.path == "/screens" and target.startswith("https://"):
            self.send(200, open_screen(target))
        else:
            self.send(404, {"error": "not found"})

    def send(self, status: int, body, content_type: str = "application/json") -> None:
        data = (body if isinstance(body, str) else json.dumps(body)).encode()
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args) -> None:
        pass


threading.Thread(target=sampler, daemon=True).start()
ThreadingHTTPServer(("0.0.0.0", 8081), Control).serve_forever()
