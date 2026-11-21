import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
	envDir: "../..",
	// Provided by workerd at runtime; a plain build leaves it to the Worker.
	build: { rolldownOptions: { external: ["cloudflare:workers"] } },
	plugins: lazyPlugins(() => [tailwindcss(), tanstackStart(), viteReact()]),
});
