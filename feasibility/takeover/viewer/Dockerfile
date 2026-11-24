FROM debian:trixie-20261104-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2

RUN apt-get update \
	&& apt-get install -y --no-install-recommends novnc python3-websockify socat \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --create-home --uid 1000 viewer

USER viewer
# noVNC on :6080 for the owner's take-over; DevTools on :9222 for the bot.
CMD ["sh", "-c", "socat TCP-LISTEN:9222,fork,reuseaddr TCP:desktop:9223 & exec websockify --web /usr/share/novnc 6080 desktop:5900"]
