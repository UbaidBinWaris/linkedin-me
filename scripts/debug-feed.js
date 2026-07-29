'use strict';
/**
 * debug-feed.js — Diagnostic tool  (updated 2025)
 * Run: node debug-feed.js
 *
 * Dumps:
 *  • Which element is the real scroll container (highest scrollHeight)
 *  • scrollY / scrollTop BEFORE and AFTER scroll to confirm movement
 *  • All [componentkey*="FeedType_"] elements with decoded activity IDs
 *  • Interesting <a href> patterns (post URLs)
 *  • First 5 post authors + post text previews
 */
require('dotenv').config();
const { createSession } = require('./src/browser/session');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── minimal copy of the varint decoder so we can decode here without importing ──
function decodeUrnBase64(b64url) {
  // Normalise base64url → base64
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { return null; }

  const MIN = 6_000_000_000_000_000_000n;
  const MAX = 9_999_999_999_999_999_999n;

  // 1. Varint scan – offsets 0-11
  for (let start = 0; start < Math.min(buf.length, 12); start++) {
    let val = 0n, shift = 0n;
    let i = start;
    while (i < buf.length) {
      const b = BigInt(buf[i++]);
      val |= (b & 0x7fn) << shift;
      if (!(b & 0x80n)) break;
      shift += 7n;
      if (shift > 70n) break;
    }
    if (val >= MIN && val <= MAX) return val.toString();
  }

  // 2. Fixed-int64 window scan (LE then BE)
  for (let o = 0; o + 8 <= buf.length; o++) {
    const le = buf.readBigUInt64LE(o);
    if (le >= MIN && le <= MAX) return le.toString();
    const be = buf.readBigUInt64BE(o);
    if (be >= MIN && be <= MAX) return be.toString();
  }

  return null;
}

