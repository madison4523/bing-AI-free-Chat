/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  plugins: ["react", "react-hooks", "react-refresh"],
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", "node_modules"],
  rules: {
    // Vite + React 17+ doesn't require React in scope
    "react/react-in-jsx-scope": "off",

    // This project doesn't use PropTypes (JS + hooks)
    "react/prop-types": "off",

    // Allow quotes and other entities in JSX text (content-heavy UI)
    "react/no-unescaped-entities": "off",

    // Avoid false-positives that break CI when --max-warnings=0
    "react-refresh/only-export-components": "off",
  },
};
