# 🔍 SELECT INTERESTING POST — Line-by-Line Code Explanation

> **Files covered:** `src/linkedin/feed.js`, `src/linkedin/filters.js`, `src/linkedin/commenter.js`, `bot.js` (post selection steps)
> **What this covers:** How the bot finds, filters, scores, and selects the best LinkedIn post to comment on.

---

## 📁 `src/linkedin/filters.js` — Content Filtering & Scoring

This file decides which posts to **skip** and which to **score**. It exports two main functions: `shouldSkip()` (hard filters) and `compositeScore()` (weighted ranking).

### 🚫 Skip Signal Lists

```js
const OTW_SIGNALS = [
  'open to work', 'open to opportunities', '#opentowork', 'open for work',
  'actively seeking', 'actively looking', 'available for hire', ...
];
```
Array of phrases that indicate a person is job-seeking. If any of these appear in the author's name, headline, or post — the post is **skipped entirely**. Commenting on job-seekers doesn't build your authority.

```js
const STUDENT_SIGNALS = [
  'student', 'undergraduate', 'bsc student', 'intern', 'internship',
  'fresher', 'fresh graduate', 'entry level', 'junior developer',
  'aspiring developer', 'bootcamp', 'self-taught', 'learning to code', ...
];
```
Phrases that identify students, interns, and junior-level people. Commenting on their posts gives no professional exposure.

```js
const JOB_POST_SIGNALS = [
  "we're hiring", 'we are hiring', 'now hiring', 'join our team',
  'apply now', 'send your cv', 'job opening', '#hiring', '#vacancy', ...
];
```
Phrases that identify job advertisements posted by recruiters or companies. These are high-engagement but commenting on them offers zero authority-building value.

```js
const SENTIMENT_SKIP_SIGNALS = [
  'lost my', 'passed away', 'rest in peace', 'rip ', 'we lost',
  'diagnosed with', 'cancer', 'funeral', 'grieving',
  'laid off today', 'just got laid off', 'suicide', 'depression', ...
];
```
Posts about grief, tragedy, or mental health crises. The bot **never** comments on these out of ethical respect — automated empathy is inappropriate.

### 📈 Scoring Signal Lists

```js
const NICHE_SIGNALS = [
  'nodejs', 'node.js', 'backend', 'api design', 'graphql', 'microservices',
  'nextjs', 'next.js', 'react', 'typescript', 'full stack',
  'ai workflow', 'automation', 'n8n', 'llm', 'ai agent', 'openai', 'gemini',
  'saas', 'startup', 'founder', 'cto', 'shipped', 'launched', ...
];
```
Keywords matching the bot owner's expertise area (Full Stack / AI). More hits = higher niche relevance score. This targets posts where your comment will be most credible.

```js
const SENIORITY_SIGNALS = [
  ['founder', 25], ['co-founder', 25], ['ceo', 25], ['cto', 22],
  ['chief', 20], ['vp ', 20], ['director', 15], ['head of', 15],
  ['staff engineer', 14], ['engineering manager', 12], ['senior', 10], ...
];
```
An array of `[keyword, points]` pairs. These match against the author's LinkedIn headline. A `founder` is worth 25 seniority points, a `senior` engineer is worth 10. Higher-seniority authors = bigger professional exposure when you comment.

```js
const GOOD_SIGNALS = [
  'startup', 'founder', 'product', 'engineering', 'ai', 'leadership',
  'lesson', 'learned', 'mistake', 'growth', 'scale', 'built', 'shipped', ...
];
```
Content-quality keywords. Posts with these words tend to contain real insights, stories, or opinions — ideal for adding value with a comment.

```js
const BAD_SIGNALS = [
  'motivational quote', 'agree?', 'share if you agree',
  'repost if', 'double tap', 'humble', 'like if', 'comment below', ...
];
```
Low-quality engagement-bait patterns. Each hit subtracts points from the heuristic score.

---

### 🛠 Helper Functions

```js
function lc(...parts) {
  return parts.filter(Boolean).join(' ').toLowerCase();
}
```
Utility: takes multiple string arguments, filters out falsy values (null/undefined), joins them with a space, and lowercases the result. Used to normalize text for case-insensitive matching.

