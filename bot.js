'use strict';
/**
 * bot.js — LinkedIn Comment Bot
 *
 * Full pipeline:
 *   1.  Validate AI key
 *   2.  Prepare data files
 *   3.  Random "no-comment day" check (25% chance — looks human)
 *   4.  Launch browser & restore session
 *   5.  Find best post via composite scoring
 *   6.  Pick random comment style (style memory avoids repeats)
 *   7.  Generate comment + AI reasoning
 *   8.  Micro-behavior: proportional reading pause
 *   9.  Optional scroll-past behavior (20% of runs)
 *  10.  Post comment
 *  11.  Save to CSV
 *  12.  Browser stays open → user presses Enter to close
 */

require('dotenv').config();
const chalk    = require('chalk');
const readline = require('readline');
const path     = require('path');
const fs       = require('fs');

const { createSession }         = require('./src/browser/session');
const { findOneInterestingPost } = require('./src/linkedin/feed');
const { postComment }            = require('./src/linkedin/commenter');
const { generateComment }        = require('./src/ai/gemini');
const { pickRandomStyle, getStyleMemory } = require('./src/ai/commentStyles');
const {
  readCommentedPosts,
  writeCommentedPost,
  ensureDataFiles,
} = require('./src/data/csv');
const config = require('./src/config');

// ─────────────────────────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────────────────────────

const log     = (msg) => console.log(chalk.cyan('[BOT] ') + msg);
const success = (msg) => console.log(chalk.green('[✓] ') + msg);
const warn    = (msg) => console.log(chalk.yellow('[!] ') + msg);

function logStep(n, label) {
  console.log('');
  console.log(chalk.bold.blue(`── Step ${n}: ${label} ──`));
}

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.bold.yellow(prompt), () => { rl.close(); resolve(); });
  });
}

/** Human-like random delay */
function delay(min = config.bot.minDelay, max = config.bot.maxDelay) {
  const ms = min + Math.floor(Math.random() * (max - min));
  return new Promise((r) => setTimeout(r, ms));
}

/** Reading pause proportional to post word count */
function readingPause(postText) {
  const words = postText.split(/\s+/).length;
  // Average reading speed ~200wpm; posts are scanned not read deeply
  const seconds = Math.min(12, Math.max(4, words / 40));
  return new Promise((r) => setTimeout(r, Math.round(seconds * 1000)));
}

// ─────────────────────────────────────────────────────────────────
//  AUTHOR DEDUP — skip same author commented within 7 days
// ─────────────────────────────────────────────────────────────────

async function loadRecentAuthors() {
  try {
    const filePath = config.data.commentedPostsPath;
    if (!fs.existsSync(filePath)) return new Set();
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines   = content.trim().split('\n').slice(1); // skip header
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentAuthors = new Set();

    for (const line of lines) {
      const cols = line.split(',');
      const author    = (cols[1] || '').replace(/^"|"$/g, '').trim();
      const timestamp = (cols[3] || '').replace(/^"|"$/g, '').trim();
      if (!author || !timestamp) continue;
      if (new Date(timestamp).getTime() > sevenDaysAgo) {
        recentAuthors.add(author.toLowerCase());
      }
    }
    return recentAuthors;
  } catch { return new Set(); }
}

