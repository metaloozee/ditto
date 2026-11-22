"""Read-only control port (8081) for the owner's commands, reached only through the gated Worker.

GET /ready      200 once Chrome's DevTools answers
GET /decisions  the filter's JSON lines, with the workspace on each
GET /isolation  whether the network fence applied
GET /memory     the instance's memory use, in MiB
GET /bypass     whether this (browser) user can resolve DNS or connect out without the filter

It serves no page content, cookies or profile files.
"""

import json
import socket
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

STATE = Path("/run/egress")


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


def devtools_ready() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:9222/json/version", timeout=2) as response:
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


ThreadingHTTPServer(("0.0.0.0", 8081), Control).serve_forever()
