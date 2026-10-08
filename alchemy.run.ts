import { randomBytes } from "node:crypto";
import alchemy from "alchemy";
import {
	Container,
	D1Database,
	DurableObjectNamespace,
	R2Bucket,
	Route,
	TanStackStart,
	Worker,
	WorkerRef,
} from "alchemy/cloudflare";
import { config } from "dotenv";
import type { CodexCredential } from "./apps/web/src/lib/codex-credential-do.ts";
import {
	fixtureWorkerAuth,
	loadFixtureHostAuth,
} from "./scripts/pi-durable-host-auth.ts";

const piDurableFixture = process.env.DITTO_LOCAL_PI_DURABLE === "1";
if (!piDurableFixture) config({ path: [".env.local", ".env"] });

const app = await alchemy(
	piDurableFixture ? "ditto-pi-durable-l0" : "ditto",
	piDurableFixture
		? {
				rootDir: process.env.DITTO_FIXTURE_STATE,
				password: randomBytes(32).toString("hex"),
			}
		: undefined,
);

async function createPiDurableFixture() {
	const id = process.env.DITTO_FIXTURE_ID;
	const port = Number(process.env.DITTO_FIXTURE_PORT);
	if (
		!app.local ||
		!id ||
		!/^[a-f0-9]{32}$/.test(id) ||
		!process.env.DITTO_FIXTURE_STATE ||
		!Number.isInteger(port) ||
		port < 1024 ||
		port > 65535
	) {
		throw new Error(
			"Pi Durable fixture requires isolated local verifier configuration",
		);
	}
	const auth = await loadFixtureHostAuth(
		process.env.DITTO_FIXTURE_CLOUDFLARE_ENV_FILE,
	);
	const apiOrigin = process.env.DITTO_FIXTURE_API_ORIGIN;
	if (!apiOrigin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(apiOrigin)) {
		throw new Error("Fixture requires local API denial transport");
	}
	const execution = await Container("pi-durable-l0-execution", {
		className: "PiDurableLocalSandbox",
		image: "docker.io/cloudflare/sandbox:0.12.3",
		instanceType: "basic",
		maxInstances: 1,
	});
	return await Worker("pi-durable-l0-runtime", {
		...fixtureWorkerAuth(auth),
		baseUrl: apiOrigin,
		entrypoint: "apps/runtime/src/pi-durable-local-entry.ts",
		compatibilityDate: "2026-03-10",
		compatibilityFlags: ["nodejs_compat"],
		dev: { port, remote: false, tunnel: false },
		bindings: {
			PiDurableLocalRuntime: DurableObjectNamespace("pi-durable-l0-sqlite", {
				className: "PiDurableLocalRuntime",
				sqlite: true,
			}),
			PiDurableLocalSandbox: execution,
			PI_DURABLE_LOCAL: "1",
			FIXTURE_ID: id,
			FIXTURE_PORT: String(port),
		},
	});
}

