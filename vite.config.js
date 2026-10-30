import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { analyzeApiPlugin } from "./server/plugin.js";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");

	return {
		plugins: [react(), analyzeApiPlugin(env)],
	};
});
