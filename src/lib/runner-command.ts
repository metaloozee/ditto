export function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function makeProcessId(sessionId: string): string {
	return `ditto-runner-${sessionId.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function makeBrokerDir(sessionId: string): string {
	return `/tmp/ditto/runner/${sessionId.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function buildFifoWriteCommand(fifoPath: string, line: string): string {
	return `printf %s ${quoteShellArg(`${line}\n`)} > ${quoteShellArg(fifoPath)}`;
}

export function makeRunnerCommand(options: {
	brokerDir: string;
	fifoPath: string;
	modelSpecifier: string;
}): string {
	return [
		"set -euo pipefail",
		`mkdir -p ${quoteShellArg(options.brokerDir)}`,
		`rm -f ${quoteShellArg(options.fifoPath)}`,
		`mkfifo ${quoteShellArg(options.fifoPath)}`,
		[
			`while true; do cat ${quoteShellArg(options.fifoPath)}; done | exec env OPENCODE_API_KEY="$OPENCODE_API_KEY"`,
			`MODEL_SPECIFIER=${quoteShellArg(options.modelSpecifier)}`,
			"tsx /opt/ditto/sandbox/runner/index.ts",
			`2> ${quoteShellArg(`${options.brokerDir}/runner.err`)}`,
		].join(" "),
	].join("; ");
}
