import { test, expect } from '@playwright/test';
import { makeScenario } from '../../src/cyber/model.ts';
import type { Page, WebSocketRoute } from '@playwright/test';
async function lobby(page: Page, command: string) {
  await page.locator('#lobby-command').fill(command); await page.locator('#lobby-command').press('Enter');
}
async function ready(page: Page) { await page.goto('/multiplayer.html'); await expect(page.locator('#mp-network')).toHaveText('LINK ONLINE'); await expect(page.locator('#mp-you')).toContainText('/ YOU'); }
async function roomId(page: Page) { await expect(page.locator('#mp-waiting')).toBeVisible(); return (await page.locator('#mp-waiting').textContent())!.match(/ROOM (\d{4})/)![1]; }

test('multiplayer lobby chat, mobile layout and waiting-room cleanup', async ({ page, browser }) => {
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), guest = await guestContext.newPage();
  try {
    await ready(page); await ready(guest);
    await expect(page.locator('#mp-online-count')).toHaveText('2 ONLINE');
    await lobby(page, '/nick HostSmoke'); await lobby(guest, '/nick MobileSmoke');
    await expect(page.locator('#mp-you')).toHaveText('HostSmoke / YOU');
    await lobby(page, 'hello grid <img src=x onerror=alert(1)>');
    await expect(guest.locator('#lobby-output')).toContainText('hello grid <img src=x onerror=alert(1)>');
    await expect(guest.locator('#lobby-output img')).toHaveCount(0);
    await page.locator('#lobby-command').fill('/cr'); await page.locator('#lobby-command').press('Tab');
    await expect(page.locator('#lobby-command')).toHaveValue('/create');
    await lobby(page, '/create 4 easy'); const id = await roomId(page);
    await guest.locator('#lobby-command').fill('/join ' + id.slice(0, 2)); await guest.locator('#lobby-command').press('Tab');
    await expect(guest.locator('#lobby-command')).toHaveValue('/join ' + id);
    await lobby(guest, '/ls'); await expect(guest.locator('#lobby-output')).toContainText(`host:HostSmoke`);
    await lobby(guest, `/join ${id}`); await expect(page.locator('#mp-waiting')).toContainText('2 OF 4');
    await guest.screenshot({ path: '/tmp/nullrun-lobby-mobile.png', fullPage: true });
    for (const width of [320, 390, 768, 1440]) {
      await guest.setViewportSize({ width, height: 844 });
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.screenshot({ path: '/tmp/nullrun-lobby-desktop.png', fullPage: true });
    await page.reload(); await expect(page.locator('#mp-network')).toHaveText('LINK ONLINE');
    await expect(guest.locator('#mp-waiting')).toBeHidden(); await expect(guest.locator('#mp-rooms')).not.toContainText('#' + id);
    await expect(guest.locator('#lobby-output')).toContainText('REMOVED');
    await lobby(page, '/create'); await roomId(page); await lobby(page, '/leave'); await expect(page.locator('#mp-waiting')).toBeHidden();
  } finally { await guestContext.close(); }
});

