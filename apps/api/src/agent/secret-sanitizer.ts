import { lintSource } from '@secretlint/core';
import { rules as recommendedSecretRules } from '@secretlint/secretlint-rule-preset-recommend';

export type SecretRange = readonly [start: number, end: number];

export type SecretScanResult =
  | { readonly ok: true; readonly ranges: readonly SecretRange[] }
  | { readonly ok: false };

export interface SecretSanitizer {
  sanitize(content: string, filePath: string): Promise<SecretSanitizationResult>;
}

export type SecretSanitizationResult =
  | { readonly ok: true; readonly content: string; readonly redacted: boolean }
  | { readonly ok: false };

export type SecretScanner = (content: string, filePath: string) => Promise<SecretScanResult>;

const SECRET_LINT_CONFIG = {
  // Source-controlled ignore comments must not disable egress scanning.
  rules: recommendedSecretRules
    .filter((rule) => rule.meta.id !== '@secretlint/secretlint-rule-filter-comments')
    .map((rule) => ({ id: rule.meta.id, rule })),
};

const REDACTION_MARKER = '[REDACTED]';

const secretlintScanner: SecretScanner = async (content, filePath) => {
  const result = await lintSource({
    source: { content, filePath, contentType: 'text' },
    options: { config: SECRET_LINT_CONFIG, noPhysicFilePath: true },
  });
  if (!Array.isArray(result.messages)) {
    return { ok: false };
  }
  return {
    ok: true,
    ranges: result.messages.map((message) => message.range),
  };
};

export function createSecretSanitizer(
  scanner: SecretScanner = secretlintScanner,
): SecretSanitizer {
  return {
    async sanitize(content, filePath) {
      try {
        const scan = await scanner(content, filePath);
        if (!scan.ok || !Array.isArray(scan.ranges)) {
          return { ok: false };
        }

        const ranges = normalizeRanges(scan.ranges, content.length);
        if (ranges === null) {
          return { ok: false };
        }

        let sanitizedContent = content;
        for (const [start, end] of [...ranges].reverse()) {
          sanitizedContent =
            sanitizedContent.slice(0, start) + REDACTION_MARKER + sanitizedContent.slice(end);
        }
        return {
          ok: true,
          content: sanitizedContent,
          redacted: ranges.length > 0,
        };
      } catch {
        return { ok: false };
      }
    },
  };
}

export const defaultSecretSanitizer = createSecretSanitizer();

function normalizeRanges(
  ranges: readonly SecretRange[],
  contentLength: number,
): readonly SecretRange[] | null {
  const orderedRanges: SecretRange[] = [];
  for (const range of ranges) {
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !Number.isInteger(range[0]) ||
      !Number.isInteger(range[1]) ||
      range[0] < 0 ||
      range[1] <= range[0] ||
      range[1] > contentLength
    ) {
      return null;
    }
    orderedRanges.push([range[0], range[1]]);
  }

  orderedRanges.sort(([leftStart], [rightStart]) => leftStart - rightStart);
  const mergedRanges: SecretRange[] = [];
  for (const [start, end] of orderedRanges) {
    const previous = mergedRanges.at(-1);
    if (previous !== undefined && start <= previous[1]) {
      mergedRanges[mergedRanges.length - 1] = [previous[0], Math.max(previous[1], end)];
    } else {
      mergedRanges.push([start, end]);
    }
  }
  return mergedRanges;
}
