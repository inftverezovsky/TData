const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://82.147.67.245:3010';
const OUT = process.env.OUT_DIR || '/tmp/liquipedia-playwright-audit';
fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });

const routes = [
  '/',
  '/admin',
  '/manual-import',
  '/settings',
  '/history',
  '/tbvolley',
  '/tbvolley/beachvolleyru',
  '/tbvolley/germanbeachtour',
  '/tbvolley/volleyballworld',
  '/api/health',
  '/api/valorant/vlr/health',
];

function safeName(route) {
  return route.replace(/^\//, 'root').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'root';
}

async function summarizePage(page) {
  return await page.evaluate(() => {
    const visibleText = document.body?.innerText || '';
    const buttons = Array.from(document.querySelectorAll('button')).slice(0, 50).map((el) => ({ text: el.innerText.trim(), disabled: el.disabled, type: el.type, aria: el.getAttribute('aria-label') }));
    const links = Array.from(document.querySelectorAll('a')).slice(0, 80).map((el) => ({ text: el.innerText.trim(), href: el.href }));
    const inputs = Array.from(document.querySelectorAll('input, textarea, select')).slice(0, 80).map((el) => ({ tag: el.tagName, type: el.getAttribute('type'), name: el.getAttribute('name'), placeholder: el.getAttribute('placeholder'), value: el.value, aria: el.getAttribute('aria-label') }));
    const h1 = Array.from(document.querySelectorAll('h1')).map((el) => el.innerText.trim());
    const h2 = Array.from(document.querySelectorAll('h2')).map((el) => el.innerText.trim()).slice(0, 20);
    return { title: document.title, h1, h2, textStart: visibleText.slice(0, 1800), buttons, links, inputs, bodyLen: visibleText.length };
  });
}

async function auditRoute(browser, route) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const responses = [];
  page.on('console', (msg) => consoleMessages.push({ type: msg.type(), text: msg.text().slice(0, 1000) }));
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 1000)));
  page.on('requestfailed', (req) => failedRequests.push({ url: req.url(), method: req.method(), failure: req.failure()?.errorText || '' }));
  page.on('response', (res) => {
    const status = res.status();
    if (status >= 400) responses.push({ url: res.url(), status });
  });
  const url = BASE + route;
  const started = Date.now();
  let result = { route, url };
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (_) {}
    const elapsedMs = Date.now() - started;
    const screenshot = path.join(OUT, 'screenshots', `${safeName(route)}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    const summary = route.startsWith('/api/') ? { body: (await page.textContent('body')).slice(0, 2000) } : await summarizePage(page);
    result = { ...result, status: resp?.status(), ok: !!resp?.ok(), elapsedMs, screenshot, summary, consoleMessages, pageErrors, failedRequests, badResponses: responses };
  } catch (e) {
    result = { ...result, error: String(e), consoleMessages, pageErrors, failedRequests, badResponses: responses };
  }
  await context.close();
  return result;
}

async function interactionAudit(browser) {
  const findings = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const logs = [];
  const errors = [];
  page.on('console', (msg) => logs.push({ type: msg.type(), text: msg.text().slice(0, 1000) }));
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 1000)));

  async function goto(route) {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
    try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (_) {}
  }

  // Manual import basic empty-state/form behavior.
  try {
    await goto('/manual-import');
    const before = await summarizePage(page);
    const shotBefore = path.join(OUT, 'screenshots', 'interaction_manual_import_initial.png');
    await page.screenshot({ path: shotBefore, fullPage: true });
    const buttons = await page.locator('button').allTextContents();
    const inputs = await page.locator('input,textarea,select').count();
    findings.push({ area: 'manual-import', type: 'recon', buttons, inputs, h1: before.h1, screenshot: shotBefore });
    const importButton = page.getByRole('button', { name: /import|импорт|parse|парс|search|найти/i }).first();
    if (await importButton.count()) {
      await importButton.click({ timeout: 5000 }).catch((e) => findings.push({ area: 'manual-import', type: 'click-error', message: String(e) }));
      await page.waitForTimeout(1500);
      const shotAfter = path.join(OUT, 'screenshots', 'interaction_manual_import_empty_submit.png');
      await page.screenshot({ path: shotAfter, fullPage: true });
      findings.push({ area: 'manual-import', type: 'empty-submit', text: (await page.locator('body').innerText()).slice(0, 2500), screenshot: shotAfter });
    }
  } catch (e) {
    findings.push({ area: 'manual-import', type: 'error', message: String(e) });
  }

  // Navigation link integrity from homepage.
  try {
    await goto('/');
    const linkData = await page.evaluate(() => Array.from(document.querySelectorAll('a')).map(a => ({ text: a.innerText.trim(), href: a.href })).filter(x => x.href.startsWith(location.origin)).slice(0, 30));
    for (const link of linkData.slice(0, 12)) {
      const resp = await page.request.get(link.href, { timeout: 20000 }).catch(e => ({ error: String(e), status: () => 0 }));
      const status = typeof resp.status === 'function' ? resp.status() : 0;
      if (status >= 400 || status === 0) findings.push({ area: 'navigation', type: 'bad-link', link, status, error: resp.error });
    }
  } catch (e) {
    findings.push({ area: 'navigation', type: 'error', message: String(e) });
  }

  await context.close();
  return { findings, logs, errors };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const route of routes) results.push(await auditRoute(browser, route));
  const interactions = await interactionAudit(browser);
  await browser.close();
  const report = { base: BASE, at: new Date().toISOString(), results, interactions };
  fs.writeFileSync(path.join(OUT, 'raw-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: OUT, routes: results.length, errors: results.filter(r => r.error || !r.ok).length, consoleIssues: results.reduce((n,r)=>n+(r.consoleMessages||[]).filter(m=>['error','warning'].includes(m.type)).length,0), interactionFindings: interactions.findings.length }, null, 2));
})();
