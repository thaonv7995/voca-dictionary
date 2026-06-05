import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@voca/core": "/packages/voca-core/src",
    },
  },
  server: {
    port: 22052,
  },
  preview: {
    port: 22052,
  },
});
