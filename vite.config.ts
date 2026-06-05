import { existsSync } from "node:fs";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import alchemy from "alchemy/cloudflare/tanstack-start";
import { defineConfig, type PluginOption } from "vite";

const config = defineConfig(({ mode }) => {
	const hasAlchemyWranglerConfig = existsSync(".alchemy/local/wrangler.jsonc");
	const alchemyPlugins =
		mode === "test" || !hasAlchemyWranglerConfig
			? []
			: [alchemy() as PluginOption];

	return {
		resolve: { tsconfigPaths: true },
		build: {
			target: "esnext",
			rollupOptions: {
				external: ["node:async_hooks", "cloudflare:workers"],
			},
		},
		plugins: [
			devtools(),
			tailwindcss(),
			...alchemyPlugins,
			tanstackStart(),
			viteReact(),
			babel({ presets: [reactCompilerPreset()] }),
		],
	};
});

export default config;
