import path from "node:path";
import { existsSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";

/** Map NodeNext-style `./foo.js` imports to `./foo.ts` sources under vite. */
function jsToTs(): Plugin {
  return {
    name: "js-to-ts",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.endsWith(".js") || !source.startsWith(".")) return null;
      const candidate = path.resolve(path.dirname(importer), source.replace(/\.js$/, ".ts"));
      if (existsSync(candidate)) return candidate;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [jsToTs()],
  test: {
    environment: "node",
    globals: false,
  },
});
