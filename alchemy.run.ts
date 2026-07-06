import path from "node:path";
import alchemy from "alchemy";
import {
	D1Database,
	DurableObjectNamespace,
	R2Bucket,
	TanStackStart,
	Worker,
} from "alchemy/cloudflare";
import { config } from "dotenv";

config({ path: [".env.local", ".env"] });

const app = await alchemy("ditto");

const FLUE_WORKER_OUTPUT_DIR = path
	.basename(process.cwd())
	.replaceAll("-", "_");
const FLUE_WORKER_ENTRYPOINT = `./dist/${FLUE_WORKER_OUTPUT_DIR}/index.js`;

const sandbox = DurableObjectNamespace("sandbox", {
	className: "Sandbox",
	sqlite: true,
});

const workspaceSessionBroker = DurableObjectNamespace(
	"workspace-session-broker",
	{
		className: "WorkspaceSessionBroker",
		sqlite: true,
	},
);

const projectCoordinator = DurableObjectNamespace("project-coordinator", {
	className: "ProjectCoordinator",
	sqlite: true,
});

const flueRunBridge = DurableObjectNamespace("flue-run-bridge", {
	className: "FlueRunBridge",
	sqlite: true,
});

const flueProjectCoderAgent = DurableObjectNamespace(
	"flue-project-coder-agent",
	{
		className: "FlueProjectCoderAgent",
		sqlite: true,
	},
);

const flueRegistry = DurableObjectNamespace("flue-registry", {
	className: "FlueRegistry",
	sqlite: true,
});

const flueDittoProjectRunWorkflow = DurableObjectNamespace(
	"flue-ditto-project-run-workflow",
	{
		className: "FlueDittoProjectRunWorkflow",
		sqlite: true,
	},
);

const database = await D1Database("database", {
	name: `${app.name}-${app.stage}-db`,
	migrationsDir: "./migrations",
	migrationsTable: "drizzle_migrations",
});

const sandboxBackupBucketName = `${app.name}-${app.stage}-sandbox-backups`;
const sandboxBackups = await R2Bucket("sandbox-backups", {
	name: sandboxBackupBucketName,
});

export const flueWorker = await Worker("flue-worker", {
	entrypoint: FLUE_WORKER_ENTRYPOINT,
	compatibilityFlags: ["nodejs_compat"],
	bindings: {
		Sandbox: sandbox,
		ProjectCoordinator: projectCoordinator,
		FLUE_PROJECT_CODER_AGENT: flueProjectCoderAgent,
		FLUE_DITTO_PROJECT_RUN_WORKFLOW: flueDittoProjectRunWorkflow,
		FLUE_REGISTRY: flueRegistry,
		OPENCODE_API_KEY: alchemy.secret(process.env.OPENCODE_API_KEY),
	},
});

export const website = await TanStackStart("website", {
	url: true,
	bindings: {
		DB: database,
		Sandbox: sandbox,
		WorkspaceSessionBroker: workspaceSessionBroker,
		ProjectCoordinator: projectCoordinator,
		FlueRunBridge: flueRunBridge,
		FLUE_WORKER: flueWorker,
		BACKUP_BUCKET: sandboxBackups,
		BACKUP_BUCKET_NAME: sandboxBackupBucketName,
		CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
		R2_ACCESS_KEY_ID: alchemy.secret(process.env.R2_ACCESS_KEY_ID),
		R2_SECRET_ACCESS_KEY: alchemy.secret(process.env.R2_SECRET_ACCESS_KEY),
		USE_LOCAL_BUCKET_BACKUPS: process.env.USE_LOCAL_BUCKET_BACKUPS ?? "",
		BETTER_AUTH_SECRET: alchemy.secret(process.env.BETTER_AUTH_SECRET),
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "",
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
		GITHUB_CLIENT_SECRET: alchemy.secret(process.env.GITHUB_CLIENT_SECRET),
		GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
		GITHUB_APP_PRIVATE_KEY: alchemy.secret(process.env.GITHUB_APP_PRIVATE_KEY),
		OPENCODE_API_KEY: alchemy.secret(process.env.OPENCODE_API_KEY),
		ANTHROPIC_API_KEY: alchemy.secret(process.env.ANTHROPIC_API_KEY),
		APP_ENV: app.stage,
		VITE_GITHUB_APP_INSTALL_URL:
			process.env.VITE_GITHUB_APP_INSTALL_URL ??
			"https://github.com/apps/ditto-web/installations/new/",
	},
	wrangler: {
		main: "src/server.ts",
		transform: (spec) => ({
			...spec,
			containers: [
				{
					class_name: "Sandbox",
					image: "../../Dockerfile",
					instance_type: "lite",
					max_instances: 1,
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
						class_name: "WorkspaceSessionBroker",
						name: "WorkspaceSessionBroker",
					},
					{
						class_name: "ProjectCoordinator",
						name: "ProjectCoordinator",
					},
					{
						class_name: "FlueRunBridge",
						name: "FlueRunBridge",
					},
				],
			},
			migrations: [
				{ new_sqlite_classes: ["Sandbox"], tag: "v1" },
				{ new_sqlite_classes: ["WorkspaceSessionBroker"], tag: "v2" },
				{ new_sqlite_classes: ["ProjectCoordinator"], tag: "v3" },
				{ new_sqlite_classes: ["FlueRunBridge"], tag: "v4" },
			],
		}),
	},
});

console.log({ url: website.url });

await app.finalize();
