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
  await expect(page.locator('#command')).toHaveValue('h'); // ambiguous: help, head, or hint
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

for (const mobile of [false, true]) test(`terminal help works on ${mobile ? 'mobile' : 'desktop'}`, async ({ page, request }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.terminal-help [data-fill="grep --help"]').click();
  await expect(page.locator('#command')).toHaveValue('grep --help');
  await page.locator('.run-button').click();
  await expect(page.locator('.stdout').last()).toContainText('Ignore case');
  await expect(page.locator('.stdout').last()).toContainText('Examples:');
  await expect(page.locator('.progress-label strong')).toHaveText('0 / 20');
  await page.locator('#command').fill('help pi');
  await page.locator('#command').press('Tab');
  await expect(page.locator('#command')).toHaveValue('help pipes');
  await page.locator('.run-button').click();
  await expect(page.locator('.stdout').last()).toContainText('Inspect pipeline');
  await page.locator('#command').fill('grep --he');
  await page.locator('#command').press('Tab');
  await expect(page.locator('#command')).toHaveValue('grep --help');
  await page.locator('#command').fill('help cd');
  await page.locator('.run-button').click();
  await expect(page.locator('.stdout').last()).toContainText('Change the virtual working directory');
  await expect(page.locator('#cwd')).toHaveText('/workspace');
  const response = await request.post('/api/run', { data: { command: 'help grep | head -n 4 | wc -l', missionId: 'count-impact' } });
  expect(await response.json()).toMatchObject({ stdout: '4\n', complete: false });
});

for (const mobile of [false, true]) test(`focus mode keeps the CLI usable on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
  const size = mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
  await page.setViewportSize(size);
  if (mobile) await page.route('**/api/health', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.goto('/');
  const run = async (command: string) => {
    await page.locator('#command').fill(command);
    await page.locator('.run-button').click();
    await expect(page.locator('.run-button')).toBeEnabled();
  };
  await page.locator('#command').fill("grep 'ERROR'");
  await page.getByRole('button', { name: 'Focus terminal', exact: true }).click();
  await expect(page.locator('#command')).toHaveValue("grep 'ERROR'");
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.mission-card')).toBeHidden();
  await expect(page.locator('.topbar')).toBeHidden();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  expect(await page.locator('.terminal').boundingBox()).toMatchObject({ x: 0, y: 0, width: size.width, height: size.height });
  await expect(page.locator('.mission-brief').last()).toContainText('Get your bearings');
  await run('next-mission');
  await expect(page.locator('.stderr').last()).toContainText('Finish the current mission first');
  await run('hint');
  await expect(page.locator('.stdout').last()).toContainText('HINT 1/3');
  await run('mission');
  await expect(page.locator('.stdout').last()).toContainText('MISSION 01/20');
  await run('pwd');
  await expect(page.locator('.mission-complete')).toContainText('Type next-mission');
  await run('pwd');
  await expect(page.locator('.mission-complete')).toHaveCount(1);
  await page.locator('#command').fill('next-mis');
  await page.locator('#command').press('Tab');
  await expect(page.locator('#command')).toHaveValue('next-mission');
  await page.locator('#command').press('Enter');
  await expect(page.locator('.stdout').last()).toContainText('MISSION 02/20 — Read the room');
  await expect(page.locator('.run-button')).toBeEnabled();
  await page.locator('#command').press('ArrowUp');
  await expect(page.locator('#command')).toHaveValue('next-mission');
  await run('ls');
  await expect(page.locator('.mission-complete').last()).toContainText('Read the room');
  await page.locator('#command').fill('unfinished draft');
  await page.locator('#command').press('Escape');
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('#command')).toHaveValue('unfinished draft');
  await expect(page.locator('.progress-label strong')).toHaveText('2 / 20');
  await page.getByRole('button', { name: 'Focus terminal', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Restore layout', exact: true })).toBeVisible();
  await expect(page.locator('.welcome-brief')).toContainText('MISSION 02/20');
  await run('mission 21');
  await expect(page.locator('.stderr').last()).toContainText('1 to 20');
  await run('mission');
  await expect(page.locator('.stdout').last()).toContainText('MISSION 02/20');
  await run('focus off');
  await expect(page.locator('.sidebar')).toBeVisible();
  await run('focus on');
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 400 }, size]) {
    await page.setViewportSize(viewport);
    const input = await page.locator('#command').boundingBox();
    expect(input!.y).toBeGreaterThan(0);
    expect(input!.y + input!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: mobile ? '/tmp/grep-quest-focus-mobile.png' : '/tmp/grep-quest-focus-desktop.png' });
});

test('the whole course can be completed from the focused CLI', async ({ page }) => {
  await page.goto('/');
  const run = async (command: string) => {
    await page.locator('#command').fill(command);
    await page.locator('#command').press('Enter');
    await expect(page.locator('.run-button')).toBeEnabled();
  };
  await run('focus on');
  await expect(page.locator('.sidebar')).toBeHidden();
  for (let i = 0; i < MISSIONS.length; i++) {
    await run(MISSIONS[i].solution);
    await expect(page.locator('.mission-complete').last()).toContainText(MISSIONS[i].title);
    await run('next-mission');
    if (i < MISSIONS.length - 1) {
      await expect(page.locator('.stdout').last()).toContainText(MISSIONS[i + 1].brief);
      await expect(page.locator('#cwd')).toHaveText('/workspace');
    }
  }
  await expect(page.locator('.stdout').last()).toContainText('COURSE COMPLETE');
  await expect(page.locator('.stdout').last()).toContainText('FREE PRACTICE');
  await expect(page.locator('.mission-complete')).toHaveCount(20);
  await expect(page.locator('.progress-label strong')).toHaveText('20 / 20');
  await run('hint');
  await expect(page.locator('.stdout').last()).toContainText('Free practice has no mission hints');
  await run('mission 1');
  await expect(page.locator('.stdout').last()).toContainText('Already completed');
  await run('next-mission --help');
  await expect(page.locator('.stdout').last()).toContainText('Game control, not a Bash command');
  await run('mission');
  await expect(page.locator('.stdout').last()).toContainText('MISSION 01/20');
  await expect(page.locator('.sidebar')).toBeHidden();
});
