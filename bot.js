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
const { getFeedPostsBatch, parseEngagement, normalizePostText } = require('./src/linkedin/feed');
const { shouldSkip, compositeScore } = require('./src/linkedin/filters');
const { postComment }            = require('./src/linkedin/commenter');
const { generateComment }        = require('./src/ai/gemini');
const { pickRandomStyle, getStyleMemory } = require('./src/ai/commentStyles');
const {
  extractPostId,
  ensureDataFiles,
  parseCSVLine,
} = require('./src/data/csv');
const {
  acquirePostLock,
  saveComment,
  releaseLock,
  loadCommentedCache,
  loadRecentAuthorsFromDb,
} = require('./src/data/postLock');
const { logCommentPerformance, getSummary: getLearningStats } = require('./src/data/learning');
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
function delay(min = config.bot.minDelayMs, max = config.bot.maxDelayMs) {
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
//  AUTHOR DEDUP — now served from PostgreSQL via loadRecentAuthorsFromDb
//  (imported from src/data/postLock.js).
//  This stub is kept so call sites don't need to change.
// ─────────────────────────────────────────────────────────────────

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

  // ── Step 2: Connect to PostgreSQL + Redis, load startup caches ──
  logStep(2, 'Connecting to PostgreSQL & Redis — loading dedup cache');
  ensureDataFiles(); // still creates the CSV data dir for learning logs
  let { ids: commentedIds, urls: commentedFullUrls } = await loadCommentedCache();
  const recentAuthors = await loadRecentAuthorsFromDb();
  success(`PostgreSQL: ${commentedIds.size} previously commented post(s) loaded.`);
  success(`Author cooldown: ${recentAuthors.size} author(s) in 7-day cooldown.`);
  try { success(`Learning: ${getLearningStats()}`); } catch { /* first run */ }

  // ── Step 3: Natural inactivity check ────────────────────────────
  logStep(3, 'Natural inactivity check');
  // 10% chance to skip — reduced from 25% so the bot actually runs most of the time
  if (Math.random() < 0.10) {
    log('Skipping this run — natural inactivity day. (10% chance)');
    log('Re-run to try again.');
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
    // ── Step 5: Continuous Evaluation Loop ──────────────────────────
    const MAX_RUNTIME_MS = 60 * 60 * 1000;
    const startTime = Date.now();
    const MAX_COMMENTS = config.bot.maxCommentsPerRun || 3;
    let commentsMade = 0;

    logStep(5, `Starting Continuous Engagement Loop (Max ${MAX_COMMENTS} comments, 60 min limit)`);
    log(`Threshold: SCORE >= ${config.bot.minInterestScore}`);
    log('Filters active:');
    log('  • Skip OTW / job-seeking authors');
    log('  • Skip students, interns, freshers');
    log('  • Skip job advertisement posts');
    log('  • Skip grief / tragedy posts');
    log('  • Skip authors commented on in the last 7 days');

    // track seen across batches so we don't evaluate same posts
    const runSeenUrls  = new Set();
    const runSeenTexts = new Set();
    let   consecutiveEmptyBatches = 0;   // batches where nothing new was actionable
    let   scrollPasses            = 5;   // start moderate; ramp up when stuck

    while (commentsMade < MAX_COMMENTS && (Date.now() - startTime) < MAX_RUNTIME_MS) {
      log(`\n⏳ Time elapsed: ${Math.round((Date.now() - startTime) / 1000 / 60)} min / 60 min limit. Comments: ${commentsMade}/${MAX_COMMENTS}`);
      log("Scrolling feed and collecting batch of posts...");

      // ── When stuck, reload the feed so the DOM gets a completely fresh set ──
      if (consecutiveEmptyBatches >= 3) {
        log('  ↺ Reloading LinkedIn feed to fetch fresh posts...');
        try {
          await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await new Promise(r => setTimeout(r, 4000));
        } catch (e) { warn(`  Feed reload error: ${e.message}`); }
        consecutiveEmptyBatches = 0;
        scrollPasses = 5;  // reset scroll depth after reload

        // ── Clear run-level URL cache (but NOT text cache) ──
        // runSeenUrls: remove IDs that were only "seen" (not actually commented).
        //   Commented IDs stay so we never re-attempt them even after reload.
        // runSeenTexts: NEVER clear — it is the last line of defense against the
        //   same post re-appearing with a different URL format after reload.
        const toRemove = [...runSeenUrls].filter(id => !commentedIds.has(id));
        toRemove.forEach(id => runSeenUrls.delete(id));
        log(`  ↺ Cleared ${toRemove.length} temporary seen-IDs (${runSeenUrls.size} permanent remain).`);
      }
      
      const postsBatch = await getFeedPostsBatch(page, scrollPasses);
      // Ramp up scroll passes each empty round so we dig deeper
      scrollPasses = Math.min(scrollPasses + 2, 18);
      
      if (!postsBatch || postsBatch.length === 0) {
        warn('No posts found in this batch. Trying again in 5s...');
        consecutiveEmptyBatches++;
        await delay(5000, 8000);
        continue;
      }
      
      log(`Found ${postsBatch.length} posts in batch. Evaluating...`);
      
      // evaluate posts sequentially
      log(`  Evaluating ${postsBatch.length} post(s) from batch...`);
      let skippedNoUrl    = 0;
      let newActionable   = 0;   // posts that passed all filters and were scored
      for (let i = 0; i < postsBatch.length; i++) {
        if (commentsMade >= MAX_COMMENTS || (Date.now() - startTime) > MAX_RUNTIME_MS) break;
        
        const post = postsBatch[i];
        if (!post.postUrl) {
          skippedNoUrl++;
          // Log every 4th no-URL skip to avoid spam
          if (skippedNoUrl <= 2 || skippedNoUrl % 4 === 0) {
            console.log(`  [SKIP] No URL (author: ${post.authorName || 'unknown'}, textLen: ${post.postText?.length || 0})`);
          }
          continue;
        }
        
        // dedup within run
        const postId = extractPostId(post.postUrl);
        const normalizedUrl = post.postUrl.replace(/\/+$/, '');
        if (runSeenUrls.has(postId)) {
          console.log(`  [SKIP] runSeenUrls: ${postId}`);
          continue;
        }
        runSeenUrls.add(postId);
        
        // Text-only key (no author name) — same normalization as feed.js dedup().
        // Author name is intentionally excluded: "John Doe" vs "John Doe • 2nd+"
        // from different scraping passes would generate different keys and allow
        // the same post through twice.
        const textKey = normalizePostText(post.postText).slice(0, 80);
        if (runSeenTexts.has(textKey)) {
          console.log(`  [SKIP] runSeenTexts: ${textKey.slice(0, 60)}`);
          continue;
        }
        runSeenTexts.add(textKey);

        // dedup globally — check both activity ID and full URL
        if (commentedIds.has(postId) || commentedFullUrls.has(normalizedUrl)) {
          console.log(`  [SKIP] Already commented: ${postId}`);
          continue;
        }
        
        // hard filters
        const { skip, reason } = shouldSkip(post.authorName, post.authorHeadline, post.postText);
        if (skip) {
          console.log(`  [SKIP] filter (${reason}): ${post.authorName}`);
          continue;
        }
        
        // 7-day cooldown — strip LinkedIn suffixes ("• 2nd+", "• 3rd+", "· 1st")
        // before comparing so "John Doe • 2nd+" matches stored "John Doe".
        const authorKey = (post.authorName || '')
          .replace(/\s*[•·]\s*(1st|2nd|3rd|\d+st|\d+nd|\d+rd|\d+th)[\+]?\s*$/i, '')
          .trim()
          .toLowerCase();
        if (recentAuthors.has(authorKey)) {
          console.log(`  [SKIP] 7-day cooldown: ${post.authorName}`);
          continue;
        }
        
        // Engagement and Score
        const { reactionCount, commentCount } = parseEngagement(post.cardText || '');
        const { total: score, breakdown } = compositeScore({
          postText:       post.postText,
          authorHeadline: post.authorHeadline,
          reactionCount,
          commentCount,
          positionIndex:  i,
          totalPosts:     postsBatch.length,
          isConnection:   post.isConnection,
          postFormat:     post.postFormat,
          commentsData:   post.commentsData,
          authorReplied:  post.authorReplied,
          postAge:        post.postAge
        });
        
        const nameStr = (post.authorName || 'Unknown').slice(0, 20).padEnd(20);
        const engStr  = reactionCount ? `${reactionCount}👍 ${commentCount}💬` : 'no data';
        const isGood  = score >= config.bot.minInterestScore;
        const mark    = isGood ? '[✓]' : '[✗]';
        
        newActionable++;
        log(`  ${mark} ${nameStr} | score:${score} (H:${breakdown.heuristic} E:${breakdown.engagement} V:${breakdown.visibility}) | ${engStr}`);
        
        if (isGood) {
          log(`\n🏆 Found target post by "${post.authorName}" (Score: ${score})`);
          log(`   Breakdown: H${breakdown.heuristic} E${breakdown.engagement} V${breakdown.visibility} S${breakdown.seniority} N${breakdown.niche} R${breakdown.recency}`);
          
          // Step 6: Style
          logStep(6, 'Picking comment style');
          const style = pickRandomStyle();
          success(`Style: "${style.label}"`);
          
          // Step 7: Generate
          logStep(7, 'Generating comment with AI...');
          await delay(2000, 4000);
          const result = await generateComment(post.postText, post.authorName, style, {
            existingComments: post.commentsData || [],
            authorHeadline: post.authorHeadline || '',
          });
          
          log(`   AI Target Angle: ${result.bestAngle}`);
          console.log(chalk.italic(`   "${result.comment}"\n`));
          
          if (!result.comment || result.comment.length < 10) {
            warn('   [!] AI failed to generate valid comment. Skipping...');
            continue;
          }
          
          // Step 8: Read pause
          logStep(8, 'Simulating reading time');
          const words = post.postText.split(/\s+/).length;
          const pauseMs = Math.round(Math.min(12, Math.max(4, words / 40)) * 1000);
          log(`   Post has ~${words} words — pausing ${(pauseMs/1000).toFixed(1)}s...`);
          
          // Human reading pause — postComment handles all navigation, just sleep here
          await new Promise(r => setTimeout(r, pauseMs));

          // Step 10: Post comment
          logStep(10, 'Posting comment on LinkedIn');

          // ── Steps 1–3: DB check → Redis lock → DB double-check ──────────────
          // acquirePostLock() runs all three checks atomically before we touch
          // the browser. If ANY check fails → skip with zero side-effects.
          log('   [Lock] Acquiring Redis lock + PostgreSQL pre-check...');
          const lockResult = await acquirePostLock(postId).catch((e) => {
            warn(`   [!] Lock error: ${e.message.slice(0, 80)}`);
            return { locked: false, reason: 'lock system error' };
          });

          if (!lockResult.locked) {
            warn(`   [!] Skipped — ${lockResult.reason}: ${postId}`);
            commentedIds.add(postId);
            commentedFullUrls.add(normalizedUrl);
            continue; // → next post in batch
          }
          log('   [Lock] Lock acquired. Proceeding to comment.');

          // Lock is held — use try/finally to guarantee release
          let posted = false;
          try {
            // ── Step 4: Comment on LinkedIn ────────────────────────────────────
            posted = await postComment(page, post.postUrl, result.comment);

            // Block this author for the 7-day cooldown regardless of result.
            // The lock prevents a second attempt on this post; the author block
            // prevents attempts on other posts by the same person in this run.
            recentAuthors.add(
              (post.authorName || '')
                .replace(/\s*[•·]\s*(1st|2nd|3rd|\d+st|\d+nd|\d+rd|\d+th)\+?\s*$/i, '')
                .trim()
                .toLowerCase()
            );

            if (posted) {
              // ── Step 5: Save to PostgreSQL ─────────────────────────────────
              // Only save on confirmed success. A duplicate-key error here
              // means another process sneaked in — treated as success (upsert).
              await saveComment({
                postId,
                postUrl:     post.postUrl,
                authorName:  post.authorName,
                commentText: result.comment,
              });
              commentedIds.add(postId);
              commentedFullUrls.add(normalizedUrl);

              success(`   Posted! Saved to PostgreSQL.`);
              commentsMade++;

              // Track for self-learning
              try {
                logCommentPerformance({
                  postUrl:              post.postUrl,
                  authorName:           post.authorName,
                  authorHeadline:       post.authorHeadline || '',
                  comment:              result.comment,
                  style:                style.id,
                  type:                 '',
                  score,
                  bestAngle:            result.bestAngle || '',
                  existingCommentCount: (post.commentsData || []).length,
                  authorCountry:        '',
                  postFormat:           post.postFormat || 'text',
                });
              } catch (learnErr) {
                warn(`   [!] Learning log failed: ${learnErr.message.slice(0, 60)}`);
              }
            } else {
              warn('   [!] Post attempt failed. NOT saved to database — can be retried next run.');
            }
          } catch (e) {
            warn(`   [!] Page interaction error: ${e.message.slice(0, 100)}`);
            // Do NOT save to DB — the comment may not have been posted.
          } finally {
            // ── Step 6: Release Redis lock ─────────────────────────────────────
            // Runs unconditionally — even on thrown errors or process interrupts.
            await releaseLock(postId).catch(() => {});
            log('   [Lock] Redis lock released.');
          }

          // Ensure we are back on the feed for the next iteration
          try {
            if (!page.url().includes('linkedin.com/feed')) {
              await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
            }
          } catch { /* page may be closed — next iteration's ensureOnFeed will recover */ }

          // Reset stuck state regardless of whether posting succeeded or failed
          consecutiveEmptyBatches = 0;
          scrollPasses = 5;

          if (posted) {
            await delay(3000, 5000);
            log(`   Taking a break before continuing the hunt...`);
            const breakMinMin = config.bot.interCommentBreakMinMin;
            const breakMaxMin = config.bot.interCommentBreakMaxMin;
            const range = Math.max(1, breakMaxMin - breakMinMin);
            const minutesToWait = breakMinMin + Math.floor(Math.random() * (range + 1));
            const breakMs = minutesToWait * 60 * 1000 + Math.floor(Math.random() * 30000);
            log(`   Pausing for ~${minutesToWait} min (range ${breakMinMin}–${breakMaxMin} from .env) to seem human.`);
            await new Promise(r => setTimeout(r, breakMs));
          } else {
            // Failed attempt — short pause then resume searching immediately
            await delay(3000, 5000);
          }
        }
      } // end for (postsBatch)

      // Update stuck counter: if nothing actionable in this round, back off
      if (newActionable === 0) {
        consecutiveEmptyBatches++;
        log(`  [!] No new actionable posts (${consecutiveEmptyBatches}/3 before feed reload). Waiting...`);
        await delay(4000, 7000);
      } else {
        consecutiveEmptyBatches = 0;
      }
    }

    logStep('END', `Finished bot run. Comments made: ${commentsMade}/${MAX_COMMENTS}`);
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
