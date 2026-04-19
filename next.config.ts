import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const outputMode =
  process.env.NEXT_OUTPUT_MODE === "pages" ? "pages" : "build";

const isPagesBuild = outputMode === "pages";
const pagesBasePath = (process.env.PAGES_BASE_PATH ?? "").trim();

const nextConfig: NextConfig = {
  distDir: isPagesBuild ? ".next-pages" : ".next",
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