"""Workspace egress filter: allow a request only if its host is on the workspace's list.

The list is /destinations/<WORKSPACE_ID>.txt, one host per line, `#` comments.
It is read on every decision, so editing it takes effect without a restart.
Each decision is one JSON line on stdout. HTTP/2 requests go through `request` like
HTTP/1.1; a WebSocket is decided again when its upgrade completes.
"""

import json
import os
import shutil
from pathlib import Path

from mitmproxy import ctx, http
from mitmproxy.certs import CertStore

WORKSPACE = os.environ["WORKSPACE_ID"]
DESTINATIONS = Path("/destinations") / f"{WORKSPACE}.txt"


def approved_hosts() -> set[str]:
    try:
        lines = DESTINATIONS.read_text().splitlines()
    except FileNotFoundError:
        return set()
    return {line.split("#")[0].strip().lower() for line in lines} - {""}


def decide(host: str, **fields) -> bool:
    allowed = host.lower() in approved_hosts()
    entry = {"workspace": WORKSPACE, "host": host, "decision": "allow" if allowed else "deny"}
    print(json.dumps(entry | fields), flush=True)
    return allowed


def refuse(flow: http.HTTPFlow) -> None:
    flow.response = http.Response.make(
        403, f"Blocked by the {WORKSPACE} egress filter\n", {"content-type": "text/plain"}
    )


class EgressFilter:
    def running(self) -> None:
        # Publish only the CA certificate; the key stays in the filter's private volume.
        # from_store creates the CA on first start and loads it after; mitmproxy may not have yet.
        confdir = Path(ctx.options.confdir).expanduser()
        CertStore.from_store(confdir, "mitmproxy", 2048)
        shutil.copyfile(confdir / "mitmproxy-ca-cert.pem", "/ca-public/ca.pem.tmp")
        os.replace("/ca-public/ca.pem.tmp", "/ca-public/ca.pem")

    def http_connect(self, flow: http.HTTPFlow) -> None:
        # Refuse the tunnel before any TLS, so an unapproved host is never contacted.
        if not decide(flow.request.host, method="CONNECT", port=flow.request.port):
            refuse(flow)

    def request(self, flow: http.HTTPFlow) -> None:
        # Every request inside an approved tunnel is checked again by its own host.
        # http_version is Chrome to filter; upstream_alpn is filter to origin.
        if not decide(
            flow.request.pretty_host,
            method=flow.request.method,
            url=flow.request.pretty_url,
            http_version=flow.request.http_version,
            upstream_alpn=(flow.server_conn.alpn or b"").decode() or None,
        ):
            refuse(flow)

    def websocket_start(self, flow: http.HTTPFlow) -> None:
        # The upgrade request already passed `request`; decide again once it is a WebSocket.
        if not decide(flow.request.pretty_host, method="WEBSOCKET", url=flow.request.pretty_url):
            flow.kill()


addons = [EgressFilter()]
