import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const CONTROL_URL = 'http://127.0.0.1:4312';

test('launches an audit through the shell and renders live metrics', async ({ page, request }) => {
  const blockedRequests: string[] = [];
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => {
    browserErrors.push(error.message);
    console.error('[browser error]', error);
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      blockedRequests.push(url.href);
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await expect(page.getByRole('form', { name: 'Audit launch' })).toBeVisible();
  await page.getByLabel('Repository URL').fill('https://example.invalid/synthetic-repository.git');
  await page.getByLabel('Severity threshold').selectOption('LOW');

  const createResponse = page.waitForResponse(
    (response) =>
      response.url() === 'http://localhost:3000/api/v1/audits' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Launch audit' }).click();
  const response = await createResponse;
  expect(response.status(), 'audit creation response').toBe(201);
  const created: unknown = await response.json();
  expect(created).toMatchObject({ auditId: expect.stringMatching(/^aud_[0-9A-Za-z]+$/) });
  if (
    typeof created !== 'object' ||
    created === null ||
    !('auditId' in created) ||
    typeof created.auditId !== 'string'
  ) {
    throw new Error('Audit creation response does not contain an audit ID.');
  }
  const auditId = created.auditId;
  await expect(page).toHaveURL(new RegExp(`/audits/${auditId}$`));
  await expect(page.getByRole('heading', { name: 'Audit Execution Metrics' })).toBeVisible();
  await expect(page.getByTestId('stream-status-badge')).toHaveText('Live stream active');

  const release = await request.post(`${CONTROL_URL}/run/${auditId}`);
  expect(release.status(), 'release deterministic fixture runner').toBe(202);

  await expect(page.getByTestId('timeline-thought')).toContainText('Analyzing src/auth/queries.ts');
  await expect(page.getByTestId('stream-status-badge')).toHaveText('Completed');
  await expect(page.getByTestId('health-score')).toHaveText('Health score: 72/100');
  await expect(page.getByTestId('findings-counter-HIGH')).toHaveText('1 HIGH');
  const chart = page.getByTestId('severity-distribution-chart');
  await expect(chart).toBeVisible();
  await expect(chart.getByTestId('severity-distribution-HIGH')).toContainText('1');
  await expect(chart.getByTestId('severity-distribution-LOW')).toContainText('0');
  await expect(chart.locator('.recharts-bar-rectangle path[fill="#ef4444"]')).toHaveCount(1);

  await page.getByRole('tab', { name: 'Findings' }).click();
  await expect(page.getByTestId('finding-card')).toHaveCount(1);
  await expect(page.getByTestId('finding-card')).toContainText('SQL Injection in user lookup');
  await expect(page.getByTestId('finding-after')).toContainText('db.query');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Markdown report' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`sentinel-audit-${auditId}.md`);
  const downloadPath = await download.path();
  if (downloadPath === null) throw new Error('Markdown report download failed.');
  const report = await readFile(downloadPath, 'utf8');
  expect(report).toContain('SQL Injection in user lookup');
  expect(report).toContain('- **HIGH:** 1');
  expect(report).toContain('**Suggested After (for manual review)**');
  expect(blockedRequests, 'browser requests to external hosts').toEqual([]);
  expect(browserErrors, 'browser runtime errors').toEqual([]);
});

test('renders the metrics remote standalone with its own React instance', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('http://localhost:5175/');
  await expect(page.getByRole('heading', { name: 'Audit Execution Metrics' })).toBeVisible();
  await expect(page.getByTestId('severity-distribution-chart')).toBeVisible();
  expect(browserErrors, 'standalone browser runtime errors').toEqual([]);
});
