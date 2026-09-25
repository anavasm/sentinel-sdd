import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { AuditConfig } from '@sentinel/contracts';

/**
 * Repository access for the Audit Runner (plan US-5 Task 5.1).
 *
 * Reads source files from a `localPath` (direct walk) or a `repoUrl`
 * (shallow `git clone` into a temp directory). Reading failures are expected
 * failures returned as a result — the runner maps them to failed
 * TOOL_EXECUTION + terminal AUDIT_COMPLETED events (NFR-A3), never crashes.
 *
 * Hard caps keep a hostile repository from exhausting the process (NFR-S2):
 * file count, per-file size, and snippet size are all bounded.
 */

/** One source file snapshot handed to the LLM analysis step. */
export interface RepositoryFile {
  /** Repo-relative POSIX path (e.g. `src/auth/queries.ts`). */
  readonly filePath: string;
  /** File content, truncated to `MAX_FILE_BYTES`. */
  readonly content: string;
}

export type RepositoryReadResult =
  | { readonly ok: true; readonly files: readonly RepositoryFile[] }
  | { readonly ok: false; readonly error: string };

/** Seam so the runner is testable without a real filesystem (ASD §10.3). */
export interface RepositoryReader {
  read(config: AuditConfig): Promise<RepositoryReadResult>;
}

/** Boundaries protecting the process from oversized repositories (NFR-S2). */
export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 64 * 1024;

const CLONE_TIMEOUT_MS = 60_000;

/** File extensions considered auditable source; everything else is skipped. */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.java',
  '.go',
  '.rb',
  '.php',
  '.cs',
  '.sql',
  '.json',
  '.yaml',
  '.yml',
]);

/** Directory names never traversed (dependency/vendor trees, VCS internals). */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', '.venv', 'vendor']);

export interface FsRepositoryReaderOptions {
  /** Injectable git command runner; defaults to `git clone --depth 1`. */
  readonly runGit?: (args: readonly string[]) => Promise<void>;
}

/**
 * Filesystem-backed repository reader for both config shapes:
 * `localPath` → direct walk; `repoUrl` → shallow clone into a temp dir that
 * is always cleaned up afterwards.
 */
export class FsRepositoryReader implements RepositoryReader {
  private readonly runGit: (args: readonly string[]) => Promise<void>;

  constructor(options: FsRepositoryReaderOptions = {}) {
    this.runGit = options.runGit ?? defaultRunGit;
  }

  async read(config: AuditConfig): Promise<RepositoryReadResult> {
    if (config.localPath !== undefined) {
      return readDirectoryAsRepo(config.localPath);
    }
    if (config.repoUrl !== undefined) {
      return readGitRepo(config.repoUrl, this.runGit);
    }
    return { ok: false, error: 'Audit config has neither repoUrl nor localPath.' };
  }
}

async function defaultRunGit(args: readonly string[]): Promise<void> {
  await promisify(execFile)('git', [...args], { timeout: CLONE_TIMEOUT_MS });
}

async function readGitRepo(
  repoUrl: string,
  runGit: (args: readonly string[]) => Promise<void>,
): Promise<RepositoryReadResult> {
  const cloneDir = await mkdtemp(join(tmpdir(), 'sentinel-clone-'));
  try {
    await runGit(['clone', '--depth', '1', repoUrl, cloneDir]);
    return await readDirectoryAsRepo(cloneDir);
  } catch (error) {
    return {
      ok: false,
      error: `Could not clone the repository: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await rm(cloneDir, { recursive: true, force: true });
  }
}

async function readDirectoryAsRepo(rootDir: string): Promise<RepositoryReadResult> {
  const files: RepositoryFile[] = [];
  const walk = async (directory: string): Promise<string | undefined> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      return `Could not read the repository directory: ${error instanceof Error ? error.message : String(error)}`;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        return undefined; // Cap reached — stop scanning, keep what we have.
      }
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        const walkError = await walk(entryPath);
        if (walkError !== undefined) {
          return walkError;
        }
        continue;
      }
      if (!SOURCE_EXTENSIONS.has(extensionOf(entry.name))) {
        continue;
      }
      const content = await readBoundedFile(entryPath);
      if (content === null) {
        continue; // Unreadable or oversized files are skipped, not fatal.
      }
      files.push({ filePath: relativePath(rootDir, entryPath), content });
    }
    return undefined;
  };

  const walkError = await walk(rootDir);
  if (walkError !== undefined) {
    return { ok: false, error: walkError };
  }
  if (files.length === 0) {
    return { ok: false, error: 'No readable source files were found in the repository.' };
  }
  return { ok: true, files };
}

async function readBoundedFile(filePath: string): Promise<string | null> {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.size > MAX_FILE_BYTES || !fileStat.isFile()) {
      return null;
    }
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function extensionOf(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}

function relativePath(rootDir: string, filePath: string): string {
  const relative = filePath.startsWith(rootDir) ? filePath.slice(rootDir.length) : filePath;
  return relative.replace(/^[\\/]/, '');
}

/**
 * Strips credentials from a Git URL before it is echoed into a tool event
 * (NFR-S2 — no secrets in event payloads).
 */
export function sanitizeRepoUrl(repoUrl: string): string {
  try {
    const url = new URL(repoUrl);
    return `${url.protocol}//${url.host}${url.pathname}${url.search}`;
  } catch {
    return repoUrl.split('@').at(-1) ?? repoUrl;
  }
}
