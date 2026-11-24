import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	schema: ["./src/db/auth-schema.ts", "./src/db/workspace-schema.ts"],
	out: "./drizzle",
});
