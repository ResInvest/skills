// ESLint (flat config) dla całego monorepo: TypeScript z regułami typowanymi, React Hooks we frontendzie.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/generated/**", "**/coverage/**", "apps/desktop/src-tauri/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports", disallowTypeAnnotations: false }],
      "no-console": ["error", { allow: ["error", "warn"] }],
      eqeqeq: ["error", "always"],
    },
  },
  {
    // ekran konfiguracji aplikacji Windows (zwykły skrypt przeglądarki w oknie Tauri)
    files: ["apps/desktop/setup/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // szablon service workera PWA (zmienne __BUILD__ / __PRECACHE__ podstawia build)
    files: ["apps/web/sw.template.js"],
    languageOptions: { globals: { ...globals.serviceworker, __PRECACHE__: "readonly" } },
  },
  {
    // skrypty uruchomieniowe (Node, ESM)
    files: ["**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["apps/api/src/**/*.ts"],
    // NestJS wstrzykuje zależności po typie konstruktora — import typu klasy musi zostać wartością
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
