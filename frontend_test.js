import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');
  // Wait a bit for svelte to update DOM completely after reloading
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'frontend.png' });
  await browser.close();
})();
