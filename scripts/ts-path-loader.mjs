import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = process.cwd();

function findCandidatePath(basePath) {
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

  return resolvedPath ?? null;
}

function resolveAlias(specifier) {
  if (!specifier.startsWith("@/")) {
    return null;
  }

  const relativePath = specifier.slice(2);
  const basePath = path.resolve(projectRoot, "src", relativePath);
  const resolvedPath = findCandidatePath(basePath);

  return resolvedPath ? pathToFileURL(resolvedPath).href : null;
}

function resolveRelativeTsPath(specifier, context) {
  if (
    (!specifier.startsWith("./") && !specifier.startsWith("../") && !specifier.startsWith("/")) ||
    !context.parentURL?.startsWith("file:")
  ) {
    return null;
  }

  const parentPath = fileURLToPath(context.parentURL);
  const unresolvedPath = specifier.startsWith("/")
    ? specifier
    : path.resolve(path.dirname(parentPath), specifier);

  const candidates = [unresolvedPath];

  if (unresolvedPath.endsWith(".js")) {
    candidates.push(unresolvedPath.slice(0, -3));
    candidates.push(`${unresolvedPath.slice(0, -3)}.ts`);
    candidates.push(`${unresolvedPath.slice(0, -3)}.tsx`);
  }

  const resolvedPath = candidates
    .map((candidate) => findCandidatePath(candidate))
    .find((candidate) => candidate);

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

  const relativeResolution = resolveRelativeTsPath(specifier, context);

  if (relativeResolution) {
    return {
      shortCircuit: true,
      url: relativeResolution,
    };
  }

  return defaultResolve(specifier, context, defaultResolve);
}
