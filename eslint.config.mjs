import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    settings: {
      next: {
        rootDir: ["frontend/"],
      },
    },
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    ignores: [
      ".next/**",
      "**/.next/**",
      "node_modules/**",
      "scratch/**",
      "cache/**",
      "coverage/**",
      "dist/**",
      "out/**",
      "frontend/public/**",
      "test-results/**",
      "playwright-report/**",
      "blob-report/**",
    ],
  },
];

export default eslintConfig;
