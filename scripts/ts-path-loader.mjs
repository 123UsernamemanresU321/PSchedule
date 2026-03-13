import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();

function resolveAlias(specifier) {
  if (!specifier.startsWith("@/")) {
    return null;
  }

  const relativePath = specifier.slice(2);
  const basePath = path.resolve(projectRoot, "src", relativePath);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];

  const resolvedPath = candidates.find((candidate) => {
    if (!fs.existsSync(candidate)) {
      return false;
    }

    return fs.statSync(candidate).isFile();
  });
  return resolvedPath ? pathToFileURL(resolvedPath).href : null;
}

export async function resolve(specifier, context, defaultResolve) {
  const aliasResolution = resolveAlias(specifier);

  if (aliasResolution) {
    return {
      shortCircuit: true,
      url: aliasResolution,
    };
  }

  return defaultResolve(specifier, context, defaultResolve);
}
