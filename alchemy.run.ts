import alchemy from "alchemy";
import {
	Container,
	D1Database,
	R2Bucket,
	TanStackStart,
} from "alchemy/cloudflare";
import { config } from "dotenv";

config({ path: [".env.local", ".env"] });

const app = await alchemy("ditto");

const sandbox = await Container("sandbox", {
	className: "Sandbox",
	build: {
		context: ".",
		dockerfile: "Dockerfile",
	},
	instanceType: "lite",
	maxInstances: 1,
});

const database = await D1Database("database", {
	name: `${app.name}-${app.stage}-db`,
	migrationsDir: "./apps/web/migrations",
	migrationsTable: "drizzle_migrations",
});

const sandboxBackupBucketName = `${app.name}-${app.stage}-sandbox-backups`;
const sandboxBackups = await R2Bucket("sandbox-backups", {
	name: sandboxBackupBucketName,
});

export const website = await TanStackStart("website", {
	cwd: "apps/web",
	url: true,
	bindings: {
		DB: database,
		Sandbox: sandbox,
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
		VITE_GITHUB_APP_INSTALL_URL:
			process.env.VITE_GITHUB_APP_INSTALL_URL ??
			"https://github.com/apps/ditto-web/installations/new/",
		OPENCODE_API_KEY: alchemy.secret(process.env.OPENCODE_API_KEY),
		AI_CREDENTIALS_ENCRYPTION_KEY: alchemy.secret(
			process.env.AI_CREDENTIALS_ENCRYPTION_KEY,
		),
		SANDBOX_TRANSPORT: "rpc",
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
				],
			},
			migrations: [{ new_sqlite_classes: ["Sandbox"], tag: "v1" }],
		}),
	},
});

console.log({ url: website.url });

await app.finalize();
