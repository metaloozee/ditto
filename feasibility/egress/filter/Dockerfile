FROM mitmproxy/mitmproxy:12.3.1@sha256:2711066c855659b5af8b1dbb84494ed3eff69b42ece439c60b4fe09a2db829d4

# Owned by the unprivileged mitmproxy user so a fresh named volume inherits it.
RUN install -d -o mitmproxy -g mitmproxy /ca-public
COPY egress_filter.py /filter/egress_filter.py
