// Empaqueta el servidor MCP en un único archivo autocontenido (dist/index.js):
// inlina los paquetes internos (@arcade1v1/*) y las deps npm (MCP SDK, zod, viem),
// para que se pueda publicar y correr con `npx @arcade1v1/mcp` sin workspace.
import { build } from "esbuild";
import { chmodSync } from "node:fs";

const OUT = new URL("./dist/index.js", import.meta.url).pathname;

await build({
  entryPoints: [new URL("./src/index.ts", import.meta.url).pathname],
  outfile: OUT,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  // Shebang para que sea ejecutable como bin.
  banner: { js: "#!/usr/bin/env node" },
  // ESM + require() de algunas deps: este banner cubre el caso.
  define: { "import.meta.url": "import.meta.url" },
  legalComments: "none",
});

chmodSync(OUT, 0o755);
console.log("✓ bundle listo:", OUT);