test('two real browser clients race inward and results reach the lobby', async ({ page, browser }) => {
  test.setTimeout(120000);
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), guest = await guestContext.newPage();
  const observerContext = await browser.newContext(), observer = await observerContext.newPage();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); guest.on('pageerror', e => errors.push(e.message));
  try {
    await ready(page); await ready(guest); await ready(observer);
    await lobby(page, '/nick AlphaCore'); await lobby(guest, '/nick BetaCore');
    await lobby(page, '/create 2 easy'); const id = await roomId(page); await lobby(guest, `/join ${id}`);
    await expect(page.locator('#mp-race')).toBeVisible(); await expect(guest.locator('#mp-race')).toBeVisible();
    await expect(page.locator('#mp-world canvas')).toBeVisible(); await expect(guest.locator('#mp-world canvas')).toBeVisible();
    await expect(page.locator('#mp-countdown')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#mp-racers .racer-standing')).toHaveCount(2);
    const objectives = makeScenario(1).objectives;
    for (let i = 0; i < objectives.length; i++) {
      await page.locator('[data-action=waypoint]').click(); await expect(page.locator('#mp-interface')).toBeEnabled({ timeout: 15000 });
      await page.locator('#mp-interface').click(); await expect(page.locator('#mp-terminal')).toBeVisible();
      if (i === 0) {
        for (const [prefix, expected] of [['gr', 'grep'], ['grep --he', 'grep --help'], ['help pi', 'help pipes'], ['cat log', 'cat logs/'], ['grep ACTIVE logs/rou', 'grep ACTIVE logs/routes.log'], ['cat README.md | gr', 'cat README.md | grep']]) {
          await page.locator('#cyber-command').fill(prefix); await page.locator('#cyber-command').press('Tab');
          await expect(page.locator('#cyber-command')).toHaveValue(expected);
        }
        await page.locator('#cyber-command').fill('cat logs/'); await page.locator('#cyber-command').press('Tab');
        await expect(page.locator('#shell-completions')).toContainText('permissions.log');
        await page.locator('#cyber-command').fill('cd logs'); await page.locator('#cyber-command').press('Enter');
        await expect(page.locator('#cyber-run')).toBeEnabled(); await expect(page.locator('#mp-shell-cwd')).toContainText('/workspace/logs');
        await page.locator('#cyber-command').fill('cat ro'); await page.locator('[data-action=complete-shell]').click();
        await expect(page.locator('#cyber-command')).toHaveValue('cat routes.log');
        await page.locator('#cyber-command').fill('cd /workspace'); await page.locator('#cyber-command').press('Enter');
        await expect(page.locator('#cyber-run')).toBeEnabled();
        await page.locator('#cyber-command').fill('hint'); await page.locator('#cyber-run').click();
        await expect(page.locator('#mp-shell-output')).toContainText('HINT 1/3');
        await page.screenshot({ path: '/tmp/nullrun-versus-race.png' });
        await guest.screenshot({ path: '/tmp/nullrun-versus-mobile.png' });
      }
      await page.locator('#cyber-command').fill(objectives[i].solution); await page.locator('#cyber-command').press('Enter');
      await expect(page.locator('#cyber-run')).toBeEnabled();
      await expect(guest.locator('.racer-standing').filter({ hasText: 'AlphaCore' })).toContainText(`${i + 1}/5`);
      if (i < 4) {
        await expect(page.locator('#mp-shell-output')).toContainText(`LAYER ${i + 1}/5 LIBERATED`);
        await page.locator('#cyber-command').fill('next-node'); await page.locator('#cyber-command').press('Enter');
        await expect(page.locator('#mp-terminal')).toBeHidden();
      }
    }
    await expect(page.locator('#mp-results')).toBeVisible(); await expect(guest.locator('#mp-results')).toBeVisible();
    await expect(page.locator('#mp-result-title')).toHaveText('You broke the system first.');
    await expect(guest.locator('#mp-result-title')).toHaveText('AlphaCore reached the core.');
    await expect(observer.locator('#lobby-output')).toContainText(`ROOM ${id} RESULT — AlphaCore`);
    await page.locator('[data-action=return-lobby]').click(); await expect(page.locator('#mp-lobby')).toBeVisible();
    await expect(page.locator('#lobby-output')).toContainText(`ROOM ${id} RESULT`);
    expect(errors).toEqual([]);
  } finally { await guestContext.close(); await observerContext.close(); }
});

test('local movement responds while authoritative snapshots are withheld', async ({ page, browser }) => {
  const guestContext = await browser.newContext(), guest = await guestContext.newPage();
  let hold = false, route: WebSocketRoute | undefined;
  const queued: (string | Buffer)[] = [];
  const release = () => { hold = false; for (const message of queued.splice(0)) route?.send(message); };
  await page.routeWebSocket('**/ws', socket => {
    route = socket;
    socket.connectToServer().onMessage(message => {
      if (hold && JSON.parse(message.toString()).type === 'race') queued.push(message);
      else socket.send(message);
    });
  });
  try {
    await ready(page); await ready(guest);
    await lobby(page, '/create 2 easy'); const id = await roomId(page); await lobby(guest, `/join ${id}`);
    await expect(page.locator('#mp-race')).toBeVisible();
    await expect(page.locator('#mp-countdown')).toBeHidden({ timeout: 10000 });
    await page.bringToFront(); await page.locator('#mp-world canvas').focus();
    await expect(page.locator('#mp-distance')).toHaveText('7m TO YOUR NODE · 0/5 LAYERS');
    hold = true;
    await page.keyboard.down('w');
    // No received position updates can account for this change. It must be local prediction.
    await expect(page.locator('#mp-distance')).toHaveText(/^[0-6]m TO YOUR NODE · 0\/5 LAYERS$/, { timeout: 450 });
    await page.keyboard.up('w');
    expect(queued.length).toBeGreaterThan(0);
    release();
    await expect(page.locator('#mp-network')).toHaveText('LINK ONLINE');
  } finally { release(); await page.keyboard.up('w'); await guestContext.close(); }
});
