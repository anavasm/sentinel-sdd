import { expect, test, type APIRequestContext } from '@playwright/test';

const CONTROL_URL = 'http://127.0.0.1:4311';
const DASHBOARD_URL = 'http://localhost:5173';
const EVENT_COUNT = 30;
const MAX_LATENCY_MS = 500;

type LatencySample = {
  eventId: number;
  elapsedMs: number;
};

async function createAudit(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${CONTROL_URL}/start`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { auditId?: string };
  expect(body.auditId).toMatch(/^aud_[0-9A-Za-z]+$/);
  return body.auditId as string;
}

async function emitEvent(
  request: APIRequestContext,
  auditId: string,
  delayMs = 0,
): Promise<number> {
  const response = await request.post(`${CONTROL_URL}/emit`, {
    data: { auditId, delayMs },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { eventId?: number };
  expect(body.eventId).toBeGreaterThan(0);
  return body.eventId as number;
}

function percentile(samples: readonly LatencySample[], percentileRank: number): number {
  const sorted = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * percentileRank) - 1] ?? 0;
}

test.describe('P1 SSE DOM latency', () => {
  test('renders 30 sequential events below 500 ms', async ({ page, request }) => {
    const auditId = await createAudit(request);
    await page.goto(`${DASHBOARD_URL}/audits/${auditId}`);
    await page.getByTestId('tab-All Events').click();
    const eventList = page.getByTestId('all-events-list');

    const samples: LatencySample[] = [];
    for (let index = 0; index < EVENT_COUNT; index += 1) {
      const startedAt = performance.now();
      const eventId = await emitEvent(request, auditId);
      await expect(eventList.locator('li')).toHaveCount(index + 1);
      const elapsedMs = performance.now() - startedAt;
      samples.push({ eventId, elapsedMs });
      expect(eventId).toBe(index + 1);
      expect(elapsedMs).toBeLessThan(MAX_LATENCY_MS);
    }

    const max = Math.max(...samples.map((sample) => sample.elapsedMs));
    console.log(JSON.stringify({
      count: samples.length,
      minMs: Math.min(...samples.map((sample) => sample.elapsedMs)),
      medianMs: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      maxMs: max,
      samples,
    }));
    expect(max).toBeLessThan(MAX_LATENCY_MS);
  });

  test('detects the delayed negative control', async ({ page, request }) => {
    const auditId = await createAudit(request);
    await page.goto(`${DASHBOARD_URL}/audits/${auditId}`);
    await page.getByTestId('tab-All Events').click();
    const eventList = page.getByTestId('all-events-list');

    const startedAt = performance.now();
    await emitEvent(request, auditId, MAX_LATENCY_MS + 100);
    await expect(eventList.locator('li')).toHaveCount(1);
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(MAX_LATENCY_MS);
  });
});
