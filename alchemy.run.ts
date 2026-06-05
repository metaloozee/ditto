import alchemy from "alchemy"
import { D1Database, TanStackStart } from "alchemy/cloudflare"
import { config } from "dotenv"

config({ path: [".env.local", ".env"] })

const app = await alchemy("ditto")

const database = await D1Database("database", {
	name: `${app.name}-${app.stage}-db`,
	migrationsDir: "./migrations",
	migrationsTable: "drizzle_migrations",
})

export const website = await TanStackStart("website", {
	url: true,
	bindings: {
		DB: database,
		BETTER_AUTH_SECRET: alchemy.secret(process.env.BETTER_AUTH_SECRET),
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "",
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
		GITHUB_CLIENT_SECRET: alchemy.secret(process.env.GITHUB_CLIENT_SECRET),
		APP_ENV: app.stage,
	},
})

console.log({ url: website.url })

await app.finalize()
