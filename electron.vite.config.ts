import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [
      react(),
      {
        name: "witch-development-csp",
        transformIndexHtml(html, context) {
          return context.server
            ? html.replace(
                "connect-src 'self'",
                "connect-src 'self' ws://localhost:* http://localhost:*",
              )
            : html;
        },
      },
    ],
  },
});
