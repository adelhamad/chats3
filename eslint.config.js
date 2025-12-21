import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import prettierPlugin from "eslint-plugin-prettier";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";

export default [
  { ignores: ["dist", "coverage", "docs"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      sonarjs: sonarjs,
      import: importPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...sonarjs.configs.recommended.rules,
      ...importPlugin.configs.recommended.rules,
      ...prettierPlugin.configs.recommended.rules,
      "array-callback-return": 0,
      camelcase: 0,
      "sonarjs/no-commented-code": "off",
      "no-empty-function": 2,
      "consistent-return": 0,
      "import/no-cycle": 0,
      "import/no-unresolved": 0,
      // Disable import rules that fail on some node_modules with TS syntax
      "import/namespace": "off",
      "import/default": "off",
      "import/no-named-as-default": "off",
      "import/no-named-as-default-member": "off",
      "import/order": [
        "warn",
        {
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
          },
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling"],
            "index",
          ],
        },
      ],
      "import/prefer-default-export": "off",
      "no-nested-ternary": 0,
      "no-return-assign": 0,
      "no-underscore-dangle": 0,
      "no-useless-escape": 0,
      "no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
        },
      ],
      curly: ["error", "all"],
    },
  },
];