```js
function hasAny(text, signals) {
  return signals.some((s) => {
    const kw = Array.isArray(s) ? s[0] : s;
    return text.includes(kw);
  });
}
```
Checks if `text` contains ANY of the keywords in `signals`. The `Array.isArray(s) ? s[0] : s` handles both plain strings (`'founder'`) and `[keyword, points]` tuples — takes just the keyword part.

```js
function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}
```
Ensures a number stays within a range. Example: `clamp(150, 0, 100)` returns `100`. Used throughout to keep scores in the 0–100 range.

---

### 🚫 Skip Check Functions

```js
function isOpenToWork(authorName, authorHeadline, postText) {
  return hasAny(lc(authorName, authorHeadline, postText.slice(0, 400)), OTW_SIGNALS);
}
```
Combines the author name, headline, and first 400 chars of post text into one lowercase string, then checks for open-to-work keywords. `slice(0, 400)` limits how much text is scanned (performance + avoids false positives deep in post body).

```js
function isStudent(authorName, authorHeadline, postText) {
  return hasAny(lc(authorName, authorHeadline, postText.slice(0, 400)), STUDENT_SIGNALS);
}
function isJobPost(postText) {
  return hasAny(lc('', '', postText.slice(0, 800)), JOB_POST_SIGNALS);
}
function isSentimentPost(postText) {
  return hasAny(lc('', '', postText.slice(0, 600)), SENTIMENT_SKIP_SIGNALS);
}
```
Each function checks a different category. `isJobPost` scans more characters (800) because hiring posts often bury the key phrase. `isSentimentPost` only scans 600 chars because grief/tragedy mentions are usually near the start.

```js
function shouldSkip(authorName, authorHeadline, postText) {
  if (isOpenToWork(authorName, authorHeadline, postText))
    return { skip: true, reason: 'Author is Open To Work' };
  if (isStudent(authorName, authorHeadline, postText))
    return { skip: true, reason: 'Author appears to be a student / junior' };
  if (isJobPost(postText))
    return { skip: true, reason: 'Post is a job advertisement' };
  if (isSentimentPost(postText))
    return { skip: true, reason: 'Post is about grief / tragedy — skip out of respect' };
  return { skip: false, reason: '' };
}
```
Master gate function. Runs all four checks in priority order. Returns `{ skip: true, reason: '...' }` on first match (stops early — efficient). If all pass, returns `{ skip: false }`.

---

### 📊 Composite Scoring Sub-functions

#### `calcHeuristicScore(postText)` — Content Quality Score (weight: 40%)

```js
function calcHeuristicScore(postText) {
  const t = lc('', '', postText);
  if (postText.length < 100) return 0;           // too short = skip
  let score = 0;
  if (postText.length > 300)  score += 15;       // medium length
  if (postText.length > 600)  score += 10;       // long form
  if (postText.length > 1000) score += 5;        // very detailed
  for (const kw of GOOD_SIGNALS) if (t.includes(kw)) score += 5;   // +5 per good keyword
  for (const kw of BAD_SIGNALS)  if (t.includes(kw)) score -= 10;  // -10 per bad keyword
  return clamp(score, 0, 100);
}
```
- Posts under 100 chars score 0 (no content).
- Length bonuses reward detailed, thoughtful posts.
- Each GOOD_SIGNAL keyword found adds 5 points.
- Each BAD_SIGNAL keyword found subtracts 10 points.
- `clamp(score, 0, 100)` ensures the result stays in 0–100 range.

#### `calcEngagementScore(reactionCount, commentCount)` — Engagement Score (weight: 25%)

```js
function calcEngagementScore(reactionCount, commentCount) {
  if (reactionCount < 5)     return 10;   // very low engagement still okay (new post)
  if (reactionCount > 10000) return 15;   // viral = too noisy, avoid
  if (commentCount > 200)    return 10;   // too crowded, your comment gets buried

  const reactionScore = Math.log10(reactionCount + 1) * 20;   // log scale 0-100
  const sweetSpot = reactionCount >= 20 && reactionCount <= 500 ? 20 : 0;  // bonus
  return clamp(reactionScore + sweetSpot, 0, 100);
}
```
Key design decisions:
- **Too few reactions (<5):** Post may be new and unseen — score 10 (neutral).
- **Viral posts (>10k reactions):** Your comment gets buried in noise — penalized to 15.
- **Too many comments (>200):** Crowded threads hide your comment — penalized to 10.
- **Log scale:** `Math.log10(reactions + 1) * 20` — goes from 0 (0 reactions) to ~60 (1000 reactions) smoothly. Prevents viral posts from dominating just because of a linear high count.
- **Sweet spot bonus (+20):** 20–500 reactions = optimal visibility. Your comment appears before the flood, but after enough people care.

