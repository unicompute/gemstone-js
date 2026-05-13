export interface GciLibraryDiscoveryEnv {
  GS_LIB_PATH?: string;
  GS_LIB?: string;
  GEMSTONE?: string;
}

export interface GciLibraryDiscoveryHost {
  listDir?(path: string): Iterable<string>;
}

export function resolveGciLibraryPath(
  explicitPath: string | undefined,
  env: GciLibraryDiscoveryEnv,
  host: GciLibraryDiscoveryHost = {},
): string | undefined {
  const explicit = cleanPath(explicitPath);
  if (explicit) return explicit;

  const configuredPath = cleanPath(env.GS_LIB_PATH);
  if (configuredPath) return configuredPath;

  const gsLib = cleanPath(env.GS_LIB);
  if (gsLib) {
    if (looksLikeGciLibraryPath(gsLib)) return gsLib;
    const discovered = findGciLibraryInDirectory(gsLib, host);
    if (discovered) return discovered;
  }

  const gemstone = cleanPath(env.GEMSTONE);
  if (gemstone) {
    const discovered = findGciLibraryInDirectory(joinPath(gemstone, "lib"), host);
    if (discovered) return discovered;
  }

  return undefined;
}

export function findGciLibraryInDirectory(
  dir: string,
  host: GciLibraryDiscoveryHost = {},
): string | undefined {
  if (!host.listDir) return undefined;
  const candidates = Array.from(host.listDir(dir))
    .filter(isGciLibraryName)
    .sort();
  const newest = candidates.at(-1);
  return newest ? joinPath(dir, newest) : undefined;
}

export function isGciLibraryName(name: string): boolean {
  return name.startsWith("libgcirpc")
    && (name.endsWith(".dylib") || name.endsWith(".so") || name.endsWith(".dll"));
}

function cleanPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function looksLikeGciLibraryPath(path: string): boolean {
  const name = path.split(/[\\/]/).at(-1) ?? path;
  return isGciLibraryName(name);
}

function joinPath(base: string, child: string): string {
  if (base.endsWith("/") || base.endsWith("\\")) return `${base}${child}`;
  return `${base}/${child}`;
}
