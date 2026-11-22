#!/bin/sh
# Trust the filter's CA, then load one URL headless and print its DOM.
# Usage: entrypoint.sh <url> [extra chromium flags]
set -eu

nssdb="$HOME/.pki/nssdb"
mkdir -p "$nssdb"
certutil -N -d "sql:$nssdb" --empty-password
certutil -A -d "sql:$nssdb" -n "workspace egress CA" -t "C,," -i /ca-public/ca.pem

url="$1"
shift
exec chromium \
	--headless \
	--no-sandbox \
	--disable-dev-shm-usage \
	--disable-background-networking \
	--proxy-server=http://filter:8080 \
	"$@" \
	--dump-dom "$url"
