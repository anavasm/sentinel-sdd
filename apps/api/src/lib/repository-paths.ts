import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';

export const ALLOWED_REPO_ROOTS_ENV = 'SENTINEL_ALLOWED_REPO_ROOTS';

export interface AllowedLocalRepository {
  readonly path: string;
  readonly roots: readonly string[];
}

/** Returns existing absolute directory roots after resolving symlinks. */
export async function resolveAllowedRepoRoots(
  rawValue: string | undefined = process.env[ALLOWED_REPO_ROOTS_ENV],
): Promise<string[]> {
  if (rawValue === undefined || rawValue.trim() === '') {
    return [];
  }

  const roots: string[] = [];
  for (const configuredPath of rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)) {
    if (!isAbsolute(configuredPath)) {
      continue;
    }

    try {
      const canonicalPath = await realpath(configuredPath);
      if ((await stat(canonicalPath)).isDirectory() && !roots.includes(canonicalPath)) {
        roots.push(canonicalPath);
      }
    } catch {
      // Invalid or inaccessible entries never broaden the allowlist.
    }
  }

  return roots;
}

/** Canonicalizes a requested repository and proves it is beneath an allowed root. */
export async function resolveAllowedLocalRepository(
  localPath: string,
  rawRootsValue: string | undefined = process.env[ALLOWED_REPO_ROOTS_ENV],
): Promise<AllowedLocalRepository | undefined> {
  if (!isAbsolute(localPath)) {
    return undefined;
  }

  const roots = await resolveAllowedRepoRoots(rawRootsValue);
  if (roots.length === 0) {
    return undefined;
  }

  try {
    const canonicalPath = await realpath(localPath);
    if (!(await stat(canonicalPath)).isDirectory() || !isPathWithinRoots(canonicalPath, roots)) {
      return undefined;
    }
    return { path: canonicalPath, roots };
  } catch {
    return undefined;
  }
}

export function isPathWithinRoots(candidatePath: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const relativePath = relative(root, candidatePath);
    return (
      relativePath === '' ||
      (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
    );
  });
}
