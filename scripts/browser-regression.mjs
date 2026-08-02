import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const port = 4321;
const baseUrl = process.env.BASE_URL ?? `http://127.0.0.1:${port}/agent-prompt-patterns/`;
const server = process.env.BASE_URL
  ? null
  : spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port)], {
      stdio: 'ignore',
    });

async function waitForServer() {
  if (!server) return;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The preview server may need a few seconds to start.
    }
    await delay(250);
  }
  throw new Error(`Preview server did not become ready at ${baseUrl}`);
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  const resourceErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    resourceErrors.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const totalCards = await page.locator('.pattern-card').count();
  if (totalCards !== 90) throw new Error(`Expected 90 cards, found ${totalCards}`);

  await page.getByRole('searchbox', { name: 'Search patterns by title, summary, or tags' }).fill('memory');
  const searchCards = await page.locator('.pattern-card:visible').count();
  if (searchCards === 0 || searchCards >= totalCards) {
    throw new Error(`Search should show a strict non-empty subset, found ${searchCards}`);
  }

  await page.getByRole('button', { name: 'Prompt Structure' }).click();
  const categoryCards = await page.locator('.pattern-card:visible').count();
  if (categoryCards === 0 || categoryCards >= totalCards) {
    throw new Error(`Category should show a strict non-empty subset, found ${categoryCards}`);
  }
  if (!(await page.getByRole('button', { name: 'Prompt Structure' }).evaluate(button => button.classList.contains('active')))) {
    throw new Error('Prompt Structure button did not become active');
  }

  await page.getByRole('searchbox', { name: 'Search patterns by title, summary, or tags' }).fill('');
  const composedCards = await page.locator('.pattern-card:visible').count();
  if (composedCards !== categoryCards) {
    throw new Error(`Clearing search should preserve category filter: ${composedCards} !== ${categoryCards}`);
  }

  const leaderboard = page.locator('#leaderboard-list');
  await page.getByRole('button', { name: 'hide' }).click();
  if (await leaderboard.evaluate(element => getComputedStyle(element).display !== 'none')) {
    throw new Error('Leaderboard did not hide');
  }
  await page.getByRole('button', { name: 'show' }).click();
  if (await leaderboard.evaluate(element => getComputedStyle(element).display === 'none')) {
    throw new Error('Leaderboard did not show');
  }

  if (consoleErrors.length || resourceErrors.length) {
    throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors, resourceErrors })}`);
  }
  await browser.close();
  console.log('Browser regression passed: fresh load, search, category composition, and leaderboard toggle.');
} finally {
  server?.kill();
}
