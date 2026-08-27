import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Create a mock user in the database and get their session cookie
  // Since we don't have access to the actual DB easily from Playwright, we can mock the fetch calls or use API keys if supported

  const page = await context.newPage();

  // Mock API responses to bypass login
  await page.route('/api/user', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, username: 'testuser', plan_type: 'pro' })
    });
  });

  await page.route('/api/tasks', route => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 1, title: 'Test Task 1', completed: false, due_date: null, predecessors: [], assignees: [], _level: 0 }
        ])
      });
    } else {
      route.continue();
    }
  });

  await page.route('/api/topics', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  await page.route('/api/users', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  await page.goto('http://localhost:3000');

  // Wait for the task to be rendered
  await page.waitForSelector('.task-title', { text: 'Test Task 1' });

  // Click on the task to open edit modal
  await page.click('.task-content');

  // Wait for the modal to open
  await page.waitForSelector('.modal h2', { text: 'Edit Task' });

  // Take screenshot of the edit modal
  await page.screenshot({ path: 'frontend_edit_modal.png' });

  // Mock delete endpoint
  await page.route('**/api/tasks/1', route => {
    if (route.request().method() === 'DELETE') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      });
    } else {
      route.continue();
    }
  });

  // Handle confirm dialog
  page.on('dialog', async dialog => {
    console.log(`Dialog message: ${dialog.message()}`);
    await dialog.accept();
  });

  // Click delete button
  await page.click('button:has-text("Delete Task")');

  // Wait for modal to close
  await page.waitForTimeout(1000);

  await browser.close();
  console.log("Test finished successfully.");
})();