#### `calcSeniorityScore(authorHeadline)` — Author Seniority Score (weight: 15%)

```js
function calcSeniorityScore(authorHeadline) {
  const hl = authorHeadline.toLowerCase();
  for (const [kw, pts] of SENIORITY_SIGNALS) {
    if (hl.includes(kw)) return clamp(pts * 4, 0, 100);
  }
  return 20;  // unknown headline = neutral
}
```
- Iterates through `SENIORITY_SIGNALS` in priority order (founders first).
- On first match, returns `pts * 4` (e.g., `founder` = 25 × 4 = 100, `senior` = 10 × 4 = 40).
- The `* 4` multiplier scales the raw seniority points into the 0–100 range.
- Unknown headline = 20 (slight penalty, not zero — the post may still be valuable).

#### `calcNicheScore(postText)` — Niche Relevance Score (weight: 10%)

```js
function calcNicheScore(postText) {
  const t = lc('', '', postText);
  let hits = 0;
  for (const kw of NICHE_SIGNALS) if (t.includes(kw)) hits++;
  return clamp(hits * 15, 0, 100);
}
```
Counts how many niche keywords appear (Node.js, React, AI, automation, etc.). Each hit adds 15 points. At 7+ hits, the score reaches 100 (clamped). Posts closely matching your expertise receive the highest niche scores.

#### `calcRecencyScore(positionIndex, totalPosts)` — Recency Score (weight: 10%)

```js
function calcRecencyScore(positionIndex, totalPosts) {
  if (totalPosts === 0) return 50;
  const ratio = 1 - (positionIndex / totalPosts);
  return clamp(ratio * 100, 0, 100);
}
```
Uses post *position in the feed* as a proxy for recency (no actual timestamps without visiting each post).
- Post at index 0 (top of feed) = ratio 1.0 = score 100 (most recent).
- Post at last position = ratio ≈ 0 = score ~0 (oldest).
- If `totalPosts = 0`, returns safe default 50.

---

### 🏆 `compositeScore(post)` — Master Scorer

```js
function compositeScore(post) {
  const { postText, authorHeadline, reactionCount, commentCount, positionIndex, totalPosts } = post;

  const heuristic  = calcHeuristicScore(postText);
  const engagement = calcEngagementScore(reactionCount, commentCount);
  const seniority  = calcSeniorityScore(authorHeadline);
  const niche      = calcNicheScore(postText);
  const recency    = calcRecencyScore(positionIndex, totalPosts);

  const total = (heuristic  * 0.40)
              + (engagement * 0.25)
              + (seniority  * 0.15)
              + (niche      * 0.10)
              + (recency    * 0.10);

  return {
    total: Math.round(clamp(total, 0, 100)),
    breakdown: { heuristic, engagement, seniority, niche, recency },
    shouldComment: total >= 30,
  };
}
```
Calculates each sub-score, then applies **weighted sum**:

| Factor | Weight | Why |
|--------|--------|-----|
| Content quality (heuristic) | **40%** | Most important — content must be relevant |
| Engagement | **25%** | Social proof + visibility window |
| Author seniority | **15%** | Higher-profile authors = more exposure |
| Niche relevance | **10%** | Credibility of your comment |
| Recency | **10%** | Fresher posts get more eyes |

- `shouldComment: total >= 30` — any post scoring 30+/100 passes the threshold.
- `Math.round(clamp(total, 0, 100))` — rounds to nearest integer, keeps in 0–100.

---

## 📁 `src/linkedin/feed.js` — Feed Scraper & Post Finder

### 🧭 `ensureOnFeed(page)` — Navigate to LinkedIn Feed

