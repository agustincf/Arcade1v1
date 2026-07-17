// Publica un SDK del workspace en npm SIN tocar cómo se resuelve adentro del
// repo (la web y el árbitro siguen importando el TypeScript fuente).
//
// Qué hace: compila src/ a ESM + .d.ts en .publish/dist, corrige las
// extensiones de los imports relativos (Node ESM las exige), genera un
// package.json publicable (exports → dist) y publica desde .publish/.
//
// Uso:  node scripts/publish-sdk.mjs <game-sdk|agent-sdk> [--dry-run]
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// Subpaths que expone cada paquete publicado (mismos que en el workspace).
const ENTRIES = {
  "game-sdk": [
    "index",
    "g2048",
    "tetris",
    "flappy",
    "racing",
    "snake",
    "invaders",
    "auth",
    "rules",
  ],
  "agent-sdk": ["index", "client", "sign", "strategies"],
  // Dependencia del agent-sdk: si no está en npm, el agent-sdk publicado es
  // ininstalable. Solo expone la raíz (sus módulos internos son relativos).
  strategies: ["index"],
};

const name = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
// Código 2FA de un solo uso (cuentas con doble factor "auth-and-writes"): se
// reenvía a npm publish. TOTP vale ~30s, alcanza para publicar varios paquetes.
const otpArg = process.argv.find((a) => a.startsWith("--otp="));
if (!ENTRIES[name]) {
  console.error(
    `uso: node scripts/publish-sdk.mjs <${Object.keys(ENTRIES).join("|")}> [--dry-run]`,
  );
  process.exit(1);
}

const pkgDir = join(ROOT, "packages", name);
const stage = join(pkgDir, ".publish");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

// 1) Compilar a .publish/dist (ESM + declaraciones).
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "dist"), { recursive: true });
const tsconfigPath = join(pkgDir, "tsconfig.publish.json");
writeFileSync(
  tsconfigPath,
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["ES2022", "DOM"],
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        declaration: true,
        rootDir: "src",
        outDir: ".publish/dist",
      },
      include: ["src"],
    },
    null,
    2,
  ),
);
try {
  execSync(`npx tsc -p ${tsconfigPath}`, { cwd: ROOT, stdio: "inherit" });
} finally {
  rmSync(tsconfigPath, { force: true });
}

// 2) Node ESM exige extensión en los imports relativos; tsc no la agrega.
for (const f of readdirSync(join(stage, "dist"))) {
  const p = join(stage, "dist", f);
  const src = readFileSync(p, "utf8");
  const fixed = src.replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (m, a, spec, z) =>
    /\.(js|json)$/.test(spec) ? m : `${a}${spec}.js${z}`,
  );
  if (fixed !== src) writeFileSync(p, fixed);
}

// 3) package.json publicable: mismos metadatos, exports apuntando a dist.
const exportsMap = {};
for (const e of ENTRIES[name]) {
  exportsMap[e === "index" ? "." : `./${e}`] = {
    types: `./dist/${e}.d.ts`,
    default: `./dist/${e}.js`,
  };
}
const deps = { ...(pkg.dependencies ?? {}) };
// Las deps del workspace ("*") se pinean a la versión workspace: un "*" suelto
// en el paquete publicado apuntaría a cualquier versión del registry (o a un
// 404 si esa dep aún no se publicó, como le pasó a strategies).
for (const depName of Object.keys(deps)) {
  if (!depName.startsWith("@arcade1v1/")) continue;
  const wsPkg = JSON.parse(
    readFileSync(join(ROOT, "packages", depName.split("/")[1], "package.json"), "utf8"),
  );
  deps[depName] = `^${wsPkg.version}`;
}
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      keywords: pkg.keywords,
      homepage: pkg.homepage,
      repository: pkg.repository,
      license: pkg.license,
      type: "module",
      engines: { node: ">=18" },
      sideEffects: false,
      exports: exportsMap,
      ...(Object.keys(deps).length ? { dependencies: deps } : {}),
    },
    null,
    2,
  ),
);
cpSync(join(pkgDir, "README.md"), join(stage, "README.md"));
cpSync(join(ROOT, "LICENSE"), join(stage, "LICENSE"));

// 4) Publicar.
execSync(`npm publish --access public${dryRun ? " --dry-run" : ""}${otpArg ? ` ${otpArg}` : ""}`, {
  cwd: stage,
  stdio: "inherit",
});
console.log(`✓ ${pkg.name}@${pkg.version} ${dryRun ? "(dry-run) " : ""}listo`);
