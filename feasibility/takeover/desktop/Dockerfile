FROM debian:trixie-20261104-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		chromium libnss3-tools fonts-dejavu-core xvfb x11vnc socat \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --create-home --uid 1000 browser \
	&& install -d -o browser -g browser /home/browser/profile

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
USER browser
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
