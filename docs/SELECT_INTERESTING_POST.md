# 🔍 SELECT INTERESTING POST — Detailed Code Summary

> **Files covered:** `src/linkedin/feed.js`, `src/linkedin/filters.js`
> **What this covers:** How the bot navigates the feed, collects posts using 3 DOM strategies, applies hard filters, scores each candidate with a 6-dimension composite formula, and returns the single highest-scored post the bot hasn't already interacted with.

---

## 📁 `src/linkedin/filters.js` — Content Filtering & Scoring

This file decides **which posts to skip entirely** and **which to score**. It exports two main functions: `shouldSkip()` (hard filters) and `compositeScore()` (weighted ranking).

---

### 🚫 Skip Signal Lists (Hard Filters)

These lists are checked before any scoring occurs. If a post matches any of them, it's rejected immediately.

#### `OTW_SIGNALS` — Open To Work Detection
```js
const OTW_SIGNALS = [
  'open to work', 'open to opportunities', '#opentowork', 'open for work',
  '#openforwork', 'actively seeking', 'actively looking', 'available for hire',
  'available for opportunities', 'job seeker', '#jobseeker', 'seeking employment',
  'seeking a role', 'seeking new role', 'looking for a job', 'looking for work',
  'looking for opportunities', 'looking for my next', 'in search of',
  'open for job', '#hireme', '#lookingforjob',
];
```
Phrases that identify a person actively job-seeking. Checked in the author name, headline, **and** first 400 chars of the post text. Commenting on job-seekers offers no authority-building value.

#### `STUDENT_SIGNALS` — Junior/Student Detection
```js
const STUDENT_SIGNALS = [
  'student', 'undergraduate', 'bsc student', 'btech student', 'cs student',
  'intern', 'internship', 'fresher', 'fresh graduate', 'recent graduate',
  'new graduate', 'entry level', 'junior developer', 'aspiring developer',
  'bootcamp', 'coding bootcamp', 'self-taught', 'self taught',
  'learning to code', 'learning programming', ...
];
```
Identifies students, interns, and entry-level individuals. Commenting on their posts gives minimal professional exposure.

#### `JOB_POST_SIGNALS` — Job Advertisement Detection
```js
const JOB_POST_SIGNALS = [
  "we're hiring", 'we are hiring', 'now hiring', 'join our team', 'apply now',
  'apply here', 'send your cv', 'job opening', '#hiring', '#vacancy', '#recruitment', ...
];
```
Identifies recruiter/company job listings. High engagement, but zero authority value for commenting.

#### `SENTIMENT_SKIP_SIGNALS` — Grief / Tragedy Detection
```js
const SENTIMENT_SKIP_SIGNALS = [
  'lost my', 'passed away', 'rest in peace', 'rip ', 'diagnosed with', 'cancer',
  'funeral', 'grieving', 'laid off today', 'just got laid off', 'suicide',
  'depression', 'struggling mentally', 'tragedy', 'devastating news', ...
];
```
Posts about personal tragedy or mental health crises. The bot **never** comments on these — automated empathy is inappropriate.

---

### 📈 Scoring Signal Lists

These shape the quality and relevance scores — they don't hard-reject, they adjust the numeric score.

#### `NICHE_SIGNALS` — Expertise Relevance (Full Stack / AI)
```js
const NICHE_SIGNALS = [
  // Backend / infra
  'nodejs', 'node.js', 'backend', 'api design', 'rest api', 'graphql',
  'microservices', 'distributed systems', 'system design', 'architecture',
  'kubernetes', 'docker', 'devops', 'ci/cd', 'deployment',
  // Frontend / full-stack
  'nextjs', 'next.js', 'react', 'typescript', 'full stack', 'fullstack',
  // AI / automation
  'ai workflow', 'automation', 'n8n', 'llm', 'ai agent', 'openai', 'gemini',
  'langchain', 'rag', 'prompt engineering',
  // General high-value
  'saas', 'startup', 'founder', 'cto', 'ceo', 'product', 'engineering',
  'developer experience', 'open source', 'shipped', 'launched',
];
```
Each keyword match adds **+15 niche points** (capped at 100). Posts matching 7+ signals = perfect niche relevance.

#### `SENIORITY_SIGNALS` — Author Headline Rank
```js
const SENIORITY_SIGNALS = [
  ['founder', 25], ['co-founder', 25], ['ceo', 25], ['cto', 22],
  ['chief', 20],   ['vp ', 20],        ['vice president', 20], ['partner', 18],
  ['director', 15],['head of', 15],    ['principal', 14],
  ['staff engineer', 14],              ['staff software', 14],
  ['engineering manager', 12],         ['product manager', 12],
  ['sr.', 10],     ['senior', 10],     ['lead ', 10],
];
```
`[keyword, points]` tuples, checked against the author's LinkedIn headline. First match wins (ordered highest first). Raw points × 4 = seniority score (e.g., `founder` → 25 × 4 = 100). Unknown headline defaults to 20 neutral points.

