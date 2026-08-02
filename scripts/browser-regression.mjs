import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const port = 4321;
const baseUrl = process.env.BASE_URL ?? `http://127.0.0.1:${port}/agent-prompt-patterns/`;
const server = process.env.BASE_URL
  ? null
  : spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port)], {
      detached: true,
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

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
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

  const search = page.getByRole('searchbox', { name: 'Search patterns by title, summary, or tags' });
  await search.fill('memory');
  const searchCards = await page.locator('.pattern-card:visible').count();
  if (searchCards === 0 || searchCards >= totalCards) {
    throw new Error(`Search should show a strict non-empty subset, found ${searchCards}`);
  }

  await search.fill('');
  await page.getByRole('button', { name: 'Prompt Structure' }).click();
  const categoryCards = await page.locator('.pattern-card:visible').count();
  if (categoryCards === 0 || categoryCards >= totalCards) {
    throw new Error(`Category should show a strict non-empty subset, found ${categoryCards}`);
  }
  if (!(await page.getByRole('button', { name: 'Prompt Structure' }).evaluate(button => button.classList.contains('active')))) {
    throw new Error('Prompt Structure button did not become active');
  }

  await search.fill('memory');
  const composedCards = await page.locator('.pattern-card:visible').count();
  const expectedComposedCards = await page.locator('.pattern-card').evaluateAll(cards => cards.filter(card => {
    const text = `${card.getAttribute('data-title') ?? ''} ${card.querySelector('.summary')?.textContent ?? ''} ${card.getAttribute('data-tags') ?? ''}`.toLowerCase();
    return card.getAttribute('data-category') === 'prompt-structure' && text.includes('memory');
  }).length);
  if (composedCards !== expectedComposedCards) {
    throw new Error(`Composed filters mismatch: ${composedCards} !== ${expectedComposedCards}`);
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

  const firstCard = page.locator('.pattern-card').first();
  const lastCard = page.locator('.pattern-card').last();
  const firstCardId = await firstCard.getAttribute('data-pattern-id');
  const lastCardId = await lastCard.getAttribute('data-pattern-id');
  const firstCardSeedNet = Number(await firstCard.locator('.score-num').getAttribute('data-vote-net'));
  await page.evaluate(({ firstCardId, lastCardId }) => {
    localStorage.setItem('app_votes', JSON.stringify({
      [firstCardId]: { up: 2, down: 0 },
      [lastCardId]: { up: 1000, down: 0 },
    }));
  }, { firstCardId, lastCardId });
  await page.reload({ waitUntil: 'networkidle' });
  const mergedNet = Number(await page.locator('.pattern-card').first().locator('.score-num').textContent());
  if (mergedNet !== firstCardSeedNet + 2) {
    throw new Error(`Local vote merge ran an unexpected number of times: ${mergedNet} !== ${firstCardSeedNet + 2}`);
  }
  if (await page.locator('#leaderboard-list .leaderboard-item').first().getAttribute('data-pattern-id') !== lastCardId) {
    throw new Error('Leaderboard did not sort by merged local votes');
  }

  if (consoleErrors.length || resourceErrors.length) {
    throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors, resourceErrors })}`);
  }
  console.log('Browser regression passed: fresh load, search, category composition, and leaderboard toggle.');
} finally {
  await browser?.close();
  if (server?.pid) process.kill(-server.pid);
}
