'use strict';

/**
 * ─────────────────────────────────────────────────────────────────
 *  LinkedIn Comment Bot — Main Orchestrator
 *  Run: node bot.js
 *
 *  Simplified step-by-step flow:
 *   1.  Validate AI API key
 *   2.  Launch browser + restore/create session (login if needed)
 *   3.  Navigate to LinkedIn home feed
 *   4.  Find ONE interesting post from the feed
 *        → Filters out: Open To Work authors, students, job ads
 *        → Uses heuristic scoring to pick a worthy post
 *   5.  AI scores the post (double-check via Gemini/OpenAI)
 *   6.  Pick a random comment writing style
 *   7.  Generate comment with AI
 *   8.  Post the comment on LinkedIn
 *   9.  Save to CSV
 *  10.  Wait — press Enter in the terminal to close the browser
 * ─────────────────────────────────────────────────────────────────
 */

require('dotenv').config();

const readline = require('readline');
const chalk    = require('chalk');

const config   = require('./src/config');
const { createSession } = require('./src/browser/session');
const { findOneInterestingPost } = require('./src/linkedin/feed');
const { postComment }            = require('./src/linkedin/commenter');
const { generateComment, scorePostInterest } = require('./src/ai/gemini');
const { pickRandomStyle }        = require('./src/ai/commentStyles');
const {
  ensureDataFiles,
  readCommentedPosts,
  writeCommentedPost,
} = require('./src/data/csv');

// ──────────────────── Logging ────────────────────

const log      = (msg) => console.log(chalk.cyan('[BOT]'), msg);
const logOk    = (msg) => console.log(chalk.green('[✓]'), msg);
const logWarn  = (msg) => console.log(chalk.yellow('[!]'), msg);
const logError = (msg) => console.log(chalk.red('[✗]'), msg);
const logStep  = (n, msg) => console.log(chalk.bold.blueBright(`\n── Step ${n}: ${msg} ──`));

// ──────────────────── Terminal prompt ────────────────────

/** Pauses until the user presses Enter in the terminal. */
function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.bold.yellow(prompt), () => { rl.close(); resolve(); });
  });
}

// ──────────────────── Main ────────────────────