**Follower Proxy Boosts** (applied on top):
- `creator` / `newsletter` in headline → **+15 pts**
- `angel` / `investor` in headline → **+10 pts**
- Max seniority is capped at **80** before proxy boost, total at **100**.

#### `GOOD_SIGNALS` — Content Quality Keywords
```js
const GOOD_SIGNALS = [
  'startup', 'founder', 'product', 'engineering', 'developer', 'software',
  'ai', 'machine learning', 'devops', 'architecture', 'design', 'backend',
  'leadership', 'team', 'lesson', 'learned', 'mistake', 'failure',
  'growth', 'scale', 'strategy', 'decision', 'insight', 'opinion',
  'built', 'shipped', 'launched', 'revenue', 'mrr', 'bootstrap',
  'open source', 'automation', 'workflow', 'experience', 'story',
];
```
Each match adds **+5 points** to the heuristic score. Posts with real insights, opinions, or stories score higher.

#### `BAD_SIGNALS` — Engagement Bait / Low-Value Patterns
```js
const BAD_SIGNALS = [
  'motivational quote', 'agree?', 'share if you agree',
  'repost if', 'double tap', 'humble', 'blessed', 'grateful for',
  'like if', 'comment below', 'what do you think?',
];
```
Each match subtracts **-10 points** from the heuristic score.

#### `STORY_ARC_SIGNALS` — Narrative Content Boost
```js
const STORY_ARC_SIGNALS = [
  'started', 'failed', 'learned', 'realized', 'after 3 years', 'in 2020',
  'in 2021', 'in 2022', 'we almost', 'i almost',
];
```
If **2 or more** story-arc words are found → **+20 points** heuristic bonus. Story-driven posts invite more meaningful replies.

#### `AI_SPAM_SIGNALS` — AI-Generated Content Penalty
```js
const AI_SPAM_SIGNALS = [
  'in today's fast paced world', 'as we navigate', 'it is important to',
  'here are 5 lessons', 'here are 3 lessons', 'delve into', "let's dive in",
];
```
Each match → **-20 points** heuristic penalty. Generic AI-generated posts don't merit thoughtful engagement.

#### `ENGAGEMENT_POD_SIGNALS` — Pod Thread Penalty
```js
const ENGAGEMENT_POD_SIGNALS = [
  'nice one bro', 'dm sent', 'check inbox', 'interested', 'great post',
  'thanks for sharing', 'commenting for reach',
];
```
Checked against visible comments (up to 3). If **2+ pod phrases** are found in the thread → **-30 points** heavy heuristic penalty. Pod posts inflate engagement artificially.

---

### 🛠 Helper Functions

#### `lc(...parts)`
```js
function lc(...parts) {
  return parts.filter(Boolean).join(' ').toLowerCase();
}
```
Joins multiple strings (filtering out nulls) into one lowercase string. Used everywhere for case-insensitive keyword matching.

#### `hasAny(text, signals)`
```js
function hasAny(text, signals) {
  return signals.some((s) => {
    const kw = Array.isArray(s) ? s[0] : s;
    return text.includes(kw);
  });
}
```
Returns `true` if `text` includes ANY signal keyword. Handles both plain strings and `[kw, pts]` tuples.

#### `clamp(val, min, max)`
```js
function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }
```
Ensures a numeric value stays within `[min, max]`. Used throughout to keep scores in 0–100.

---

### 🚫 Hard-Filter Function: `shouldSkip(authorName, authorHeadline, postText)`

```js
function shouldSkip(authorName = '', authorHeadline = '', postText = '') {
  // Reject LinkedIn UI labels being parsed as author names
  if (/^(suggested|promoted|sponsored|advertisement|people you may know|news)$/i.test(authorName.trim()))
    return { skip: true, reason: `LinkedIn UI label as author: "${authorName}"` };

  // Reject social-activity "reshare" cards (X commented on this, X likes this)
  if (/\bcommented on\b|\blikes? this\b|\bshared this\b|\breacted to\b|\breposted this\b/i.test(authorName))
    return { skip: true, reason: 'Social activity card (reshare/reaction) — skip' };

  if (isOpenToWork(authorName, authorHeadline, postText))
    return { skip: true, reason: 'Author is Open To Work' };
  if (isStudent(authorName, authorHeadline, postText))
    return { skip: true, reason: 'Author appears to be a student / junior' };
  if (isJobPost(postText))
    return { skip: true, reason: 'Post is a job advertisement' };
  if (isSentimentPost(postText))
    return { skip: true, reason: 'Post is about grief / tragedy — skip out of respect' };
  if (postText.length < 80)
    return { skip: true, reason: 'Post text is too short (< 80 chars)' };

  return { skip: false, reason: '' };
}
```

