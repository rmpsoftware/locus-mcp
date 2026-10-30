import { defineConfig } from "rolldown";
import { fileURLToPath } from "node:url";

export default defineConfig({
  input: fileURLToPath(new URL("./src/bin.ts", import.meta.url)),
  platform: "node",
  resolve: {
    alias: {
      "@rmpsoftware/locus-core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  output: {
    file: fileURLToPath(new URL("./dist/locus.js", import.meta.url)),
    format: "esm",
    codeSplitting: false,
    sourcemap: false,
    // CommonJS dependencies can require Node built-ins from the ESM bundle.
    banner: 'import { createRequire as __locusCreateRequire } from "node:module";\nconst require = __locusCreateRequire(import.meta.url);',
  },
});
