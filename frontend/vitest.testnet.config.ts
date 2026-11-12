import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Read-only smoke test against live Stellar Testnet: `npm run smoke`.
// Only simulations and RPC reads; nothing is signed or sent.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["smoke/**/*.smoke.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
