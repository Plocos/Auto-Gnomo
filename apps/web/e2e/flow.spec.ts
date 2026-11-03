/**
 * E2E smoke (Playwright) — requiere API+Web (pnpm dev) con seed.
 */
import { test, expect } from '@playwright/test';

const WEB = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API = process.env.VITE_API_URL ?? 'http://localhost:3001';

test.describe.configure({ mode: 'serial' });

test('profile open and see dashboard', async ({ page }) => {
  await page.goto(`${WEB}/`);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
    timeout: 15000,
  });
});

test('API: closed quarter blocks edit, correction works', async ({ request }) => {
  const vault = await request.get(`${API}/api/vault`);
  expect(vault.ok()).toBeTruthy();

  const blocked = await request.post(`${API}/api/movements`, {
    data: {
      type: 'expense',
      invoiceDate: '2026-05-10',
      fiscalDate: '2026-05-10',
      concept: 'Should block',
      taxBaseCents: 1000,
      vatRateBps: 2100,
      status: 'confirmed',
      source: 'manual',
      professionalUseBps: 10000,
      taxDeductibleBps: 10000,
      expenseNature: 'current',
    },
  });
  expect(blocked.status()).toBe(409);
  const body = await blocked.json();
  expect(body.code).toBe('QUARTER_CLOSED');

  const list = await request.get(`${API}/api/movements?fiscalYear=2026&quarter=T2&pageSize=5`);
  const items = (await list.json()).items as { id: string }[];
  expect(items.length).toBeGreaterThan(0);

  const correction = await request.post(`${API}/api/movements`, {
    data: {
      type: 'correction',
      invoiceDate: '2026-05-10',
      fiscalDate: '2026-05-10',
      concept: 'Corrección gasto olvidado',
      taxBaseCents: -500,
      vatRateBps: 0,
      vatCents: 0,
      vatTreatment: 'not_subject',
      correctsMovementId: items[0]!.id,
      correctionReason: 'Gasto olvidado en T2 presentado',
      status: 'confirmed',
      source: 'manual',
      professionalUseBps: 10000,
      taxDeductibleBps: 10000,
      expenseNature: 'current',
    },
  });
  expect(correction.ok()).toBeTruthy();

  const audit = await request.get(`${API}/api/audit-log?pageSize=20`);
  expect(audit.ok()).toBeTruthy();
  const auditBody = await audit.json();
  expect(auditBody.total).toBeGreaterThan(0);
});