Runs all checks **in priority order**. Returns `{ skip: true, reason }` on first match (early-exit = efficient). All checks pass → `{ skip: false }`.

---

### 📊 Composite Scoring Sub-functions

The composite score is built from **6 independent sub-scores**, each normalized to 0–100, then combined with weights.

#### 1. `calcHeuristicScore(postText, commentsData)` — Content Quality (weight: **35%**)

```js
function calcHeuristicScore(postText = '', commentsData = []) {
  if (postText.length < 100) return 0;    // Too short = no content
  let score = 0;
  if (postText.length > 300)  score += 15; // Medium length bonus
  if (postText.length > 600)  score += 10; // Long-form bonus
  if (postText.length > 1000) score += 5;  // Very detailed bonus

  for (const kw of GOOD_SIGNALS)    if (t.includes(kw)) score += 5;   // +5 per good keyword
  for (const kw of BAD_SIGNALS)     if (t.includes(kw)) score -= 10;  // -10 per bad keyword

  // Story arc boost: 2+ narrative keywords = +20
  let storyWordCount = 0;
  for (const kw of STORY_ARC_SIGNALS) if (t.includes(kw)) storyWordCount++;
  if (storyWordCount >= 2) score += 20;

  // AI spam penalty: -20 per AI-spam phrase
  for (const kw of AI_SPAM_SIGNALS) if (t.includes(kw)) score -= 20;

  // Engagement pod penalty: -30 if 2+ pod keywords in comments
  if (commentsData && commentsData.length > 0) {
    let podHits = 0;
    const commentsText = commentsData.join(' ').toLowerCase();
    for (const kw of ENGAGEMENT_POD_SIGNALS) if (commentsText.includes(kw)) podHits++;
    if (podHits >= 2) score -= 30;
  }

  return clamp(score, 0, 100);
}
```

**Contextual modifiers** applied in `compositeScore()` on top of this base:
- **Early Traction Boost:** 15–150 reactions AND ≤40 comments → `+15` — post is gaining momentum
- **Network Proximity Boost:** author is a 1st-degree connection → `+15`
- **Post Format:** text post `+10`, image `+5`, poll `-10` — text posts invite text responses
- **Comment Depth Opportunity:** visible comments average length < 50 chars → `+20` — shallow thread, easier to stand out
- **Author Reply Probability:** author has replied to existing comments → `+20` — they're actively engaging

#### 2. `calcEngagementScore(reactionCount, commentCount)` — Engagement (weight: **15%**)

```js
function calcEngagementScore(reactionCount = 0, commentCount = 0) {
  if (reactionCount < 5)     return 25;  // Very new / unparsed — reduced penalty
  if (reactionCount > 10000) return 15;  // Viral = noisy, buried comment
  if (commentCount > 200)    return 10;  // Overcrowded thread

  const reactionScore = Math.log10(reactionCount + 1) * 20;  // Log-scale 0~60
  const sweetSpot = (reactionCount >= 20 && reactionCount <= 500) ? 20 : 0;  // +20 bonus
  return clamp(reactionScore + sweetSpot, 0, 100);
}
```

Key design decisions:
| Condition | Score | Reason |
|-----------|-------|--------|
| `< 5 reactions` | 25 | May be brand new — don't overly penalize |
| `> 10,000 reactions` | 15 | Viral — your comment disappears in noise |
| `> 200 comments` | 10 | Too crowded to be visible |
| **20–500 reactions** | **+20 bonus** | Sweet spot — momentum without noise |
| Log scale otherwise | 0–60 | Smooth growth, prevents linear dominance |

**Time Momentum Bonus:** If `postAge` contains `"m •"` (minutes old) or `"1h •"` AND reactions ≥ 50 → additional **+20** to engagement score.

#### 3. `calcCommentVisibilityScore(commentCount)` — Visibility Potential (weight: **15%**)

```js
function calcCommentVisibilityScore(commentCount = 0) {
  if (commentCount <= 5)   return 90;   // Early comments get maximum exposure
  if (commentCount <= 20)  return 100;  // Perfect — some discussion, still discoverable
  if (commentCount <= 50)  return 75;
  if (commentCount <= 100) return 50;
  if (commentCount <= 200) return 25;
  return 10;                            // Deep thread — you'll be buried
}
```

This **separate dimension** (introduced from old `engagement`) specifically measures the likelihood that your comment will be **seen** by other readers. A post with 20 comments is ideal — enough discussion to attract readers, few enough that your comment is prominent.

