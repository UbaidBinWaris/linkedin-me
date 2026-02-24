'use strict';

/**
 * ─────────────────────────────────────────────────────────────────
 *  LinkedIn Comment Bot — Main Orchestrator
 *  Run manually: node bot.js
 *
 *  Flow:
 *   1. Check how many comments were already posted TODAY
 *      → If daily cap already hit → exit gracefully
 *      → If cap has remaining slots → continue
 *   2. Load saved browser session (or trigger login if no session)
 *   3. Scrape home feed (primary) + target profiles (optional CSV)
 *   4. Filter: already-commented posts + Open-to-Work authors
 *   5. AI Interest scoring — skip boring/unworthy posts
 *   6. Generate personalized comment via Gemini
 *   7. Post on LinkedIn with human-like delays
 *   8. Track in CSV (deduplication + daily count)
 * ─────────────────────────────────────────────────────────────────
 */

require('dotenv').config();

const chalk = require('chalk');
const config = require('./src/config');
const { createSession, closeSession, randomDelay } = require('./src/browser/session');
const { scrapeFeedPosts, scrapeProfilePosts } = require('./src/linkedin/feed');
const { postComment } = require('./src/linkedin/commenter');
const { generateComment, scorePostInterest } = require('./src/ai/gemini');
const {
  ensureDataFiles,
  readCommentedPosts,
  readTodayCommentedCount,
  writeCommentedPost,
  readTargetProfiles,
} = require('./src/data/csv');

// ──────────────────── Logging ────────────────────

const log      = (msg) => console.log(chalk.cyan('[BOT]'), msg);
const logOk    = (msg) => console.log(chalk.green('[✓]'), msg);
const logWarn  = (msg) => console.log(chalk.yellow('[!]'), msg);
const logError = (msg) => console.log(chalk.red('[✗]'), msg);
const logSkip  = (msg) => console.log(chalk.gray('[→]'), msg);
const sleep    = (ms)  => new Promise((r) => setTimeout(r, ms));

// ──────────────────── Main ────────────────────

