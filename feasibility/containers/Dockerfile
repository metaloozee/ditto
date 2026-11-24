# Chrome and the workspace egress filter in one image, for Cloudflare Containers (#32). A Container
# instance runs a single image, so the #27 filter and the #29 headed desktop share one.
# Built from feasibility/ (see feasibility/.dockerignore).
FROM mitmproxy/mitmproxy:12.3.1@sha256:2711066c855659b5af8b1dbb84494ed3eff69b42ece439c60b4fe09a2db829d4

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		chromium chromium-sandbox libnss3-tools fonts-dejavu-core xvfb x11vnc novnc python3-websockify iptables \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --create-home browser \
	&& useradd --no-create-home --shell /usr/sbin/nologin devtools \
	&& install -d -o browser -g browser /home/browser/profile

COPY egress/filter/egress_filter.py /filter/egress_filter.py
COPY egress/destinations/ takeover/destinations/ containers/destinations/ /destinations/
COPY containers/image/ /opt/workspace/

# Starts as root only to fence the network, then runs the filter and the browser unprivileged.
ENTRYPOINT ["/opt/workspace/entrypoint.sh"]
