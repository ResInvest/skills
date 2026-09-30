import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// .env z katalogu głównego monorepo (DATABASE_URL bazy testowej / deweloperskiej)
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

export default defineConfig({
  // SWC zachowuje metadane dekoratorów potrzebne NestJS (emitDecoratorMetadata)
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
