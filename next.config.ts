import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const outputMode =
  process.env.NEXT_OUTPUT_MODE === "build"
    ? "build"
    : process.env.NEXT_OUTPUT_MODE === "pages"
      ? "pages"
      : "dev";
const isPagesBuild = outputMode === "pages";
const pagesBasePath = (process.env.PAGES_BASE_PATH ?? "").trim();

const nextConfig: NextConfig = {
  distDir:
    outputMode === "build"
      ? ".next-build"
      : outputMode === "pages"
        ? ".next-pages"
        : ".next-dev",
  output: isPagesBuild ? "export" : undefined,
  trailingSlash: isPagesBuild,
  images: {
    unoptimized: isPagesBuild,
  },
  basePath: isPagesBuild && pagesBasePath ? pagesBasePath : undefined,
  assetPrefix: isPagesBuild && pagesBasePath ? `${pagesBasePath}/` : undefined,
  typedRoutes: true,
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
