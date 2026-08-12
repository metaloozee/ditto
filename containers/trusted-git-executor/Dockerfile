# Trusted Git Executor — pinned minimal image. No project runtime.
# Base multi-arch digest revalidated 2026-08-12 against alpine:3.22.5.
FROM docker.io/library/alpine:3.22.5@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce

RUN apk add --no-cache \
		git=2.49.1-r0 \
		ca-certificates=20260611-r0 \
	&& update-ca-certificates \
	&& git version | grep -F 'git version 2.49.1' \
	&& test -f /etc/ssl/certs/ca-certificates.crt \
	&& adduser -D -H -u 65532 -s /sbin/nologin gitexec \
	&& mkdir -p /var/lib/ditto-git-executor \
	&& chown 65532:65532 /var/lib/ditto-git-executor

COPY --chmod=0555 ditto-git-executor /usr/local/bin/ditto-git-executor

USER 65532:65532
WORKDIR /var/lib/ditto-git-executor
ENTRYPOINT ["/usr/local/bin/ditto-git-executor", "hold"]
