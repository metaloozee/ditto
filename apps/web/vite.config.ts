import { existsSync } from "node:fs";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import alchemy from "alchemy/cloudflare/tanstack-start";
import { type Connect, defineConfig, type PluginOption } from "vite";

/**
 * Local session previews use `<port>-<sandbox>-<token>.localhost`.
 * Host Vite would otherwise serve its own `/node_modules/.vite/*` for those
 * hosts (same path as the parent app), causing 504 Outdated Optimize Dep.
 * Skip Vite asset/transform middleware for preview hosts so the Cloudflare
 * plugin catch-all can dispatch to the Worker → proxyToSandbox.
 */
function sessionPreviewDevProxy(): PluginOption {
	const viteMiddlewareNames = new Set([
		"viteCachedTransformMiddleware",
		"viteTransformMiddleware",
		"viteServePublicMiddleware",
		"viteServeStaticMiddleware",
		"viteServeRawFsMiddleware",
		"viteIndexHtmlMiddleware",
		"viteHtmlFallbackMiddleware",
	]);

	// SDK 0.12.3 local preview host: 10012-<sandboxId>-<token>.localhost[:port]
	const localPreviewHost =
		/^\d{4,5}-[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?\.localhost(?::\d+)?$/i;

	return {
		name: "ditto:session-preview-dev-proxy",
		configureServer(server) {
			return () => {
				for (const layer of server.middlewares.stack) {
					const handle = layer.handle;
					if (typeof handle !== "function") {
						continue;
					}
					const name = handle.name;
					if (!viteMiddlewareNames.has(name)) {
						continue;
					}
					const original = handle as Connect.NextHandleFunction;
					const wrapped: Connect.NextHandleFunction = (req, res, next) => {
						const host = req.headers.host ?? "";
						if (localPreviewHost.test(host)) {
							next();
							return;
						}
						return original(req, res, next);
					};
					Object.defineProperty(wrapped, "name", { value: name });
					layer.handle = wrapped;
				}
			};
		},
	};
}

const config = defineConfig(({ mode }) => {
	const hasAlchemyWranglerConfig = existsSync(".alchemy/local/wrangler.jsonc");
	const alchemyPlugins =
		mode === "test" || !hasAlchemyWranglerConfig
			? []
			: [alchemy() as PluginOption];

	return {
		envDir: "../..",
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
			sessionPreviewDevProxy(),
			...alchemyPlugins,
			tanstackStart(),
			viteReact(),
			babel({ presets: [reactCompilerPreset()] }),
		],
	};
});

export default config;
