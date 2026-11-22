#!/bin/sh
# Trust the filter's CA, then load one URL headless and print its DOM.
# Usage: entrypoint.sh <url> [extra chromium flags]
#        entrypoint.sh --devtools   stay running with DevTools on 127.0.0.1:9222
set -eu

nssdb="$HOME/.pki/nssdb"
mkdir -p "$nssdb"
certutil -N -d "sql:$nssdb" --empty-password
certutil -A -d "sql:$nssdb" -n "workspace egress CA" -t "C,," -i /ca-public/ca.pem

browse() {
	exec chromium \
		--headless \
		--no-sandbox \
		--disable-dev-shm-usage \
		--disable-background-networking \
		--proxy-server=http://filter:8080 \
		"$@"
}

if [ "$1" = "--devtools" ]; then
	browse --remote-debugging-port=9222 about:blank
fi

url="$1"
shift
browse "$@" --dump-dom "$url"
