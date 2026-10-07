import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // El arranque de PGlite (Postgres en WASM) puede tardar varios segundos en CI.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