async function debug() {
  console.log('Opening browser...');
  const { browser, page } = await createSession();

  // ── 1. Full scroll container audit (computed overflow) ───────────────────
  console.log('\n── Scroll container audit (BEFORE scroll) ────────────────────');
  const before = await page.evaluate(() => {
    const selectors = [
      '.scaffold-layout__main',
      'div[class*="scaffold-finite-scroll"]',
      'div[class*="feed-container"]',
      'div[class*="artdeco-card"]',
      'main',
      'body',
    ];
    const results = selectors.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, missing: true };
      const style = window.getComputedStyle(el);
      return {
        sel,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollTop: el.scrollTop,
        overflowY: style.overflowY,
        overflow: style.overflow,
      };
    });

    // Generic scan: find actual scrollable element
    let genericBest = null;
    let genericBestDiff = 200;
    document.querySelectorAll('div, main, section').forEach((el) => {
      const diff = el.scrollHeight - el.clientHeight;
      if (diff <= genericBestDiff) return;
      const oy = window.getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') {
        genericBest = {
          tag: el.tagName,
          className: el.className.slice(0, 80),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollTop: el.scrollTop,
          overflowY: oy,
        };
        genericBestDiff = diff;
      }
    });

    return {
      windowScrollY: window.scrollY,
      bodyScrollHeight: document.body.scrollHeight,
      containers: results,
      actualScrollable: genericBest,
    };
  });

  console.log('  window.scrollY:', before.windowScrollY);
  console.log('  body.scrollHeight:', before.bodyScrollHeight);
  before.containers.forEach((c) => {
    if (c.missing) { console.log(`  [MISSING] ${c.sel}`); return; }
    const scrollable = c.overflowY === 'auto' || c.overflowY === 'scroll' ? ' ← SCROLLABLE' : '';
    console.log(`  ${c.sel}  scrollH=${c.scrollHeight}  clientH=${c.clientHeight}  scrollTop=${c.scrollTop}  overflowY=${c.overflowY}${scrollable}`);
  });
  if (before.actualScrollable) {
    const a = before.actualScrollable;
    console.log(`\n  ★ Best generic scrollable: <${a.tag} class="${a.className}">`);
    console.log(`    scrollHeight=${a.scrollHeight}  clientHeight=${a.clientHeight}  overflowY=${a.overflowY}`);
  } else {
    console.log('\n  ★ No generic scrollable found — window.scrollBy is the only option');
  }

  // ── 2. Scroll the page using computed-overflow detection ───────────────────
  console.log('\nScrolling feed (8 passes, using computed-overflow container)...');
  try { await page.click('body', { force: true }); } catch (_) {}
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      let container = null;
      let bestDiff = 200;
      document.querySelectorAll('div, main, section').forEach((el) => {
        const diff = el.scrollHeight - el.clientHeight;
        if (diff <= bestDiff) return;
        const oy = window.getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') { container = el; bestDiff = diff; }
      });
      if (container) container.scrollBy(0, 700);
      else window.scrollBy(0, 700);
    });
    if (i % 3 === 2) { try { await page.keyboard.press('End'); } catch (_) {} }
    await sleep(900);
  }
  await page.evaluate(() => {
    let container = null;
    let bestDiff = 200;
    document.querySelectorAll('div, main, section').forEach((el) => {
      const diff = el.scrollHeight - el.clientHeight;
      if (diff <= bestDiff) return;
      const oy = window.getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') { container = el; bestDiff = diff; }
    });
    if (container) container.scrollTop = container.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  });
  await sleep(1800);

  // ── 3. Scroll container diagnostics AFTER scroll ───────────────────────────
  console.log('\n── Scroll container audit (AFTER scroll) ─────────────────────');
  const after = await page.evaluate(() => {
    const selectors = [
      '.scaffold-layout__main',
      'div[class*="scaffold-finite-scroll"]',
      'div[class*="feed-container"]',
      'div[class*="artdeco-card"]',
      'main',
      'body',
    ];
    const results = selectors.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, missing: true };
      const style = window.getComputedStyle(el);
      return { sel, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop, overflowY: style.overflowY };
    });
    let genericBest = null;
    let genericBestDiff = 200;
    document.querySelectorAll('div, main, section').forEach((el) => {
      const diff = el.scrollHeight - el.clientHeight;
      if (diff <= genericBestDiff) return;
      const oy = window.getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') {
        genericBest = { tag: el.tagName, className: el.className.slice(0, 80), scrollTop: el.scrollTop, scrollHeight: el.scrollHeight };
        genericBestDiff = diff;
      }
    });
    return { windowScrollY: window.scrollY, bodyScrollHeight: document.body.scrollHeight, containers: results, actualScrollable: genericBest };
  });
  console.log('  window.scrollY:', after.windowScrollY, `  (delta: ${after.windowScrollY - before.windowScrollY})`);
  after.containers.forEach((c) => {
    if (c.missing) return;
    const prev = before.containers.find(b => b.sel === c.sel);
    const delta = c.scrollTop - (prev?.scrollTop || 0);
    if (!c.missing) console.log(`  ${c.sel}  scrollTop=${c.scrollTop}  (delta: ${delta})  overflowY=${c.overflowY}`);
  });
  if (after.actualScrollable) {
    const a = after.actualScrollable;
    const prevScrollTop = before.actualScrollable?.scrollTop || 0;
    console.log(`\n  ★ Actual scrollable after scroll: <${a.tag} class="${a.className}">`);
    console.log(`    scrollTop=${a.scrollTop}  (delta: ${a.scrollTop - prevScrollTop})  scrollHeight=${a.scrollHeight}`);
  }

  // ── 4. componentkey FeedType elements ──────────────────────────────────────
  console.log('\n── [componentkey*="FeedType_"] elements ─────────────────────');
  const ckData = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[role="listitem"][componentkey*="FeedType_"]')];
    return els.map((el) => {
      const ck = el.getAttribute('componentkey') || '';
      const match = ck.match(/expanded([A-Za-z0-9+/=_-]+)FeedType_/);
      const b64 = match ? match[1] : null;
      return { componentkey: ck.slice(0, 120), b64, innerTextSnippet: el.innerText.slice(0, 80) };
    });
  });
  console.log(`  Found: ${ckData.length} elements`);
  ckData.forEach((item, idx) => {
    const id = item.b64 ? decodeUrnBase64(item.b64) : '(no b64)';
    console.log(`  [${idx}] id=${id}`);
    console.log(`       key=${item.componentkey}`);
    console.log(`       text="${item.innerTextSnippet}"`);
  });

  // ── 5. Post <a href> patterns ───────────────────────────────────────────────
  console.log('\n── Interesting href patterns ────────────────────────────────');
  const { hrefSamples, totalLinks } = await page.evaluate(() => {
    const hrefs = new Set();
    document.querySelectorAll('a[href]').forEach((a) => {
      const h = (a.getAttribute('href') || '').split('?')[0];
      if (h.includes('/feed/update/') || h.includes('/posts/') || h.includes('ugcPost') || h.includes('activity'))
        hrefs.add(h.slice(0, 140));
    });
    return { hrefSamples: [...hrefs].slice(0, 20), totalLinks: document.querySelectorAll('a[href]').length };
  });
  console.log(`  Total <a> tags: ${totalLinks}`);
  hrefSamples.forEach((h) => console.log(' ', h));

  // ── 6. data-urn & data-id ───────────────────────────────────────────────────
  console.log('\n── data-urn / data-id values ────────────────────────────────');
  const urnSamples = await page.evaluate(() => {
    const out = new Set();
    document.querySelectorAll('[data-urn],[data-id]').forEach((el) => {
      const v = el.getAttribute('data-urn') || el.getAttribute('data-id');
      if (v && v.includes('activity')) out.add(v);
    });
    return [...out].slice(0, 15);
  });
  urnSamples.forEach((u) => console.log(' ', u));

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('Done. Browser stays open — press Ctrl+C to exit.');
  await new Promise(() => {});
}

debug().catch(console.error);
