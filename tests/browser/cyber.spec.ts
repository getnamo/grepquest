import { test, expect } from '@playwright/test';
import { makeScenario } from '../../src/cyber/model.ts';

test('cyberspace is a separate mode and a complete 3D/CLI race is playable', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('.cyber-mode-link').click();
  await expect(page).toHaveURL(/cyber\.html$/);
  await expect(page.locator('#briefing')).toBeVisible();
  await expect(page.locator('#webgl-error')).toBeHidden();
  await page.getByLabel('Starting difficulty', { exact: true }).selectOption('easy');
  await expect(page.locator('#difficulty-description')).toContainText('2.4× slower');
  await page.locator('[data-action=start]').click();
  await expect(page.locator('#world canvas')).toBeVisible();
  await page.keyboard.down('w'); await page.waitForTimeout(200); await page.keyboard.up('w');
  const objectives = makeScenario(1).objectives;
  const run = async (command: string) => {
    await page.locator('#cyber-command').fill(command);
    await page.locator('#cyber-command').press('Enter');
    await expect(page.locator('#cyber-run')).toBeEnabled();
  };
  for (let i = 0; i < objectives.length; i++) {
    await page.locator('[data-action=waypoint]').click();
    await expect(page.locator('#interface-button')).toBeEnabled({ timeout: 20000 });
    await page.locator('#interface-button').click();
    await expect(page.locator('#console')).toBeVisible();
    await expect(page.locator('#console-title')).toHaveText(objectives[i].title);
    if (i === 0) {
      await run('grep --help'); await expect(page.locator('.cyber-entry').last()).toContainText('Ignore case');
      await run('hint'); await expect(page.locator('.cyber-entry').last()).toContainText('HINT 1/3');
      await run('echo wrong | tee controls/relay.cfg'); await expect(page.locator('#player-score')).toHaveText('0 / 5');
      await page.screenshot({ path: '/tmp/nullrun-console-desktop.png' });
    }
    await run(objectives[i].solution);
    await expect(page.locator('#player-score')).toHaveText(`${i + 1} / 5`);
    if (i < objectives.length - 1) {
      await expect(page.locator('.cyber-entry.success').last()).toContainText('CONTROL PATCHED');
      await run('next-node');
      await expect(page.locator('#console')).toBeHidden();
      await expect(page.locator('#objective-name')).toContainText(objectives[i + 1].name);
    }
  }
  await expect(page.locator('#outcome')).toBeVisible();
  await expect(page.locator('#outcome-title')).toHaveText('The grid is yours.');
  await expect(page.locator('#outcome-stats')).toContainText('5/5');
  await page.goto('/');
  await expect(page.locator('.progress-label strong')).toHaveText('0 / 20');
  expect(errors).toEqual([]);
});

test('mobile cyberspace has movement controls, pause and a usable node terminal', async ({ page }) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/cyber.html');
  await page.getByLabel('Starting difficulty', { exact: true }).selectOption('easy');
  await page.screenshot({ path: '/tmp/nullrun-briefing-mobile.png' });
  await page.locator('[data-action=start]').click();
  await expect(page.getByRole('navigation', { name: 'Movement controls' })).toBeVisible();
  await page.locator('[data-action=pause]').click();
  const time = await page.locator('#game-clock').textContent();
  await page.waitForTimeout(200);
  await expect(page.locator('#game-clock')).toHaveText(time!);
  await page.getByLabel('Paused difficulty', { exact: true }).selectOption('moderate');
  await page.locator('[data-action=resume]').click();
  await page.locator('[data-action=waypoint]').click();
  await expect(page.locator('#interface-button')).toBeEnabled({ timeout: 20000 });
  await page.screenshot({ path: '/tmp/nullrun-world-mobile.png' });
  await page.locator('#interface-button').click();
  await page.locator('#cyber-command').fill('mission');
  await page.locator('#cyber-run').click();
  await expect(page.locator('.cyber-entry').last()).toContainText('controls/relay.cfg');
  await page.screenshot({ path: '/tmp/nullrun-console-mobile.png' });
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 400 }]) {
    await page.setViewportSize(viewport);
    const box = await page.locator('#cyber-command').boundingBox();
    expect(box!.y).toBeGreaterThan(0); expect(box!.y + box!.height).toBeLessThan(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#console')).toBeHidden();
  await page.reload();
  await expect(page.getByLabel('Starting difficulty', { exact: true })).toHaveValue('moderate');
});
