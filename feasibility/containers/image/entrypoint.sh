#!/bin/sh
# One workspace's computer on Cloudflare Containers (#32): the #27 egress filter, then the #29
# headed desktop behind it. The runtime passes the workspace identity as WORKSPACE_ID; nothing
# else in the image names a workspace.
set -eu
: "${WORKSPACE_ID:?the runtime must pass WORKSPACE_ID}"
case "$WORKSPACE_ID" in *[!a-z0-9-]*) echo "invalid WORKSPACE_ID" >&2; exit 64 ;; esac

state=/run/egress
install -d -m 755 "$state"
install -m 644 /dev/null "$state/decisions.jsonl"
install -d -o mitmproxy -g mitmproxy /ca-public /home/mitmproxy/.mitmproxy

# Containers share one network namespace, so Docker's internal network has no equivalent here.
# The fence instead lets only the filter's user open outbound connections. It needs NET_ADMIN;
# without it the image says so and the browser user has a direct route out.
fence() {
	for tables in iptables ip6tables; do
		"$tables" -w -A OUTPUT -o lo -j ACCEPT &&
			"$tables" -w -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT &&
			"$tables" -w -A OUTPUT -m owner --uid-owner mitmproxy -j ACCEPT &&
			"$tables" -w -A OUTPUT -j REJECT || return 1
	done
}
if fence 2>/dev/null; then
	isolation=filter-user-only
else
	iptables -w -F OUTPUT 2>/dev/null || true
	ip6tables -w -F OUTPUT 2>/dev/null || true
	isolation=none
fi
printf '{"workspace": "%s", "isolation": "%s"}\n' "$WORKSPACE_ID" "$isolation" | tee "$state/isolation.json"

# Each decision goes to stdout, which Cloudflare keeps as the container's log, and to a file the
# owner's commands read through the Worker.
setpriv --reuid=mitmproxy --regid=mitmproxy --init-groups \
	env HOME=/home/mitmproxy WORKSPACE_ID="$WORKSPACE_ID" PYTHONUNBUFFERED=1 \
	mitmdump --quiet --listen-host 127.0.0.1 --listen-port 8080 -s /filter/egress_filter.py |
	tee -a "$state/decisions.jsonl" &

while [ ! -f /ca-public/ca.pem ]; do sleep 0.1; done

exec setpriv --reuid=browser --regid=browser --init-groups \
	env HOME=/home/browser WORKSPACE_ID="$WORKSPACE_ID" /opt/workspace/desktop.sh