async function main() {
  console.log('');
  console.log(chalk.bold.blueBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold.blueBright('  🤖  LinkedIn Comment Bot  —  Powered by AI'));
  console.log(chalk.bold.blueBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.gray(`  Started: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} (PKT)`));
  console.log('');

  // ── Step 1: Validate AI API key ──────────────────────────────────
  logStep(1, 'Validating AI API key');
  const hasOpenAI = !!(config.openaiApiKey && config.openaiApiKey.startsWith('sk-') && config.openaiApiKey.length > 20);
  const hasGemini = !!(config.geminiApiKey && config.geminiApiKey.length > 20);
  if (!hasOpenAI && !hasGemini) {
    logError('No AI API key found. Set OPENAI_API_KEY or GEMINI_API_KEY in .env');
    process.exit(1);
  }
  logOk(`AI provider: ${hasOpenAI ? 'OpenAI (primary)' : ''}${hasGemini ? (hasOpenAI ? ' + Gemini (fallback)' : 'Gemini') : ''}`);

  // ── Step 2: Ensure CSV files exist ──────────────────────────────
  logStep(2, 'Preparing data files');
  ensureDataFiles();
  const commentedPosts = await readCommentedPosts();
  logOk(`Loaded ${commentedPosts.size} previously commented post(s) for deduplication.`);

  // ── Step 3: Launch browser + login ──────────────────────────────
  logStep(3, 'Launching browser & restoring session');
  let browser, page;
  try {
    ({ browser, page } = await createSession());
  } catch (err) {
    logError(`Browser launch failed: ${err.message}`);
    process.exit(1);
  }

  try {
    // ── Step 4: Find ONE interesting post from the feed ─────────────
    logStep(4, 'Finding one interesting post from the feed');
    log('Filters in use:');
    log('  • Skip authors who are Open To Work / job-seeking');
    log('  • Skip students, interns, freshers, aspiring developers');
    log('  • Skip job advertisement posts');
    log('  • Require a minimum heuristic interest score');
    console.log('');

    const post = await findOneInterestingPost(page, commentedPosts);

    if (!post) {
      logWarn('No suitable post found on the current feed.');
      logWarn('Tip: scroll LinkedIn manually for a moment to load new posts, then re-run.');
      await waitForEnter('\nPress ENTER to close the browser and exit...\n');
      return;
    }

    console.log('');
    console.log(chalk.bold('─── Post Selected ───────────────────────────────────'));
    log(`Author  : ${chalk.bold(post.authorName)}`);
    if (post.authorHeadline) log(`Headline: ${chalk.gray(post.authorHeadline.slice(0, 90))}`);
    log(`URL     : ${chalk.underline(post.postUrl)}`);
    log(`Preview : "${chalk.italic(post.postText.slice(0, 160).replace(/\n/g, ' '))}..."`);
    console.log(chalk.bold('─────────────────────────────────────────────────────'));

    // ── Step 5: AI interest scoring (second opinion) ────────────────
    logStep(5, 'AI interest scoring (double-check)');
    let aiScore = null;
    try {
      const { score, reason, interesting } = await scorePostInterest(post.postText, post.authorName);
      aiScore = score;
      log(`AI score: ${chalk.bold(score + '/100')} — ${chalk.italic(reason)}`);
      if (!interesting) {
        logWarn(`AI says this post is not interesting enough (score ${score}/${config.bot.minInterestScore} threshold).`);
        logWarn('Proceeding anyway since we already passed heuristic filter.');
      } else {
        logOk('AI agrees this post is worth commenting on.');
      }
    } catch (err) {
      logWarn(`AI scoring unavailable: ${err.message.slice(0, 60)} — continuing with heuristic only.`);
    }

    // ── Step 6: Pick a random comment style ─────────────────────────
    logStep(6, 'Selecting comment writing style');
    const style = pickRandomStyle();
    logOk(`Style selected: ${chalk.bold(style.label)}`);
    log(`  → ${chalk.italic(style.instruction.slice(0, 100))}...`);

    // ── Step 7: Generate comment via AI ─────────────────────────────
    logStep(7, 'Generating AI comment');
    let comment;
    try {
      comment = await generateComment(post.postText, post.authorName, style);
      console.log('');
      console.log(chalk.bold.greenBright('  Generated comment:'));
      console.log(chalk.greenBright(`  "${comment}"`));
      console.log('');
    } catch (err) {
      logError(`AI comment generation failed: ${err.message}`);
      await waitForEnter('\nPress ENTER to close the browser and exit...\n');
      return;
    }

    // ── Step 8: Post the comment on LinkedIn ─────────────────────────
    logStep(8, 'Posting comment on LinkedIn');
    let success = false;
    try {
      success = await postComment(page, post.postUrl, comment);
    } catch (err) {
      logError(`Commenter error: ${err.message.slice(0, 100)}`);
    }

    if (success) {
      // ── Step 9: Save to CSV ──────────────────────────────────────
      logStep(9, 'Saving result to CSV');
      await writeCommentedPost(post.postUrl, post.authorName, comment);
      console.log('');
      console.log(chalk.bold.greenBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      logOk(`Comment posted successfully!`);
      logOk(`Saved to: ${chalk.underline('./data/commented_posts.csv')}`);
      console.log(chalk.bold.greenBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    } else {
      logWarn('Comment could not be posted. The browser is still open for you to try manually.');
    }

  } catch (err) {
    logError(`Unexpected error: ${err.message}`);
    console.error(err);
  }

  // ── Step 10: Wait for user to close ──────────────────────────────
  logStep(10, 'Done');
  console.log('');
  log('The browser is still open. You can keep browsing LinkedIn.');
  console.log('');
  await waitForEnter('Press ENTER here to close the browser and exit the bot...\n');

  log('Closing browser...');
  await browser.close();
  log('Bye! 👋');
  console.log('');
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