#### 4. `calcSeniorityScore(authorHeadline)` — Author Seniority (weight: **15%**)

```js
function calcSeniorityScore(authorHeadline = '') {
  const hl = authorHeadline.toLowerCase();

  let proxyBoost = 0;
  if (hl.includes('creator') || hl.includes('newsletter')) proxyBoost += 15;
  if (hl.includes('angel') || hl.includes('investor'))     proxyBoost += 10;

  let rawScore = 20; // neutral default
  for (const [kw, pts] of SENIORITY_SIGNALS) {
    if (hl.includes(kw)) {
      rawScore = pts * 4;
      break; // ordered descending — take highest match
    }
  }

  return clamp(Math.min(rawScore, 80) + proxyBoost, 0, 100);
}
```

- Raw seniority capped at 80 to prevent a single high-rank author from dominating the overall score.
- Proxy boosts for creators/investors on top (reflecting their large audiences).

#### 5. `calcNicheScore(postText)` — Niche Relevance (weight: **10%**)

```js
function calcNicheScore(postText = '') {
  let hits = 0;
  for (const kw of NICHE_SIGNALS) if (t.includes(kw)) hits++;
  return clamp(hits * 15, 0, 100);
}
```

Counts niche keyword matches. Each hit = **+15 pts** (7 hits maxes out at 100). Ensures the bot comments where its expertise is most credible.

#### 6. `calcRecencyScore(positionIndex, totalPosts, postAge)` — Recency (weight: **10%**)

```js
function calcRecencyScore(positionIndex = 0, totalPosts = 10, postAge = '') {
  let score = 50;
  if (totalPosts > 0) {
    const ratio = 1 - (positionIndex / totalPosts);
    score = ratio * 100;
  }
  // Boost for posts timestamped as minutes or 1h old
  const lowerAge = (postAge || '').toLowerCase();
  if (lowerAge.includes('m •') || lowerAge.includes('1h •')) {
    score += 20;
  }
  return clamp(score, 0, 100);
}
```

Since the bot doesn't navigate to each post to read its timestamp, **feed position** serves as a recency proxy (earlier in feed = more recent). The `postAge` string (scraped from `.update-components-actor__sub-description`) provides a real boost when the post is confirmed to be minutes or 1 hour old.

---

### 🏆 `compositeScore(post)` — Master Scorer

```js
function compositeScore(post) {
  let heuristic  = calcHeuristicScore(postText, commentsData);
  let engagement = calcEngagementScore(reactionCount, commentCount);
  const seniority  = calcSeniorityScore(authorHeadline);
  const niche      = calcNicheScore(postText);
  let recency    = calcRecencyScore(positionIndex, totalPosts, postAge);
  const visibility = calcCommentVisibilityScore(commentCount);

  // --- Contextual modifiers applied to heuristic ---
  if (reactionCount >= 15 && reactionCount <= 150 && commentCount <= 40) heuristic += 15; // Early traction
  if (isConnection)  heuristic += 15;   // 1st-degree network
  if (postFormat === 'text')   heuristic += 10;
  if (postFormat === 'image')  heuristic += 5;
  if (postFormat === 'poll')   heuristic -= 10;
  if (commentsData.length > 0) {
    const avgLen = commentsData.reduce((acc, c) => acc + c.length, 0) / commentsData.length;
    if (avgLen < 50) heuristic += 20; // Shallow thread — easy to stand out
  }
  if (authorReplied) heuristic += 20;  // Author is actively engaging

  // --- Time momentum: boost engagement if trending now ---
  if ((lowerAge.includes('m •') || lowerAge.includes('1h •')) && reactionCount >= 50) {
    engagement += 20;
  }

  heuristic  = clamp(heuristic, 0, 100);
  engagement = clamp(engagement, 0, 100);

  // --- Weighted composite ---
  const total = (heuristic  * 0.35)
              + (engagement * 0.15)
              + (visibility * 0.15)
              + (seniority  * 0.15)
              + (niche      * 0.10)
              + (recency    * 0.10);

  return {
    total: Math.round(clamp(total, 0, 100)),
    breakdown: { heuristic, engagement, seniority, niche, recency, visibility },
    shouldComment: total >= 30,
  };
}
```

**Weight table:**

| Dimension | Weight | Signal |
|-----------|--------|--------|
| Heuristic (content quality) | **35%** | Real content, story arcs, no AI spam |
| Engagement | **15%** | Reaction sweet spot, viral avoidance |
| Visibility | **15%** | Comment thread depth — will yours be seen? |
| Seniority | **15%** | Author title → audience size |
| Niche | **10%** | Matches your expertise cluster |
| Recency | **10%** | Feed position + confirmed post age |

