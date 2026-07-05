import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    server: {
      // This app runs Vite through a custom Express server. Disabling HMR avoids
      // stale websocket retries against Vite's fallback HMR port during restarts.
      hmr: false,
    },
  };
});
