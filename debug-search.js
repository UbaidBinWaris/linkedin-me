'use strict';
/**
 * debug-search.js — Inspect LinkedIn People Search DOM via Playwright session
 * Run: node debug-search.js
 * This script opens the search page and prints every candidate selector result
 * so we can find the correct class names for the current LinkedIn UI.
 */

require('dotenv').config();
const { createSession } = require('./src/browser/session');
const cfg = require('./connection-config');

async function main() {
  console.log('\n🔍 LinkedIn Search DOM Inspector\n');

  const { browser, page } = await createSession();

  try {
    console.log('Navigating to search URL...');
    await page.goto(cfg.searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000)); // wait for JS to render

    console.log('\n── Current URL:', page.url());

    // ─── Step 1: Try all known card selectors ─────────────────────────
    console.log('\n── [1] Trying all card container selectors:\n');
    const selectorResults = await page.evaluate(() => {
      const selectors = [
        'li.reusable-search__result-container',
        'li[class*="search-result"]',
        'li[class*="entity-result"]',
        'div[class*="entity-result"]',
        '[data-chameleon-result-urn]',
        '[data-view-name="search-entity-result-universal-template"]',
        'ul.reusable-search__entity-result-list > li',
        'div.search-results-container li',
        'main ul > li',
        'div[class*="search-results"] li',
        '.scaffold-layout__list-container li',
        'ul li[class]',
      ];
      return selectors.map(s => ({
        selector: s,
        count: document.querySelectorAll(s).length,
      }));
    });

    for (const { selector, count } of selectorResults) {
      const mark = count > 0 ? '✅' : '❌';
      console.log(`  ${mark}  "${selector}": ${count}`);
    }

    // ─── Step 2: Print class names of <li> elements in main ───────────
    console.log('\n── [2] Class names of first 10 <li> elements in <main>:\n');
    const liClasses = await page.evaluate(() => {
      const lis = Array.from(document.querySelectorAll('main li')).slice(0, 10);
      return lis.map((li, i) => ({
        index: i,
        classes: li.className.substring(0, 300),
        childCount: li.children.length,
        hasLink: !!li.querySelector('a[href*="/in/"]'),
        innerSnippet: li.innerText.substring(0, 80).replace(/\n/g, ' '),
      }));
    });

    for (const item of liClasses) {
      console.log(`  li[${item.index}]: hasLink=${item.hasLink} children=${item.childCount}`);
      console.log(`    classes: "${item.classes}"`);
      console.log(`    text: "${item.innerSnippet}"\n`);
    }

    // ─── Step 3: Find elements with profile /in/ links ────────────────
    console.log('\n── [3] Elements that contain a /in/ profile link:\n');
    const profileCards = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/in/"]')).slice(0, 5);
      return links.map(link => {
        const card = link.closest('li') || link.closest('div[class]') || link.parentElement;
        const name = card?.querySelector('span[aria-hidden="true"]')?.textContent?.trim() || '';
        const allSpans = Array.from(card?.querySelectorAll('span') || [])
          .map(s => s.textContent.trim())
          .filter(t => t.length > 2 && t.length < 100)
          .slice(0, 6);
        return {
          href: link.href.split('?')[0].substring(0, 80),
          closestTag: card?.tagName,
          closestClasses: (card?.className || '').substring(0, 200),
          nameFromSpanAriaHidden: name,
          firstSpans: allSpans,
        };
      });
    });

    for (const card of profileCards) {
      console.log(`  URL  : ${card.href}`);
      console.log(`  Tag  : ${card.closestTag}`);
      console.log(`  Class: ${card.closestClasses.substring(0, 120)}`);
      console.log(`  Name : "${card.nameFromSpanAriaHidden}"`);
      console.log(`  Spans: ${JSON.stringify(card.firstSpans)}\n`);
    }

    // ─── Step 4: Dump page title + any "no results" indicators ────────
    console.log('\n── [4] Page info:\n');
    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      bodyText: document.body?.innerText?.substring(0, 300) || '',
      resultsText: (document.querySelector('[class*="search-results-count"]') ||
                    document.querySelector('[class*="results-context"]'))
                    ?.textContent?.trim() || '(count element not found)',
    }));
    console.log('  Title:', pageInfo.title);
    console.log('  Results badge:', pageInfo.resultsText);
    console.log('  Body snippet:', pageInfo.bodyText.replace(/\n/g, ' '));

  } finally {
    console.log('\n\nPress Ctrl+C or close the terminal to exit.');
    await new Promise(r => setTimeout(r, 300000)); // keep open 5 min
  }
}

main().catch(e => { console.error(e); process.exit(1); });
