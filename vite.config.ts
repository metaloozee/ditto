import { defineConfig } from "vite-plus";

const ignorePatterns = [
	"**/routeTree.gen.ts",
	"apps/web/drizzle/**",
	".agents/**",
	".claude/**",
	".cursor/**",
];

// One Worker and database serve every file of these projects: the setup starts the
// stage once, and the group order keeps the projects from running side by side.
const stageTests = (name: string, groupOrder: number) => ({
	test: {
		name,
		include: [`apps/web/tests/${name}/*.test.ts`],
		globalSetup: ["apps/web/tests/auth/setup.ts"],
		fileParallelism: false,
		sequence: { groupOrder },
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});

const feasibilityTests = {
	// The Containers trial's Durable Object extends @cloudflare/containers, which imports
	// workerd's built-ins and ships extensionless ESM imports, so Vite transforms it.
	resolve: {
		alias: {
			"cloudflare:workers": `${import.meta.dirname}/feasibility/cloudflare-workers.fake.ts`,
		},
	},
	test: {
		name: "feasibility",
		include: ["feasibility/*.test.ts"],
		server: { deps: { inline: ["@cloudflare/containers"] } },
	},
};

export default defineConfig({
	fmt: {
		ignorePatterns: [...ignorePatterns, "skills-lock.json", "pnpm-lock.yaml"],
		sortImports: {},
		overrides: [{ files: ["**/*.{ts,tsx,js,jsx}"], options: { useTabs: true } }],
	},
	lint: {
		ignorePatterns,
		jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
		rules: { "vite-plus/prefer-vite-plus-imports": "error" },
		options: { typeAware: true, typeCheck: true },
	},
	test: {
		projects: [
			{ test: { name: "web", include: ["apps/web/tests/*.test.ts"] } },
			// Browser tests stay local: CI minutes are scarce.
			...(process.env.CI
				? []
				: [
						stageTests("auth", 0),
						stageTests("workspace", 1),
						stageTests("models", 2),
						feasibilityTests,
					]),
		],
	},
	staged: { "*.{js,ts,jsx,tsx}": "vp check --fix" },
});
