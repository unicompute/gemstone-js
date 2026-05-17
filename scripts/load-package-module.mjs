import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(scriptDir);
const installedInNodeModules = packageRoot.split(sep).includes("node_modules");

export async function loadPackageModule(sourceRelativePath) {
  const distRelativePath = sourceRelativePath.replace(/\.ts$/, ".js");
  const sourcePath = join(packageRoot, "src", sourceRelativePath);
  const distPath = join(packageRoot, "dist", distRelativePath);
  const candidates = installedInNodeModules ? [distPath, sourcePath] : [sourcePath, distPath];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return import(pathToFileURL(candidate).href);
  }
  throw new Error(`Cannot load package module ${sourceRelativePath}; expected ${candidates.join(" or ")}.`);
}