> **Note:** Old formula was `H×40 + E×25 + S×15 + N×10 + R×10`. The current formula adds `Visibility` as a separate 15% axis and redistributes weight accordingly.

---

## 📁 `src/linkedin/feed.js` — Feed Scraper & Post Finder

### 🧭 `ensureOnFeed(page)` — Navigate to LinkedIn Feed

```js
async function ensureOnFeed(page) {
  if (page.url().includes('linkedin.com/feed')) return;  // already there
  const clicked = await page.evaluate(() => {
    const l = document.querySelector('a[href="/feed/"]') ||
              document.querySelector('a[href="https://www.linkedin.com/feed/"]');
    if (l) { l.click(); return true; }
    return false;
  });
  if (!clicked) {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await sleep(4000);
}
```

- Checks current URL first (no navigation if already on feed).
- Tries to click the nav link in-page (mimics human behaviour).
- Falls back to hard `page.goto()` only if the nav link is missing.
- Uses `sleep(4000)` — a plain `Promise/setTimeout` wrapper since Playwright's `waitForTimeout` was removed in newer versions.

---

### 📜 `scrollFeed(page, passes = 10)` — Human-Like Scrolling with Keyboard Events

```js
async function scrollFeed(page, passes = 10) {
  try { await page.click('body', { force: true }); } catch (_) {}

  for (let i = 0; i < passes; i++) {
    const amount = 600 + Math.floor(Math.random() * 700); // 600–1300 px
    await page.evaluate((px) => {
      // Find the actual scrollable container via computed overflow
      let container = null;
      for (const sel of ['.scaffold-layout__main', 'div[class*="scaffold-finite-scroll"]', ...]) {
        const el = document.querySelector(sel);
        if (el && (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 100) {
          container = el; break;
        }
      }
      if (container) container.scrollBy(0, px);
      else window.scrollBy(0, px);
    }, amount);

    if (i % 3 === 2) {
      await page.keyboard.press('End'); // triggers LinkedIn's virtual scroll loader
      await sleep(400);
    }
    await sleep(700 + Math.floor(Math.random() * 500));
  }

  // Final flush — scroll deepest container fully to bottom
  await page.evaluate(() => { /* scroll everything to bottom */ });
  await page.keyboard.press('End');
  await sleep(1800);
}
```

Key improvements over naive scrolling:
- **Detects the real scroll container** — LinkedIn often puts `overflow:hidden` on `<main>` but scrolls an inner `.scaffold-layout__main` div. The function probes computed `overflowY` to find the actual scrollable ancestor.
- **Randomized amounts** (600–1300 px) and **randomized delays** (700–1200ms) — defeats bot-detection pattern recognition.
- **Keyboard `End` every 3rd pass** — fires a native keyboard event that triggers LinkedIn's virtual scroll (infinite feed loader).
- **Final flush** at the end ensures the full feed is loaded before scraping.

---

### 🔢 `parseEngagement(cardText)` — Extract Reaction/Comment Counts

```js
function parseEngagement(cardText = '') {
  const reactionMatch = cardText.match(/([\d,\.]+\s*[KkMm]?)\s*(?:reactions?|likes?)/i);
  const commentMatch  = cardText.match(/([\d,\.]+\s*[KkMm]?)\s*comments?/i);
  if (reactionMatch) reactionCount = parseCount(reactionMatch[1]);
  if (commentMatch)  commentCount  = parseCount(commentMatch[1]);
  return { reactionCount, commentCount };
}

function parseCount(str = '') {
  const s = str.replace(/,/g, '').trim().toUpperCase();
  if (s.includes('M')) return Math.round(parseFloat(s) * 1_000_000);
  if (s.includes('K')) return Math.round(parseFloat(s) * 1000);
  return parseInt(s) || 0;
}
```

- Regex matches `"1.2K reactions"`, `"45 comments"`, `"1,234 likes"`, `"2M reactions"` etc.
- `parseCount` handles **M (millions)**, **K (thousands)**, commas, and decimals.
- Returns `{ reactionCount: 0, commentCount: 0 }` if the card text doesn't contain these strings (e.g., brand-new post with no engagement yet).

---

### 👤 `isRealAuthorName(name)` — Filter LinkedIn UI Noise

```js
function isRealAuthorName(name = '') {
  if (!name || name.length < 3 || name.length > 80) return false;
  const fakePatterns = [
    /^feed post/i, /^linkedin member/i, /^unknown/i, /^post number/i,
    /^sponsored/i, /^promoted/i, /^\d+$/,
    /^see more/i, /^following/i, /^follow$/i, /^connect$/i,
    /^message$/i, /^like$/i, /^comment$/i, /^share$/i, /^send$/i,
    /^suggested$/i, /^people you may know$/i, /^news$/i, /^advertisement$/i,
    /\bcommented on\b/i, /\blikes? this\b/i, /\bshared this\b/i,
    /\breacted to\b/i, /\breposted this\b/i,
  ];
  if (fakePatterns.some((re) => re.test(name.toLowerCase()))) return false;
  if (!/[a-zA-Z]/.test(name)) return false;
  return true;
}
```

