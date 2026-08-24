import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  outDir: "dist",
  clean: true,
  sourcemap: process.env.SYNARA_PORTLOG_RUNTIME_SOURCEMAP === "1",
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});
