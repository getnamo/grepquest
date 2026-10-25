import { test, expect } from '@playwright/test';
import { MISSIONS } from '../../src/missions.ts';

test('all 20 missions are playable and progress survives reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  for (let i = 0; i < MISSIONS.length; i++) {
    if (i === 8 || i === 14) await page.locator(`[data-chapter="${MISSIONS[i].chapter}"]`).click();
    await page.locator(`[data-mission="${i}"]`).click();
    await page.locator('#command').fill(MISSIONS[i].solution);
    await page.locator('.run-button').click();
    await expect(page.locator('#mission-card .success-box')).toBeVisible();
    await expect(page.locator('.run-button')).toBeEnabled();
    if (i === 5) {
      await page.locator('.pipeline summary').click();
      await expect(page.locator('.pipeline section')).toHaveCount(2);
    }
  }
  await expect(page.locator('.progress-label strong')).toHaveText('20 / 20');
  await page.reload();
  await expect(page.locator('.progress-label strong')).toHaveText('20 / 20');
  await expect(page.locator('.mission-link.selected')).toContainText('Follow the evidence');
  await page.screenshot({ path: '/tmp/grep-quest-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('mobile objectives, hints, files, input helpers and progress', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#mobile-objective')).toContainText('print the directory');
  await expect(page.locator('.terminal')).toBeVisible();
  await page.locator('.mobile-tabs [data-tab="mission"]').click();
  await expect(page.locator('#mission-card')).toBeVisible();
  await page.locator('[data-action="hint"]').click();
  await expect(page.locator('.hint-box')).toContainText('where you are');
  await page.locator('.mobile-tabs [data-tab="files"]').click();
  await page.locator('[data-file="/workspace/README.md"]').click();
  await expect(page.locator('.file-content')).toContainText('Checkout workspace');
  await page.locator('.read-file-button').click();
  await expect(page.locator('#command')).toHaveValue("cat 'README.md'");
  await page.locator('#command').fill('pwd');
  await page.locator('.run-button').click();
  await expect(page.locator('#mobile-objective')).toContainText('MISSION ACCOMPLISHED');
  await page.locator('#mobile-objective [data-action="next"]').click();
  await expect(page.locator('#mobile-objective')).toContainText('List the contents');
  await page.locator('#command').fill('h');
  await page.locator('[data-action="complete"]').click();
  await expect(page.locator('#command')).toHaveValue('he'); // common prefix: help or head
  await page.locator('#command').fill('pw');
  await page.locator('[data-action="complete"]').click();
  await expect(page.locator('#command')).toHaveValue('pwd');
  await page.locator('[data-insert="|"]').click();
  await expect(page.locator('#command')).toHaveValue('pwd|');
  await page.locator('#command').fill('');
  await page.screenshot({ path: '/tmp/grep-quest-mobile.png', fullPage: true });
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('static-host browser worker runs commands and recovers from regex timeout', async ({ page }) => {
  await page.route('**/api/health', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.goto('/');
  await page.locator('#command').fill('pwd');
  await page.locator('.run-button').click();
  await expect(page.locator('#mission-card .success-box')).toBeVisible();
  await page.locator('#command').fill("grep -E '(.+)+Z' logs/checkout.log");
  await page.locator('.run-button').click();
  await expect(page.locator('.stderr').last()).toContainText('too long', { timeout: 6000 });
  await page.locator('#command').fill('ls');
  await page.locator('.run-button').click();
  await expect(page.locator('.stdout').last()).toContainText('logs/');
  await expect(page.locator('.run-button')).toBeEnabled();
});

test('Node API evaluates virtual commands and rejects shell escape attempts', async ({ request }) => {
  const response = await request.post('/api/run', { data: { command: 'grep ERROR logs/checkout.log | grep -v healthcheck | wc -l', missionId: 'count-impact' } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ stdout: '4\n', complete: true });
  for (const command of ['cat /etc/passwd', 'cat ../../etc/passwd', 'ls; id', 'echo $(id)', 'bash -c id']) {
    const result = await request.post('/api/run', { data: { command } });
    expect((await result.json()).exitCode).toBe(2);
  }
  expect((await request.post('/api/run', { data: { command: 'x'.repeat(5000) } })).status()).toBe(400);
  expect((await request.post('/api/run', { data: '{bad', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400);
  expect((await request.post('/api/run', { data: { command: 'pwd' }, headers: { Origin: 'https://other.example' } })).status()).toBe(403);
  const timeout = await request.post('/api/run', { data: { command: "grep -E '(.+)+Z' logs/checkout.log" } });
  expect(timeout.status()).toBe(500);
  expect(await timeout.json()).toMatchObject({ error: 'Command timed out. Simplify your pattern.' });
  const after = await request.post('/api/run', { data: { command: 'pwd' } });
  expect((await after.json()).stdout).toBe('/workspace\n');
});
