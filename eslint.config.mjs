// Configuración de ESLint (flat config) para el monorepo.
// Cubre el código TypeScript de las apps y el game-sdk. El contrato (Solidity)
// y los artefactos generados quedan fuera. Las reglas de formato las maneja
// Prettier (por eso al final aplicamos `eslint-config-prettier`, que apaga
// cualquier regla de estilo que pelee con el formateador).

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/out/**",
      "**/*.tsbuildinfo",
      "packages/contracts/**", // Solidity + libs de Foundry
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Reglas de React Hooks solo para los componentes (.tsx). Registramos el
    // plugin a mano en formato flat (el preset del plugin aún no es flat-nativo).
    files: ["**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    rules: {
      // TypeScript ya verifica variables/identificadores no definidos.
      "no-undef": "off",
      // El proyecto usa `any` puntual y a propósito en casts de replay/ABIs.
      "@typescript-eslint/no-explicit-any": "off",
      // Avisar (no romper) por código sin usar; ignora lo prefijado con "_".
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
