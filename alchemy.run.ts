import path from "node:path";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { config } from "dotenv";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type { Sandbox as SandboxDurableObject } from "./apps/web/src/server.ts";

// Alchemy local Container stores context as path.relative(cwd); run dev from apps/web so root resolves as ../..
const repoRoot = import.meta.dirname;

config({
	path: [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")],
});

const sandboxBackupBucketName = "ditto-ayan-sandbox-backups";

const Database = Cloudflare.D1.Database("database", {
	name: "ditto-ayan-db",
	migrationsDir: path.join(repoRoot, "apps/web/migrations"),
	migrationsTable: "drizzle_migrations",
});

const SandboxBackups = Cloudflare.R2.Bucket("sandbox-backups", {
	name: sandboxBackupBucketName,
});

const SandboxContainer = Cloudflare.Container<SandboxDurableObject>("sandbox", {
	name: "ditto-sandbox-ayan",
	className: "Sandbox",
	context: repoRoot,
	dockerfile: path.join(repoRoot, "Dockerfile"),
	instanceType: "lite",
	maxInstances: 1,
});

export const Website = Cloudflare.Website.Vite("website", {
	name: "ditto-website-ayan",
	rootDir: path.join(repoRoot, "apps/web"),
	main: "src/server.ts",
	assets: { runWorkerFirst: true },
	compatibility: {
		flags: ["nodejs_compat_populate_process_env"],
	},
	routes: [{ pattern: "*.ayn.wtf/*", zoneName: "ayn.wtf" }],
	env: {
		DB: Database,
		Sandbox: SandboxContainer,
		BACKUP_BUCKET: SandboxBackups,
		BACKUP_BUCKET_NAME: sandboxBackupBucketName,
		CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
		R2_ACCESS_KEY_ID: Config.redacted("R2_ACCESS_KEY_ID"),
		R2_SECRET_ACCESS_KEY: Config.redacted("R2_SECRET_ACCESS_KEY"),
		USE_LOCAL_BUCKET_BACKUPS: process.env.USE_LOCAL_BUCKET_BACKUPS ?? "",
		BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "",
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
		GITHUB_CLIENT_SECRET: Config.redacted("GITHUB_CLIENT_SECRET"),
		GITHUB_APP_ID: process.env.GITHUB_APP_ID ?? "",
		GITHUB_APP_PRIVATE_KEY: Config.redacted("GITHUB_APP_PRIVATE_KEY"),
		VITE_GITHUB_APP_INSTALL_URL:
			process.env.VITE_GITHUB_APP_INSTALL_URL ??
			"https://github.com/apps/ditto-web/installations/new/",
		OPENCODE_API_KEY: Config.redacted("OPENCODE_API_KEY"),
		AI_CREDENTIALS_ENCRYPTION_KEY: Config.redacted(
			"AI_CREDENTIALS_ENCRYPTION_KEY",
		),
		SANDBOX_TRANSPORT: "rpc",
		PREVIEW_BASE_HOST: "ayn.wtf",
	},
});

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;

export default Alchemy.Stack(
	"ditto",
	{
		providers: Cloudflare.providers(),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const website = yield* Website;
		return { url: website.url };
	}),
);