// ─────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log(chalk.bold.white('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.white('  🤖  LinkedIn Comment Bot  —  Powered by AI'));
  console.log(chalk.bold.white('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(`  Started: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} (PKT)`);
  console.log('');

  // ── Step 1: Validate AI API key ──────────────────────────────────
  logStep(1, 'Validating AI API key');
  const hasOpenAI = !!(config.openaiApiKey?.startsWith('sk-') && config.openaiApiKey.length > 20);
  const hasGemini = !!(config.geminiApiKey && config.geminiApiKey.length > 20);

  if (!hasOpenAI && !hasGemini) {
    warn('No valid AI key found. Set OPENAI_API_KEY or GEMINI_API_KEY in .env');
    process.exit(1);
  }
  if (hasOpenAI) success('AI provider: OpenAI (primary)');
  else           success('AI provider: Gemini');

  // ── Step 2: Prepare data files ───────────────────────────────────
  logStep(2, 'Preparing data files');
  ensureDataFiles();
  const commentedUrls   = await readCommentedPosts();
  const recentAuthors   = await loadRecentAuthors();
  success(`Loaded ${commentedUrls.size} previously commented post(s) for deduplication.`);
  success(`Loaded ${recentAuthors.size} recently contacted author(s) (7-day cooldown).`);

  // ── Step 3: Natural inactivity check ────────────────────────────
  logStep(3, 'Natural inactivity check');
  // 25% chance to skip for the day — humans don't comment every day
  if (Math.random() < 0.25) {
    log('Skipping this run — natural inactivity day. (25% chance)');
    log('Re-run to try again, or this is normal. Humans are inconsistent.');
    console.log('');
    process.exit(0);
  }
  success('Active today — proceeding.');

  // ── Step 4: Launch browser & restore session ─────────────────────
  logStep(4, 'Launching browser & restoring session');
  let browser, page;
  try {
    ({ browser, page } = await createSession());
  } catch (err) {
    warn(`Browser launch failed: ${err.message}`);
    process.exit(1);
  }

  try {
    // ── Step 5: Find best post ────────────────────────────────────
    logStep(5, 'Finding best post via composite scoring');
    log('Filters active:');
    log('  • Skip OTW / job-seeking authors');
    log('  • Skip students, interns, freshers');
    log('  • Skip job advertisement posts');
    log('  • Skip grief / tragedy posts (empathy should be human)');
    log('  • Skip authors commented on in the last 7 days');
    log('  • Composite rank: 40% content + 25% engagement + 15% seniority + 10% niche + 10% recency');

    const post = await findOneInterestingPost(page, commentedUrls, recentAuthors);

    if (!post) {
      warn('No suitable post found on the current feed.');
      warn('Tip: Scroll LinkedIn manually briefly, then re-run.');
      warn('Or: node debug-feed.js — to inspect the live DOM.');
      await waitForEnter('\nPress ENTER to close the browser and exit...\n');
      await browser.close();
      process.exit(0);
    }

    // ── Step 6: Pick comment style ────────────────────────────────
    logStep(6, 'Picking comment style');
    const style = pickRandomStyle();
    success(`Style: "${style.label}" (ID: ${style.id})`);
    log(`Style memory (last 3): ${getStyleMemory().join(' → ')}`);

    // ── Step 7: Generate comment + AI reasoning ───────────────────
    logStep(7, 'Generating comment with AI reasoning');
    await delay(2000, 4000);

    const result = await generateComment(post.postText, post.authorName, style);

    log(`AI interest score: ${result.interestScore}/100`);
    log(`Why interesting:   ${result.whyInteresting}`);
    log(`Best angle:        ${result.bestAngle}`);
    console.log('');
    console.log(chalk.bold.white('  Generated comment:'));
    console.log(chalk.italic(`  "${result.comment}"`));
    console.log('');

    if (!result.comment || result.comment.length < 10) {
      warn('AI returned an invalid comment. Exiting.');
      await waitForEnter('\nPress ENTER to close...\n');
      await browser.close();
      process.exit(1);
    }

    // ── Step 8: Reading pause (proportional to post length) ───────
    logStep(8, 'Simulating reading time');
    const words = post.postText.split(/\s+/).length;
    const pauseMs = Math.round(Math.min(12, Math.max(4, words / 40)) * 1000);
    log(`Post has ~${words} words — pausing ${(pauseMs / 1000).toFixed(1)}s (reading simulation)`);
    await page.goto(post.postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await readingPause(post.postText);

    // ── Step 9: Micro-behavior — scroll-past (20% of runs) ────────
    logStep(9, 'Micro-behavior check');
    if (Math.random() < 0.20) {
      log('Scroll-past behavior (20% run) — scrolling through post without commenting yet...');
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 400 + Math.random() * 300));
        await delay(800, 1800);
      }
      await delay(2000, 4000);
      log('Now going back to comment...');
    } else {
      success('No scroll-past this run.');
    }

    // ── Step 10: Post comment ──────────────────────────────────────
    logStep(10, 'Posting comment on LinkedIn');
    const posted = await postComment(page, post.postUrl, result.comment);

    if (!posted) {
      warn('Commenting failed — check the browser and try again.');
      await waitForEnter('\nPress ENTER to close the browser...\n');
      await browser.close();
      process.exit(1);
    }

    // ── Step 11: Save to CSV ──────────────────────────────────────
    logStep(11, 'Saving to CSV');
    await writeCommentedPost(post.postUrl, post.authorName, result.comment);
    success(`Saved: ${post.authorName} → ${post.postUrl}`);

    // ── Step 12: Done — wait for user ────────────────────────────
    logStep(12, 'Done');
    console.log('');
    success(`Comment posted as style: "${style.label}"`);
    success(`AI reasoning: ${result.whyInteresting}`);
    success(`Composite score: ${post.compositeScore}/100`);
    console.log('');
    log('The browser is still open. Browse LinkedIn freely.');
    console.log('');

    await waitForEnter('\nPress ENTER to close the browser and exit...\n');

    log('Closing browser...');
    await browser.close();
    log('Bye! 👋');
    console.log('');

  } catch (err) {
    console.error(chalk.red(`\n[ERROR] ${err.message}`));
    console.error(err.stack);
    try {
      await waitForEnter('\nPress ENTER to close the browser and exit...\n');
      await browser.close();
    } catch {}
    process.exit(1);
  }
}

main();
