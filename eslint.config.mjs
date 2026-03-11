import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      ".next-dev/**",
      ".next-build/**",
      ".next-pages/**",
      "tmp/**",
      "public/**",
    ],
  },
];

export default config;
