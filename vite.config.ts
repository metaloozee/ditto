import { defineConfig } from "vite-plus";

const ignorePatterns = ["**/routeTree.gen.ts", ".agents/**", ".claude/**", ".cursor/**"];

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
	staged: { "*.{js,ts,jsx,tsx}": "vp check --fix" },
});
