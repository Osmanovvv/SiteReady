import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Plain client-side SPA (no SSR). The zero-dep Node engine serves the static
// build (web/dist) and the /api/audit/stream SSE on the same origin.
export default defineConfig({
  base: "/",
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: { port: 8080 },
});