async function createWebsite() {
	if (app.local && process.env.DITTO_LOCAL_RUNTIME_TOPOLOGY === "1") {
		const runtimeServiceName = `${app.name}-${app.stage}-runtime-local`;
		const productServiceName = `${app.name}-${app.stage}-product-bridge-local`;
		const runtimeRef = WorkerRef({ service: runtimeServiceName });
		const productRef = WorkerRef({ service: productServiceName });
		const brainContainer = await Container("local-session-brain", {
			className: "SessionRuntime",
			build: {
				context: "packages/session-brain",
				dockerfile: "Dockerfile",
			},
			instanceType: "basic",
			maxInstances: 20,
		});
		const runtimeSandbox = await Container("local-runtime-sandbox", {
			className: "Sandbox",
			build: { context: ".", dockerfile: "Dockerfile" },
			instanceType: "basic",
			maxInstances: 20,
		});
		await Worker("local-product-bridge", {
			name: productServiceName,
			entrypoint: "apps/runtime/src/server.ts",
			bindings: {
				RUNTIME: Worker.experimentalEntrypoint(runtimeRef, "RuntimeEntrypoint"),
			},
		});
		await Worker("local-session-runtime", {
			name: runtimeServiceName,
			entrypoint: "apps/runtime/src/server.ts",
			bindings: {
				SessionRuntime: brainContainer,
				Sandbox: runtimeSandbox,
				PRODUCT: Worker.experimentalEntrypoint(productRef, "ProductEntrypoint"),
			},
		});
	}

	const sandbox = await Container("sandbox", {
		className: "Sandbox",
		build: {
			context: ".",
			dockerfile: "Dockerfile",
		},
		instanceType: "basic",
		maxInstances: 20,
	});

	const database = await D1Database("database", {
		name: `${app.name}-${app.stage}-db`,
		migrationsDir: "./apps/web/migrations",
		migrationsTable: "drizzle_migrations",
	});

	const sandboxBackups = await R2Bucket("sandbox-backups", {
		name: `${app.name}-${app.stage}-sandbox-backups`,
	});

	const website = await TanStackStart("website", {
		cwd: "apps/web",
		url: true,
		crons: ["* * * * *"],
		bindings: {
			DB: database,
			Sandbox: sandbox,
			CodexCredential: DurableObjectNamespace<CodexCredential>(
				"codex-credential",
				{
					className: "CodexCredential",
					sqlite: true,
				},
			),
			CODEX_CREDENTIAL_CURRENT_KEY_VERSION:
				process.env.CODEX_CREDENTIAL_CURRENT_KEY_VERSION ?? "",
			CODEX_CREDENTIAL_KEYS: alchemy.secret(process.env.CODEX_CREDENTIAL_KEYS),
			BACKUP_BUCKET: sandboxBackups,
			CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
			BETTER_AUTH_SECRET: alchemy.secret(process.env.BETTER_AUTH_SECRET),
			BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "",
			GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
			GITHUB_CLIENT_SECRET: alchemy.secret(process.env.GITHUB_CLIENT_SECRET),
			GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
			GITHUB_APP_PRIVATE_KEY: alchemy.secret(
				process.env.GITHUB_APP_PRIVATE_KEY,
			),
			VITE_GITHUB_APP_INSTALL_URL:
				process.env.VITE_GITHUB_APP_INSTALL_URL ??
				"https://github.com/apps/ditto-web/installations/new/",
			OPENCODE_API_KEY: alchemy.secret(process.env.OPENCODE_API_KEY),
			SANDBOX_TRANSPORT: "rpc",
			PREVIEW_BASE_HOST: "ayn.wtf",
		},
		wrangler: {
			main: "src/server.ts",
			transform: (spec) => ({
				...spec,
				d1_databases: spec.d1_databases?.map((database) =>
					database.binding === "DB"
						? { ...database, migrations_dir: "../../migrations" }
						: database,
				),
				containers: [
					{
						class_name: "Sandbox",
						image: "../../../../Dockerfile",
						instance_type: "basic",
						max_instances: 20,
					},
				],
				durable_objects: {
					...spec.durable_objects,
					bindings: [
						{
							class_name: "Sandbox",
							name: "Sandbox",
						},
						{
							class_name: "CodexCredential",
							name: "CodexCredential",
						},
					],
				},
				migrations: [
					{ new_sqlite_classes: ["Sandbox"], tag: "v1" },
					{ new_sqlite_classes: ["CodexCredential"], tag: "v2" },
				],
			}),
		},
	});

	await Route("session-previews", {
		pattern: "*.ayn.wtf/*",
		script: website,
		adopt: true,
		dev: true,
	});

	console.log({ url: website.url });
	return website;
}

export let website: Awaited<ReturnType<typeof createWebsite>>;
if (piDurableFixture) await createPiDurableFixture();
else website = await createWebsite();
await app.finalize();