LinkedIn's DOM contains many accessibility labels and action-button texts. This guard ensures only genuine human/company names are accepted as authors. Validates:
1. Length 3–80 characters.
2. Does not match any known fake pattern.
3. Contains at least one letter (not a pure number or symbol).

---

### 📋 `parseAuthorFromLines(lines)` — Extract Author Name, Headline, Post Text

```js
function parseAuthorFromLines(lines) {
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const ln = lines[i];
    const wc = ln.split(/\s+/).filter(Boolean).length;

    if (!ln || ln.length > 80 || ln.includes('http')) {
      if (authorName) break;  // stop if name already found
      continue;
    }
    if (!authorName && wc >= 1 && wc <= 8 && isRealAuthorName(ln)) {
      authorName = ln;        // First short valid line = author name
      bodyStart  = i + 1;
    } else if (!authorHeadline && wc <= 14) {
      authorHeadline = ln;    // Next short line = job headline
      bodyStart = i + 1;
    } else {
      break;
    }
  }
  const postText = lines.slice(bodyStart).join(' ').trim();
  const isConnection = authorHeadline.toLowerCase().includes('1st') ||
                       lines.slice(0, 3).some(l => l.toLowerCase().includes('1st'));
  return { authorName: authorName || 'Unknown', authorHeadline, postText, isConnection };
}
```