async function main() {
  console.log('');
  console.log(chalk.bold.blueBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.blueBright('  🤖  LinkedIn Comment Bot  —  Powered by OpenAI'));
  console.log(chalk.bold.blueBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  const now = new Date();
  console.log(chalk.gray(`  Run started: ${now.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} (PKT)`));
  console.log('');

  // ── 1. Validate AI API key (OpenAI or Gemini) ──
  const hasOpenAI = config.openaiApiKey && config.openaiApiKey.startsWith('sk-') && config.openaiApiKey.length > 20;
  const hasGemini = config.geminiApiKey && config.geminiApiKey.length > 20;
  if (!hasOpenAI && !hasGemini) {
    logError('No AI API key found! Set OPENAI_API_KEY or GEMINI_API_KEY in your .env file.');
    process.exit(1);
  }

  // ── 2. Ensure CSV files exist ──
  ensureDataFiles();

  // ── 3. Check daily comment quota ──
  log('Checking today\'s comment count...');
  const { count: todayCount, todayUrls } = await readTodayCommentedCount();
  const dailyCap = config.bot.maxCommentsPerRun;
  const slotsLeft = dailyCap - todayCount;

  if (todayCount > 0) {
    log(`Already commented on ${chalk.bold(todayCount)} post(s) today.`);
  }

  if (slotsLeft <= 0) {
    console.log('');
    logOk(`Daily cap of ${dailyCap} comments already reached for today.`);
    logOk(`Come back tomorrow or increase MAX_COMMENTS_PER_RUN in .env.`);
    console.log('');
    return;  // exit gracefully — no browser launch needed
  }

  log(`${chalk.bold(slotsLeft)} comment slot(s) remaining for today.`);
  console.log('');

  // ── 4. Load all previously commented posts (for dedup) ──
  const commentedPosts = await readCommentedPosts();
  // Also add today's posts to the dedup set (already tracked by readCommentedPosts, but ensure)
  for (const u of todayUrls) commentedPosts.add(u);

  // ── 5. Load target profiles ──
  const targetProfiles = await readTargetProfiles();

  // ── 6. Launch browser ──
  log('Launching browser...');
  let browser, page;
  try {
    ({ browser, page } = await createSession());
  } catch (err) {
    logError(`Browser launch failed: ${err.message}`);
    process.exit(1);
  }

  try {
    // ── 7. Gather posts ──
    // Always scrape the home feed. Optionally also scrape target profiles.
    let allPosts = [];

    // Home feed is always the primary source
    log('Scraping home feed...');
    const feedPosts = await scrapeFeedPosts(page, 30);
    allPosts = allPosts.concat(feedPosts);

    // If real (non-example) target profiles exist, scrape those too
    const realProfiles = targetProfiles.filter(
      (p) => p.profileUrl && !p.profileUrl.includes('example') && !p.profileUrl.includes('placeholder')
    );
    if (realProfiles.length > 0) {
      log(`\nAlso scraping ${realProfiles.length} target profile(s)...`);
      for (const profile of realProfiles) {
        const posts = await scrapeProfilePosts(page, profile.profileUrl, profile.name);
        allPosts = allPosts.concat(posts);
        await sleep(randomDelay());
      }
    }

    log(`\nTotal raw posts collected: ${chalk.bold(allPosts.length)}`);

    if (allPosts.length === 0) {
      logWarn('No posts found on the feed. Try deleting the ./session folder and re-running.');
      return;
    }

    // ── 8. Deduplicate ──
    const newPosts = allPosts.filter((p) => p.postUrl && !commentedPosts.has(p.postUrl));
    log(`New posts (not yet commented): ${chalk.bold(newPosts.length)}`);

    if (newPosts.length === 0) {
      logOk('All visible posts have already been commented on today. Nothing to do!');
      return;
    }

    // ── 9. AI Interest scoring ──
    console.log('');
    log('🔎 Scoring posts for interest level...');
    const scoredPosts = [];

    for (const post of newPosts) {
      try {
        const { score, reason, interesting } = await scorePostInterest(post.postText, post.authorName);
        const badge = interesting ? chalk.green(`[${score}/100 ✓]`) : chalk.gray(`[${score}/100 ✗]`);
        const truncName = post.authorName.slice(0, 28).padEnd(28);
        console.log(`  ${badge} ${chalk.bold(truncName)} — ${chalk.italic(reason)}`);
        if (interesting) scoredPosts.push({ ...post, interestScore: score });
        await sleep(500);
      } catch (err) {
        logWarn(`Scoring failed for "${post.authorName}": ${err.message}`);
      }
    }

    // Sort best posts first
    scoredPosts.sort((a, b) => b.interestScore - a.interestScore);

    console.log('');
    logOk(`Interesting posts found: ${chalk.bold(scoredPosts.length)}`);

    if (scoredPosts.length === 0) {
      logWarn('No posts met the interest threshold. Try lowering MIN_INTEREST_SCORE in .env (current: ' + config.bot.minInterestScore + ').');
      return;
    }

    // ── 10. Comment loop (up to remaining daily slots) ──
    let commentCount = 0;

    for (const post of scoredPosts) {
      if (commentCount >= slotsLeft) {
        log(`Daily cap reached (${dailyCap} total for today). Stopping.`);
        break;
      }

      console.log('');
      console.log(chalk.bold('─'.repeat(55)));
      log(`Post by: ${chalk.bold(post.authorName)}  ${chalk.green(`[Score: ${post.interestScore}]`)}`);
      if (post.authorHeadline) log(`  ${chalk.gray(post.authorHeadline.slice(0, 80))}`);
      log(`URL: ${chalk.underline(post.postUrl)}`);
      log(`Preview: "${chalk.italic(post.postText.slice(0, 130).replace(/\n/g, ' '))}..."`);

      // Generate
      let comment;
      try {
        log('Generating AI comment...');
        comment = await generateComment(post.postText, post.authorName);
        log(`Comment: ${chalk.greenBright(`"${comment}"`)}`);
      } catch (err) {
        logError(`AI failed: ${err.message}`);
        await sleep(2000);
        continue;
      }

      // Post
      log('Posting comment on LinkedIn...');
      let success = false;
      try {
        success = await postComment(page, post.postUrl, comment);
      } catch (err) {
        // If page/browser closed, try to open a new page and continue
        if (err.message && (err.message.includes('Target page') || err.message.includes('browser has been closed'))) {
          logWarn('Page closed unexpectedly — reopening...');
          try {
            page = await browser.newPage();
            await page.waitForTimeout(2000);
          } catch {
            logError('Browser is gone. Stopping.');
            break;
          }
        } else {
          logWarn(`Comment error: ${err.message.slice(0, 80)}`);
        }
      }

      if (success) {
        logOk(`Comment posted! (${todayCount + commentCount + 1}/${dailyCap} today)`);
        await writeCommentedPost(post.postUrl, post.authorName, comment);
        commentedPosts.add(post.postUrl);
        commentCount++;
      } else {
        logWarn(`Could not comment on post by ${post.authorName}. Skipping.`);
      }

      // Human-like delay
      if (commentCount < slotsLeft) {
        const delay = randomDelay();
        log(`Waiting ${(delay / 1000).toFixed(1)}s before next comment...`);
        await sleep(delay);
      }
    }

    // ── Summary ──
    const totalToday = todayCount + commentCount;
    console.log('');
    console.log(chalk.bold.greenBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    logOk(`Posted ${chalk.bold(commentCount)} comment(s) this run — ${chalk.bold(totalToday)}/${dailyCap} for today.`);
    if (commentCount > 0) {
      logOk(`Saved to: ${chalk.underline('./data/commented_posts.csv')}`);
    }
    if (totalToday >= dailyCap) {
      logWarn(`Daily cap reached. Next run will exit early until tomorrow.`);
    } else {
      log(`${dailyCap - totalToday} slot(s) still available — you can run again later today.`);
    }
    console.log(chalk.bold.greenBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log('');

  } catch (err) {
    logError(`Unexpected error: ${err.message}`);
    console.error(err);
  } finally {
    log('Closing browser...');
    await closeSession(browser);
  }
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
