import { defineConfig } from "vite-plus";

const ignorePatterns = [
	"**/routeTree.gen.ts",
	"apps/web/drizzle/**",
	".agents/**",
	".claude/**",
	".cursor/**",
];

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
			{
				test: {
					name: "auth",
					include: ["apps/web/tests/auth/*.test.ts"],
					globalSetup: ["apps/web/tests/auth/setup.ts"],
					// One Worker and database serve every file.
					fileParallelism: false,
					testTimeout: 30_000,
					hookTimeout: 30_000,
				},
			},
		],
	},
	staged: { "*.{js,ts,jsx,tsx}": "vp check --fix" },
});