Parses the raw card text (which is just a flat string of lines) into structured fields:
- Scans only the **first 15 lines** (performance — author/headline always appear at the top).
- `authorName`: first line with 1–8 words that passes `isRealAuthorName()`.
- `authorHeadline`: next line with ≤14 words (LinkedIn headlines are concise).
- `postText`: everything after those two lines joined into one string.
- `isConnection`: heuristically detected by the presence of `"1st"` (LinkedIn's 1st-degree badge).

---

### 🔎 Three Post Collection Strategies

The bot tries strategies in order, stopping at the **first one that finds posts**. This makes scraping resilient to LinkedIn's frequent DOM changes.

---

#### Strategy A/B: `collectByLinkWalk(page)` — Follow Post Anchor Tags

```js
const anchors = new Set([
  ...document.querySelectorAll('a[href*="/posts/"]'),
  ...document.querySelectorAll('a[href*="/feed/update/"]'),
  ...document.querySelectorAll('a[href*="ugcPost"]'),
  ...document.querySelectorAll('a[href*="activity"]'),
]);
```

Finds all anchor tags with known LinkedIn post URL patterns. Uses a `Set` for automatic deduplication (the same link often appears multiple times in the DOM as timestamp, image, and text links all point to the same post).

```js
if (/\/(company|jobs|learning|messaging|notifications|mynetwork|groups)\//.test(href)) continue;
```
Skips navigation links to other LinkedIn sections.

```js
let el = anchor.parentElement;
for (let d = 0; d < 25 && el && el.tagName !== 'BODY'; d++) {
  const t = (el.innerText || '').trim();
  if (t.length >= 150 && t.length <= 30000) { cardText = t; break; }
  el = el.parentElement;
}
```
Walks **up** the DOM tree (up to 25 levels) to find the post card container, identified by having 150–30,000 characters of text.

**Additional data collected per post (both strategies A/B and C):**
- `postFormat` — `text`, `image`, `video`, `audio`, `carousel`, `poll` (via DOM class selectors)
- `commentsData` — text of up to 3 visible comments (for engagement pod detection)
- `authorReplied` — whether the post author has already replied in the thread
- `postAge` — text content of `.update-components-actor__sub-description` (e.g., `"2h • Edited"`)
- `profileUrl` — the author's `/in/` or `/company/` profile link

---

#### Strategy C: `collectByDataUrn(page)` — LinkedIn Data Attributes + Base64 Decoding

Primary selector:
```js
const elems = document.querySelectorAll(
  '[data-urn*="activity"],[data-id*="activity"],[data-entity-urn],' +
  '[data-view-name="feed-full-update"],' +
  '[role="listitem"][componentkey*="FeedType_"]'
);
```

LinkedIn embeds post identifiers in HTML attributes. This strategy reads them directly. For LinkedIn's **new layout** (which no longer uses `data-urn` attributes), it uses a multi-step `extractPostUrl(el)` function:

1. **New layout `componentkey`:** `componentkey="expanded<base64>FeedType_..."` → decode base64 to get activity ID
2. **Inner card `componentkey`:** bare base64url string 30–60 chars → decode
3. **Plaintext URN in HTML:** `urn:li:activity:\d{15,}` → extract directly
4. **URL-encoded URN:** `urn%3Ali%3Aactivity%3A\d{15,}` → decode and extract
5. **Inner child componentkeys:** scan child elements for base64 patterns
6. **Legacy `data-testid`:** `data-testid="<base64>-commentLists"` → decode base64

**`decodeUrnBase64(b64url)`** — Two decode strategies:
- **Strategy A (protobuf varint):** Tries reading a protobuf variable-length integer at byte offsets 0–11. A valid LinkedIn snowflake ID is in range `6e18–9.99e18`.
- **Strategy B (fixed-int64 window):** Slides an 8-byte window across the decoded bytes, reading both little-endian and big-endian int64 values — covers LinkedIn's `proto fixed64` field encoding.

---

#### Strategy D: `collectByBodyText(page)` — Raw Page Text Fallback

```js
const bodyText = await page.evaluate(() => document.body.innerText || '');
const chunks  = bodyText.split(/\n{2,}/);
for (const chunk of chunks) {
  if (trimmed.length < 120 || trimmed.length > 5000) continue;
  if (trimmed.split(/\s+/).length < 10) continue;
  if (/^(home|my network|jobs|messaging|notifications|search|suggested)/.test(lower)) continue;
  // ... parse with parseAuthorFromLines
}
```

Last resort — reads all visible text from the page and splits it into paragraphs by double newlines. Much less precise (no post URLs), but works even if LinkedIn's HTML structure changes completely.

---

### 🔄 `dedup(posts)` — Remove Duplicate Posts

```js
function dedup(posts) {
  const seenUrls = new Set();
  const seenText = new Set();
  return posts.filter((p) => {
    const textKey = p.postText.slice(0, 60);
    if (seenText.has(textKey)) return false;
    seenText.add(textKey);
    if (p.postUrl) {
      const id = extractPostId(p.postUrl);
      if (seenUrls.has(id)) return false;
      seenUrls.add(id);
    }
    return true;
  });
}
```

Two-pass deduplication:
1. **Text key:** First 60 characters of post text — catches duplicates with different URLs (reshares, etc.).
2. **URL ID:** Extracts the numeric activity ID from the URL via `extractPostId()` (from `src/data/csv.js`) — catches the same post with different URL parameters.

---

### 🏆 `findOneInterestingPost(page, commentedUrls, recentAuthors, thresholds)` — Main Selector

```js
async function findOneInterestingPost(
  page,
  commentedUrls  = new Set(),
  recentAuthors  = new Set(),
  thresholds     = [80, 70, 60]
) {
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | Playwright Page | The browser page |
| `commentedUrls` | `Set<string>` | Post IDs already commented on (from CSV) |
| `recentAuthors` | `Set<string>` | Lowercase author names commented on in last 7 days |
| `thresholds` | `number[]` | Fallback score thresholds — tries highest first |

**Step-by-step flow:**

```js
await ensureOnFeed(page);
await scrollFeed(page, 10);
```
Step 1: Navigate to feed, scroll 10 passes to load posts.

```js
for (const { name, fn } of strategies) {
  const found = await fn();
  if (found.length > 0) { posts = found; break; }
}
```
Step 2: Try strategies A → B → C in order. Stop at first success.

```js
posts = dedup(posts);
const total = posts.length;
```
Step 3: Deduplicate. Record total (needed for recency score ratio).

```js
for (let i = 0; i < posts.length; i++) {
  if (!post.postUrl) { /* skip */ continue; }
  if (commentedUrls.has(postId)) { /* skip */ continue; }
  const { skip } = shouldSkip(post.authorName, post.authorHeadline, post.postText);
  if (skip) continue;
  if (recentAuthors.has(post.authorName?.toLowerCase())) continue; // 7-day cooldown
```
Step 4: For each post, apply all gates:
1. Must have a valid URL.
2. Must not be in `commentedUrls` (already interacted).
3. Must pass all `shouldSkip()` hard filters.
4. Author must not be in `recentAuthors` (7-day cooldown — prevents repeated engagement with same person).

```js
  const { total: score, breakdown } = compositeScore({
    postText, authorHeadline, reactionCount, commentCount,
    positionIndex: i, totalPosts: total,
  });
  if (score >= thresholds[thresholds.length - 1]) {
    candidates.push({ ...post, compositeScore: score, breakdown });
  }
```
Step 5: Score each candidate. Add to `candidates` if score ≥ the minimum threshold (`thresholds` last element = lowest fallback).

```js
// Find the highest threshold that has at least one candidate
let activeThreshold = thresholds[thresholds.length - 1];
for (const t of thresholds) {
  if (candidates.some(c => c.compositeScore >= t)) { activeThreshold = t; break; }
}
const validCandidates = candidates.filter(c => c.compositeScore >= activeThreshold);
validCandidates.sort((a, b) => b.compositeScore - a.compositeScore);
const winner = validCandidates[0];
```
Step 6: **Dynamic threshold selection** — tries the highest threshold (e.g., 80) first. If no candidate meets it, falls back to 70, then 60. This ensures the bot always picks the best available post, tightening standards when high-quality posts are available and relaxing them gracefully when they aren't.

Step 7: Sort survivors descending by score. Return the winner (index 0 = highest).

---

### 🔄 `getFeedPostsBatch(page, passes)` — Batch Extractor for the Main Loop

```js
async function getFeedPostsBatch(page, passes = 5) {
  await ensureOnFeed(page);
  await scrollFeed(page, passes);

  // Run ALL strategies, aggregate results (not first-wins)
  for (const { name, fn } of strategies) {
    const found = await fn();
    posts = posts.concat(found); // combine all
  }

  return dedup(posts);
}
```

Unlike `findOneInterestingPost` which stops at the first successful strategy, `getFeedPostsBatch`:
- Runs **all three strategies** and combines their results.
- Returns the full deduplicated batch **without scoring or filtering** — scoring is done by the calling orchestrator in `bot.js`.
- Used by `bot.js`'s main loop to get a large pool of posts, then evaluate them sequentially.

---

## 🔄 Complete Post Selection Flow

```
bot.js: main()
  │
  ├── Load commentedUrls (CSV) + recentAuthors (7-day CSV filter)
  │
  ├── getFeedPostsBatch() OR findOneInterestingPost()
  │     ├── ensureOnFeed()            → navigate to /feed/
  │     ├── scrollFeed(10 passes)     → load posts into DOM (End key every 3rd pass)
  │     │
  │     ├── Strategy A: collectByLinkWalk()    → /posts/ and /feed/update/ anchors
  │     ├── Strategy B: collectByDataUrn()     → data-urn / componentkey + base64 decode
  │     └── Strategy C: collectByBodyText()    → raw page text fallback
  │           │
  │           └── dedup() → deduplicate by URL-ID + text prefix
  │
  ├── For each unique post:
  │     ├── ❌ Skip if no URL
  │     ├── ❌ Skip if already commented (commentedUrls)
  │     ├── ❌ Skip if shouldSkip() → OTW / student / job post / grief / UI label / short text
  │     ├── ❌ Skip if author in 7-day cooldown (recentAuthors)
  │     │
  │     └── ✅ compositeScore()   →   0-100 weighted score
  │          ┌──────────────────────────────────────────────┐
  │          │ H(35%) Heuristic  + E(15%) Engagement        │
  │          │ + V(15%) Visibility + S(15%) Seniority        │
  │          │ + N(10%) Niche + R(10%) Recency               │
  │          └──────────────────────────────────────────────┘
  │
  ├── Dynamic threshold: try 80 → 70 → 60 (first with ≥1 match wins)
  ├── Filter by active threshold
  ├── Sort descending by score
  └── Return winner (highest-scored post)
```

---

## 📊 Score Threshold Reference

| Score | Meaning |
|-------|---------|
| 0–29  | Skip — not worth engaging |
| 30–49 | Acceptable — will comment if no better option |
| 50–69 | Good post — relevant content, decent author |
| 70–84 | Strong post — senior author, niche-relevant, great engagement |
| 85–100| Ideal — founder/CEO, your exact niche, sweet-spot engagement |

**Dynamic thresholds** (`[80, 70, 60]` default): The bot tries to find a post scoring 80+, falls back to 70+, then 60+. This means the bot picks the best available post on every run rather than always applying a single fixed bar.

---

## 📌 Key Design Decisions Summary

| Decision | Rationale |
|----------|-----------|
| 3 DOM strategies with fallback | LinkedIn frequently changes its HTML; resilience through redundancy |
| Hard filters run before scoring | Avoids wasting CPU cycles computing scores for invalid posts |
| 7-day author cooldown checked inside loop | Falls through to next candidate rather than aborting the entire run |
| Log scale for engagement | Prevents viral posts with 50k reactions from dominating linearly |
| Visibility as separate dimension | Decoupled from raw engagement — you can have high reactions but poor comment visibility |
| Dynamic threshold array | Adapts quality bar to what's actually available in each feed batch |
| `postAge` string from DOM | Provides real-time recency signal beyond just feed position proxy |
| Base64 + protobuf decode for URNs | Handles LinkedIn's new `componentkey` layout that no longer uses `data-urn` |
