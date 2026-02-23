'use strict';

/**
 * ─────────────────────────────────────────────────────────
 *  LinkedIn Comment Bot — Main Orchestrator
 *  Usage: node bot.js
 * ─────────────────────────────────────────────────────────
 *
 * Flow:
 *  1. Load session (or login if no valid session)
 *  2. Read target profiles from data/target_profiles.csv
 *  3. Scrape recent posts from each profile
 *  4. Filter out already-commented posts (from data/commented_posts.csv)
 *  5. Generate a Gemini AI comment for each new post
 *  6. Post the comment on LinkedIn
 *  7. Record to CSV to avoid future duplicates
 *  8. Respect MAX_COMMENTS_PER_RUN limit
 */

require('dotenv').config();

const chalk = require('chalk');
const config = require('./src/config');
const { createSession, closeSession, randomDelay } = require('./src/browser/session');
const { scrapeProfilePosts, scrapeFeedPosts } = require('./src/linkedin/feed');
const { postComment } = require('./src/linkedin/commenter');
const { generateComment } = require('./src/ai/gemini');
const {
  ensureDataFiles,
  readCommentedPosts,
  writeCommentedPost,
  readTargetProfiles,
} = require('./src/data/csv');

// ──────────────── Helpers ────────────────

function log(msg) {
  console.log(chalk.cyan('[BOT]'), msg);
}

function logSuccess(msg) {
  console.log(chalk.green('[✓]'), msg);
}

function logWarn(msg) {
  console.log(chalk.yellow('[!]'), msg);
}

function logError(msg) {
  console.log(chalk.red('[✗]'), msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ──────────────── Main ────────────────

async function main() {
  console.log('');
  console.log(chalk.bold.blue('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.blue('  🤖 LinkedIn Comment Bot — Powered by Gemini'));
  console.log(chalk.bold.blue('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('');

  // ── Validate Gemini API Key ──
  if (!config.geminiApiKey || config.geminiApiKey === 'your_gemini_api_key_here') {
    logError('GEMINI_API_KEY is not set! Please add it to your .env file.');
    process.exit(1);
  }

  // ── Ensure data files exist ──
  ensureDataFiles();

  // ── Load already-commented posts ──
  log('Loading already-commented posts from CSV...');
  const commentedPosts = await readCommentedPosts();
  log(`Found ${commentedPosts.size} previously commented post(s).`);

  // ── Load target profiles ──
  log('Loading target profiles...');
  const targetProfiles = await readTargetProfiles();

  let allPosts = [];

  // ── Launch browser with session ──
  log('Launching browser...');
  let browser, page;
  try {
    ({ browser, page } = await createSession());
  } catch (err) {
    logError(`Failed to create session: ${err.message}`);
    process.exit(1);
  }

  try {
    if (targetProfiles.length === 0) {
      // No target profiles → scrape the home feed
      logWarn('No target profiles found in data/target_profiles.csv.');
      log('Falling back to home feed scraping...');
      const feedPosts = await scrapeFeedPosts(page);
      allPosts = allPosts.concat(feedPosts);
    } else {
      // Scrape each target profile
      log(`Scraping ${targetProfiles.length} target profile(s)...`);
      for (const profile of targetProfiles) {
        const posts = await scrapeProfilePosts(page, profile.profileUrl, profile.name);
        allPosts = allPosts.concat(posts);
        await sleep(randomDelay());
      }
    }

    log(`Total posts found: ${allPosts.length}`);

    // ── Filter out already-commented posts ──
    const newPosts = allPosts.filter((p) => p.postUrl && !commentedPosts.has(p.postUrl));
    log(`New posts to comment on: ${newPosts.length}`);

    if (newPosts.length === 0) {
      logSuccess('No new posts to comment on. All posts have already been commented!');
      return;
    }

    // ── Process posts up to the max limit ──
    const limit = config.bot.maxCommentsPerRun;
    let commentCount = 0;

    for (const post of newPosts) {
      if (commentCount >= limit) {
        log(`Reached max comments per run (${limit}). Stopping.`);
        break;
      }

      console.log('');
      log(`Processing post by: ${chalk.bold(post.authorName)}`);
      log(`URL: ${chalk.underline(post.postUrl)}`);
      log(`Preview: "${post.postText.slice(0, 120).replace(/\n/g, ' ')}..."`);

      // ── Generate comment ──
      let comment;
      try {
        log('Generating comment with Gemini AI...');
        comment = await generateComment(post.postText, post.authorName);
        log(`Comment: "${chalk.italic(comment)}"`);
      } catch (err) {
        logError(`Gemini failed: ${err.message}`);
        await sleep(2000);
        continue;
      }

      // ── Post the comment ──
      log('Posting comment to LinkedIn...');
      const success = await postComment(page, post.postUrl, comment);

      if (success) {
        logSuccess(`Comment posted on post by ${post.authorName}!`);
        // Record to CSV
        await writeCommentedPost(post.postUrl, post.authorName, comment);
        commentedPosts.add(post.postUrl); // Update in-memory set
        commentCount++;
      } else {
        logWarn(`Failed to comment on post by ${post.authorName}. Skipping.`);
      }

      // ── Human-like delay between comments ──
      if (commentCount < limit) {
        const delay = randomDelay();
        log(`Waiting ${(delay / 1000).toFixed(1)}s before next comment...`);
        await sleep(delay);
      }
    }

    console.log('');
    console.log(chalk.bold.green('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    logSuccess(`Run complete! Posted ${commentCount} comment(s) this session.`);
    console.log(chalk.bold.green('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log('');
  } catch (err) {
    logError(`Unexpected error: ${err.message}`);
    console.error(err);
  } finally {
    log('Closing browser...');
    await closeSession(browser);
  }
}

// ── Run ──
main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