```js
async function ensureOnFeed(page) {
  const url = page.url();
  if (url.includes('linkedin.com/feed')) { return; }  // already there
  const clicked = await page.evaluate(() => {
    const l = document.querySelector('a[href="/feed/"]') ||
              document.querySelector('a[href="https://www.linkedin.com/feed/"]');
    if (l) { l.click(); return true; }
    return false;
  });
  if (!clicked) {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await page.waitForTimeout(4000);
}
```
- `page.url()`: Gets the current URL of the Playwright browser page.
- If already on feed, returns immediately.
- `page.evaluate(() => {...})`: Runs JavaScript code **inside the browser** (not Node.js). It searches for the feed nav link and clicks it — mimicking how a human would navigate.
- If the nav link isn't found, uses `page.goto()` to hard-navigate to the feed URL.
- `waitForTimeout(4000)`: Waits 4 seconds for the page to load and render.

### 📜 `scrollFeed(page, passes)` — Human-Like Scrolling

```js
async function scrollFeed(page, passes = 10) {
  for (let i = 0; i < passes; i++) {
    const amount = 400 + Math.floor(Math.random() * 500);
    await page.evaluate((px) => window.scrollBy(0, px), amount);
    await page.waitForTimeout(700 + Math.floor(Math.random() * 600));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
}
```
- Scrolls down 10 times (each by 400–900px — randomized so it doesn't look like a bot with fixed pixel amounts).
- Waits 700–1300ms between scrolls (randomized — humans scroll at varying speeds).
- After 10 passes, scrolls back to the top with `window.scrollTo(0, 0)`.
- This loads more posts into the DOM (LinkedIn's infinite scroll) before post collection begins.

### 🔢 `parseEngagement(cardText)` — Extract Reaction/Comment Counts

```js
function parseEngagement(cardText = '') {
  const reactionMatch = cardText.match(/([\d,\.]+\s*[Kk]?)\s+reactions?/i);
  const commentMatch  = cardText.match(/([\d,\.]+\s*[Kk]?)\s+comments?/i);
  if (reactionMatch) reactionCount = parseCount(reactionMatch[1]);
  if (commentMatch)  commentCount  = parseCount(commentMatch[1]);
  return { reactionCount, commentCount };
}
```
- Uses regex to extract counts from text like `"1.2K reactions · 45 comments"`.
- `([\d,\.]+\s*[Kk]?)` captures: digits, commas, dots, optional space + optional K/k (e.g. `"1.2K"`, `"45"`, `"1,234"`).
- `\s+reactions?/i`: matches "reaction" or "reactions", case-insensitive.

```js
function parseCount(str = '') {
  const s = str.replace(/,/g, '').trim().toUpperCase();
  if (s.includes('K')) return Math.round(parseFloat(s) * 1000);
  return parseInt(s) || 0;
}
```
- Removes commas (e.g., `"1,234"` → `"1234"`).
- If contains `K` (e.g., `"1.2K"`): `parseFloat("1.2K") * 1000` → `1200`.
- Otherwise: plain `parseInt`.
- `|| 0`: defaults to 0 if parsing fails.

### 👤 `isRealAuthorName(name)` — Filter Fake Names

```js
function isRealAuthorName(name = '') {
  if (!name || name.length < 3 || name.length > 80) return false;
  const fakePatterns = [
    /^feed post/i, /^linkedin member/i, /^unknown/i,
    /^sponsored/i, /^promoted/i, /^\d+$/,
    /^see more/i, /^following/i, /^like$/i, ...
  ];
  if (fakePatterns.some((re) => re.test(lower))) return false;
  if (!/[a-zA-Z]/.test(name)) return false;
  return true;
}
```
LinkedIn's DOM contains many accessibility labels and UI text that look like "names" but aren't. This function validates that an extracted name is actually a person name:
- Length 3–80 chars.
- Doesn't match known fake patterns (feed labels, action button texts).
- Contains at least one letter.

### 📋 `parseAuthorFromLines(lines)` — Extract Author from Card Text

```js
function parseAuthorFromLines(lines) {
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const ln = lines[i];
    const wc = ln.split(/\s+/).filter(Boolean).length;  // word count
```
Scans the first 15 lines of a post card's text content to find the author name and headline. `wc` counts words by splitting on whitespace and counting non-empty parts.

```js
    if (!ln || ln.length > 80 || ln.includes('http')) {
      if (authorName) break;   // stop if we already found the name
      continue;                // skip this line
    }
```
Skips blank lines, long lines (>80 chars), and URLs. If we already found the author name and hit a weird line, stop searching.

```js
    if (!authorName) {
      if (wc >= 1 && wc <= 8 && isRealAuthorName(ln)) {
        authorName = ln;    // found the name (1-8 word line that passes the real-name test)
        bodyStart  = i + 1; // post body starts on next line
      }
    } else if (!authorHeadline && wc <= 14) {
      authorHeadline = ln;  // next short line after name = headline
      bodyStart = i + 1;
    } else {
      break;                // stop once we have name + headline
    }
```
- First 1–8 word valid name → set as `authorName`.
- Next line ≤14 words → set as `authorHeadline`.
- Stop after finding both.

```js
  const postText = lines.slice(bodyStart).join(' ').trim();
  return { authorName: authorName || 'Unknown', authorHeadline, postText };
}
```
Everything after the name/headline lines is joined as the post body text.

---

### 🔎 Three Post Collection Strategies

The bot uses 3 different DOM strategies and stops at the first one that finds posts. This provides fallback reliability if LinkedIn changes its HTML structure.

#### Strategy A+B: `collectByLinkWalk(page)` — Follow Post Links

```js
const anchors = new Set([
  ...document.querySelectorAll('a[href*="/posts/"]'),
  ...document.querySelectorAll('a[href*="/feed/update/"]'),
  ...document.querySelectorAll('a[href*="ugcPost"]'),
  ...document.querySelectorAll('a[href*="activity"]'),
]);
```
Finds ALL anchor tags whose `href` contains known LinkedIn post URL patterns. Uses a `Set` to automatically deduplicate (same link found multiple times in DOM).

```js
if (/\/(company|jobs|learning|messaging|notifications|mynetwork)\//.test(href)) continue;
```
Skips links to other LinkedIn sections that aren't posts (companies, job listings, messages, etc.).

```js
let el = anchor.parentElement;
let cardText = '';
for (let d = 0; d < 25 && el && el.tagName !== 'BODY'; d++) {
  const t = (el.innerText || '').trim();
  if (t.length >= 150 && t.length <= 30000) { cardText = t; break; }
  el = el.parentElement;
}
```
Walks UP the DOM tree from the link (up to 25 levels) to find the post card container. The card is identified by having 150–30,000 characters of text (too small = not a post, too large = entire page).

#### Strategy C: `collectByDataUrn(page)` — Use LinkedIn's Data Attributes

```js
const elems = document.querySelectorAll('[data-urn*="activity"],[data-id*="activity"],[data-entity-urn]');
for (const el of elems) {
  const urn = el.getAttribute('data-urn') || el.getAttribute('data-id') || el.getAttribute('data-entity-urn') || '';
  const match = urn.match(/activity[:\-](\d+)/);
  if (!match) continue;
  const postUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${match[1]}/`;
```
LinkedIn embeds post identifiers in custom `data-urn` or `data-entity-urn` HTML attributes. This strategy extracts the numeric activity ID from URNs like `urn:li:activity:7234567890` and builds the post URL.

#### Strategy D: `collectByBodyText(page)` — Parse Raw Page Text

```js
const bodyText = await page.evaluate(() => document.body.innerText || '');
const chunks  = bodyText.split(/\n{2,}/);
for (const chunk of chunks) {
  if (trimmed.length < 120 || trimmed.length > 5000) continue;
  if (trimmed.split(/\s+/).length < 10) continue;
  const lower = trimmed.toLowerCase();
  if (/^(home|my network|jobs|messaging|notifications|search)/.test(lower)) continue;
```
Last resort: reads ALL visible text from the page and splits it into chunks by double newlines. Filters out short chunks, nav labels, and huge blocks. Less precise (no URLs), only used if strategies A–C fail.

### 🔄 `dedup(posts)` — Remove Duplicates

```js
function dedup(posts) {
  const seenUrls = new Set();
  const seenText = new Set();
  return posts.filter((p) => {
    const textKey = p.postText.slice(0, 60);
    if (seenText.has(textKey)) return false;
    seenText.add(textKey);
    if (p.postUrl) {
      if (seenUrls.has(p.postUrl)) return false;
      seenUrls.add(p.postUrl);
    }
    return true;
  });
}
```
Removes posts that appear more than once. Two deduplication methods:
1. **URL dedup**: Same URL → same post. Uses a `Set` which provides O(1) lookup.
2. **Text dedup**: First 60 chars of post text as a key. Catches cases where the same post appears with slightly different URLs.

---

### 🏆 `findOneInterestingPost(page, commentedUrls, recentAuthors)` — Main Selector

```js
async function findOneInterestingPost(page, commentedUrls = new Set(), recentAuthors = new Set()) {
  await ensureOnFeed(page);
  await scrollFeed(page, 10);
```
First ensures we're on the feed and loads more posts by scrolling.

```js
  const strategies = [
    { name: 'Link-walk (/posts/ + /feed/update/)', fn: () => collectByLinkWalk(page) },
    { name: 'data-urn walk',                       fn: () => collectByDataUrn(page) },
    { name: 'body.innerText parse',                fn: () => collectByBodyText(page) },
  ];

  for (const { name, fn } of strategies) {
    const found = await fn();
    if (found.length > 0) { posts = found; break; }
  }
```
Tries each strategy in order, stops at the first one that returns posts. If all return 0, exits with `null`.

```js
  posts = dedup(posts);
  const total = posts.length;
```
Deduplicates and stores the total count (used for recency score calculation).

```js
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];

    if (!post.postUrl) { continue; }                          // must have a URL
    if (commentedUrls.has(post.postUrl)) { continue; }        // already commented
    const { skip, reason } = shouldSkip(post.authorName, post.authorHeadline, post.postText);
    if (skip) { continue; }                                   // failed hard filter

    if (recentAuthors.has((post.authorName || '').toLowerCase())) { continue; }  // 7-day cooldown
```
For each candidate post, applies all gates in sequence:
1. Must have a URL (Strategy D posts may not have one).
2. URL must not be in the `commentedUrls` set (already interacted).
3. Must pass the `shouldSkip()` hard content/author filters.
4. Author must not be in `recentAuthors` (7-day cooldown — avoid spamming the same person).

```js
    const { reactionCount, commentCount } = parseEngagement(post.cardText || '');
    const { total: score, breakdown, shouldComment } = compositeScore({
      postText: post.postText,
      authorHeadline: post.authorHeadline,
      reactionCount,
      commentCount,
      positionIndex: i,
      totalPosts: total,
    });
```
Parses engagement from the card text and calculates the full composite score.

```js
    const mark = shouldComment ? '[✓]' : '[✗]';
    console.log(`  ${mark} ${nameStr} | score:${score} (H:${breakdown.heuristic} E:${breakdown.engagement} S:${breakdown.seniority} N:${breakdown.niche} R:${breakdown.recency}) | ${engStr}`);

    if (shouldComment) {
      candidates.push({ ...post, reactionCount, commentCount, compositeScore: score, breakdown });
    }
```
Logs every evaluated post with its full score breakdown. The `mark` shows `[✓]` (passes) or `[✗]` (too low score). Only posts with `shouldComment: true` (score ≥ 30) are added to `candidates`.

```js
  candidates.sort((a, b) => b.compositeScore - a.compositeScore);
  const winner = candidates[0];
```
Sorts candidates by descending score (highest first). Takes the best one. The `sort()` comparator `b - a` produces descending order.

---

## 📁 `src/linkedin/commenter.js` — Posts the Comment

### `postComment(page, postUrl, commentText)` — 7-Step Comment Flow

```js
await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);
const url = page.url();
if (url.includes('/login') || url.includes('/checkpoint')) { return false; }
```
**Step 1 – Navigate:** Goes to the post URL. After loading, checks if LinkedIn redirected to a login/checkpoint page (session expired). Returns `false` to abort.

```js
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(400);
}
```
**Step 2 – Scroll:** Scrolls down gently to reveal the action bar (Like, Comment, Share buttons) which may be below the fold.

```js
const likeSelectors = [
  'button[aria-label*="React Like"][aria-pressed="false"]',
  'button[aria-label="Like"][aria-pressed="false"]',
];
for (const sel of likeSelectors) {
  const btn = page.locator(sel).first();
  if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await btn.click();
    break;
  }
}
```
**Step 3 – Like:** Tries multiple CSS selectors to find a "Like" button that hasn't been pressed yet (`aria-pressed="false"`). If found and visible, clicks it. The `.catch(() => false)` prevents errors if the selector times out.

```js
const boxSelectors = [
  '.ql-editor[contenteditable="true"]',
  '[contenteditable="true"][data-placeholder*="comment" i]',
];
```
**Step 4 – Find comment box:** LinkedIn uses a Quill rich text editor for comments. Tries known CSS selectors. The `.ql-editor` class is Quill's stable class name.

```js
await commentBox.click();
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
await commentBox.type(commentText, { delay: 50 + Math.random() * 40 });
```
**Step 5 – Type:** Clicks the box, selects all (Ctrl+A), deletes (Clear), then types the comment with a realistic per-character delay (50–90ms). `element.type()` triggers React's `onChange` event — necessary because LinkedIn uses React to manage the input state.

```js
const submitSelectors = [
  'button[aria-label="Comment"]',
  'button[aria-label="Post comment"]',
  'button.comments-comment-box__submit-button',
  'button:has-text("Comment")',
  'button:has-text("Post")',
];
for (const sel of submitSelectors) {
  const btn = page.locator(sel).last();
  if (await btn.isVisible({ timeout: 2000 })) {
    await btn.click();
    submitted = true;
    break;
  }
}
```
**Step 6 – Submit:** Tries multiple selectors to find the blue "Comment" submit button. Uses `.last()` because Playwright's `:has-text("Comment")` might match multiple elements — the last one is typically the most specific (innermost in the DOM).

```js
const errorDismissed = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="alertdialog"]')];
  for (const d of dialogs) {
    if (d.innerText.toLowerCase().includes('error') || d.innerText.includes('something went wrong')) {
      const btn = d.querySelector('button');
      if (btn) btn.click();
      return true;
    }
  }
  return false;
});
```
**Step 7 – Error check:** After submission, looks for LinkedIn dialog boxes with error messages (rate limiting, technical errors). If found, dismisses them by clicking the button inside the dialog.

```js
const snippet = commentText.slice(0, 40).toLowerCase();
const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
if (pageText.includes(snippet)) { return true; }
```
**Verification:** Checks if the first 40 characters of the comment text now appear in the page — confirming the comment was posted. If the submit button was clicked but the text isn't visible yet (page not refreshed), still returns `true`.

---

## 🔄 Complete Post Selection Flow

```
bot.js: main()
  │
  ├── Step 1: Load commentedUrls (CSV) + recentAuthors (7-day filter)
  │
  ├── Step 2: findOneInterestingPost(page, commentedUrls, recentAuthors)
  │     │
  │     ├── ensureOnFeed()        → navigate to /feed/
  │     ├── scrollFeed(10 passes) → load posts into DOM
  │     │
  │     ├── Strategy A: collectByLinkWalk()  → find /posts/ and /feed/update/ links
  │     ├── Strategy B: collectByDataUrn()   → find data-urn="activity:..." elements
  │     └── Strategy C: collectByBodyText()  → parse raw page text as fallback
  │           │
  │           └── dedup() → remove duplicate posts
  │
  ├── For each unique post:
  │     ├── ❌ Skip if no URL
  │     ├── ❌ Skip if already commented (commentedUrls)
  │     ├── ❌ Skip if shouldSkip() → OTW / student / job post / grief
  │     ├── ❌ Skip if author in 7-day cooldown
  │     │
  │     └── ✅ compositeScore() → calculate 0-100 score
  │               H(40%) + E(25%) + S(15%) + N(10%) + R(10%)
  │
  ├── Sort candidates by score (highest first)
  └── Return winner (highest-scored post)

  ↓

  postComment(page, winner.postUrl, generatedComment)
    ├── Navigate to post URL
    ├── Like the post
    ├── Open comment box
    ├── Type comment (human-like delays)
    ├── Submit via button
    └── Verify text appears on page
```

## 📊 Score Threshold Reference

| Score | Meaning |
|-------|---------|
| 0–29 | Skip — not worth engaging |
| 30–49 | Acceptable — will comment if no better option |
| 50–69 | Good post — relevant content, decent author |
| 70–84 | Strong post — senior author, niche-relevant, great engagement |
| 85–100 | Ideal — founder/CEO, your exact niche, sweet-spot engagement |
