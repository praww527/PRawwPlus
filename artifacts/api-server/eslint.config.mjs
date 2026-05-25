// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "*.js", "*.cjs", "*.mjs"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── Hard errors — block CI on genuinely unsafe async patterns ───────────
      "@typescript-eslint/no-floating-promises":     "error",
      "@typescript-eslint/no-misused-promises":      "error",
      "@typescript-eslint/await-thenable":           "error",

      // ── Warnings — reported, tracked, but do not block CI ─────────────────
      // (large existing `any` debt is tracked as tech-debt, not a gate blocker)
      "@typescript-eslint/no-explicit-any":               "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/consistent-type-imports":       ["warn", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // ── Disabled — legitimate patterns in this codebase ───────────────────
      // Express module augmentation uses `namespace` and empty interface extension
      "@typescript-eslint/no-namespace":        "off",
      "@typescript-eslint/no-empty-object-type": "off",

      // TypeScript compiler already enforces these
      "no-undef":       "off",
      "no-unused-vars": "off",
    },
  },
  {
    // Node test runner's test() returns a Promise by design — floating is intentional.
    // This override must come AFTER the general src/**/*.ts config to take precedence.
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
);
