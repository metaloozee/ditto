import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
	envDir: "../..",
	plugins: lazyPlugins(() => [tailwindcss(), tanstackStart(), viteReact()]),
});
