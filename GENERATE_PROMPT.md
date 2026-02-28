# 📝 GENERATE PROMPT — Line-by-Line Code Explanation

> **Files covered:** `src/config.js`, `src/ai/commentStyles.js`, `src/ai/gemini.js`
> **What this covers:** How the bot builds AI prompts, picks comment styles, and generates human-like LinkedIn comments.

---

## 📁 `src/config.js` — Central Configuration

```js
'use strict';
```
Enables JavaScript strict mode — catches common bugs like undeclared variables.

```js
require('dotenv').config();
```
Loads the `.env` file. After this line, every `KEY=VALUE` in `.env` is accessible as `process.env.KEY`.

```js
geminiApiKey: process.env.GEMINI_API_KEY || '',
openaiApiKey: process.env.OPENAI_API_KEY || '',
```
Reads API keys from environment. If missing, defaults to empty string `''` (no crash).

```js
bot: {
  maxCommentsPerRun: parseInt(process.env.MAX_COMMENTS_PER_RUN || '10', 10),
  minDelayMs: parseInt(process.env.MIN_DELAY_MS || '3000', 10),
  maxDelayMs: parseInt(process.env.MAX_DELAY_MS || '8000', 10),
  minInterestScore: parseInt(process.env.MIN_INTEREST_SCORE || '40', 10),
},
```
- `maxCommentsPerRun`: Max comments in one run (default 10).
- `minDelayMs`/`maxDelayMs`: Random delay range 3–8 seconds between actions (looks human).
- `minInterestScore`: Only comment if post scores ≥ this value (0–100 scale, default 40).
- `parseInt(..., 10)`: Converts string env vars to base-10 integers.

```js
browser: {
  headless: process.env.HEADLESS === 'true',
  sessionDir: process.env.SESSION_DIR || './session',
},
```
- `headless`: If `HEADLESS=true`, browser runs invisibly. The `=== 'true'` does strict string comparison.
- `sessionDir`: Folder for saved browser cookies/login session so you don't log in every time.

```js
schedule: {
  timezone: process.env.SCHEDULE_TIMEZONE || 'Asia/Karachi',
  startHour: parseInt(process.env.SCHEDULE_START_HOUR || '9', 10),
  endHour: parseInt(process.env.SCHEDULE_END_HOUR || '22', 10),
  activeDays: (process.env.SCHEDULE_ACTIVE_DAYS || '1,2,3,4,5,6')
    .split(',')
    .map((d) => parseInt(d.trim(), 10)),
},
```
Controls *when* the bot is allowed to run.
- `timezone`: Used for time-of-day checks (default: Pakistan Standard Time, UTC+5).
- `startHour`/`endHour`: Bot only runs between 9 AM and 10 PM.
- `activeDays`: `'1,2,3,4,5,6'` → `.split(',')` → `['1','2',...,'6']` → `.map(parseInt)` → `[1,2,3,4,5,6]` (Mon–Sat). Day `0` = Sunday.

```js
profile: {
  name: process.env.MY_NAME || 'Ubaid Waris',
  headline: process.env.MY_HEADLINE || 'Full Stack Developer | Next.js | Node.js | React | DevOps',
  about: process.env.MY_ABOUT || 'I build scalable web applications...',
},
```
Your LinkedIn identity. **These values are injected directly into the AI prompt** so generated comments sound like *you* wrote them, not a generic bot.

```js
module.exports = config;
```
Makes the config object available for any other file to `require('../config')`.

---

## 📁 `src/ai/commentStyles.js` — 6 Comment Writing Strategies

### The Styles Array

```js
const COMMENT_STYLES = [
  { id: 'experiential', label: 'Share Personal Experience', instruction: `...` },
  { id: 'contrarian',   label: 'Gentle Contrarian Take',   instruction: `...` },
  { id: 'analytical',   label: 'Add Analytical Depth',     instruction: `...` },
  { id: 'question',     label: 'Thoughtful Question',      instruction: `...` },
  { id: 'parallel',     label: 'Draw a Parallel',          instruction: `...` },
  { id: 'builder',      label: 'Builder Perspective',      instruction: `...` },
];
```
An array of 6 style objects. Each has:
- `id`: Machine identifier used to track recent usage.
- `label`: Human-readable name (shown in logs).
- `instruction`: The exact text injected into the AI prompt to shape the writing angle.

| Style | What It Does |
|-------|-------------|
| `experiential` | Reference a real past developer experience |
| `contrarian` | Respectfully disagree or add nuance |
| `analytical` | Expand on trade-offs / second-order effects |
| `question` | Ask one expert-level question |
| `parallel` | Connect the post to a known engineering pattern |
| `builder` | React as someone who has shipped a product |

### Style Memory

```js
const recentStyleIds = [];
```
In-memory array that tracks which styles were *recently* used this session. Starts empty on each bot run.

### `pickRandomStyle()`

```js
function pickRandomStyle() {
  const available = COMMENT_STYLES.filter((s) => !recentStyleIds.includes(s.id));
  const pool = available.length > 0 ? available : COMMENT_STYLES;
```
- Filters styles by removing those whose `id` appears in `recentStyleIds`.
- If all 6 styles are in the recent list (impossible in practice), falls back to the full list.

```js
  const picked = pool[Math.floor(Math.random() * pool.length)];
```
Picks a random entry: `Math.random()` gives a float 0–1, multiply by array length, `Math.floor` rounds down to a valid integer index.

```js
  recentStyleIds.push(picked.id);
  if (recentStyleIds.length > 3) recentStyleIds.shift();
  return picked;
}
```
- Pushes the picked style's ID into the memory array.
- If it grows beyond 3, `.shift()` removes the oldest (front) element.
- Returns the full style object `{ id, label, instruction }`.

---

## 📁 `src/ai/gemini.js` — AI Engine (OpenAI + Gemini)

### 🔌 Lazy Client Initialization

```js
let openaiClient = null;
let geminiModel  = null;
```
Both AI clients start as `null`. They're only created on first use (lazy loading) — saves startup time and avoids errors if a key is missing.

```js
function getOpenAI() {
  if (!openaiClient) {
    const { OpenAI } = require('openai');
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openaiClient;
}
```
If the client doesn't exist yet, imports `openai` package and creates a client with the API key. Returns the cached client on subsequent calls.

```js
function getGemini() {
  if (!geminiModel) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }
  return geminiModel;
}
```
Same lazy-load pattern for Gemini. Uses `gemini-1.5-flash` — Google's fast, capable model.

```js
function hasOpenAI() {
  return !!(config.openaiApiKey && config.openaiApiKey.startsWith('sk-') && config.openaiApiKey.length > 20);
}
function hasGemini() {
  return !!(config.geminiApiKey && config.geminiApiKey.length > 20);
}
```
Provider detection helpers. The `!!` converts truthy/falsy to strict `true`/`false`. OpenAI keys must start with `'sk-'` (standard format) and be > 20 chars.

---

### 🚀 `generateText(systemPrompt, userPrompt)` — Core AI Caller

```js
async function generateText(systemPrompt, userPrompt) {
  if (hasOpenAI()) {
    try {
      const ai = getOpenAI();
      const res = await ai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        max_tokens: 400,
        temperature: 0.85,
      });
      return res.choices[0].message.content.trim();
```
- `async`: This function calls external APIs, so it uses `await` and returns a Promise.
- OpenAI is tried first.
- `model: 'gpt-4o-mini'`: Fast, cheap OpenAI model.
- `messages`: Two-message format — `system` sets the AI's role, `user` provides the actual task.
- `max_tokens: 400`: Caps response length (prevents expensive long outputs).
- `temperature: 0.85`: Controls creativity. 0 = robotic/deterministic, 1 = very random. 0.85 gives natural variation.
- `res.choices[0].message.content.trim()`: OpenAI returns an array of choices — takes the first one and strips whitespace.

```js
    } catch (e) {
      if (hasGemini()) {
        console.log('  OpenAI failed, trying Gemini:', e.message.slice(0, 60));
      } else {
        throw e;
      }
    }
  }
```
If OpenAI throws (rate limit, bad key, network error): if Gemini exists → log and fall through; if not → re-throw so the bot exits with a clear error.

```js
  if (hasGemini()) {
    const m = getGemini();
    const result = await m.generateContent(systemPrompt + '\n\n' + userPrompt);
    return result.response.text().trim();
  }
  throw new Error('No working AI provider. Set OPENAI_API_KEY or GEMINI_API_KEY in .env');
}
```
Gemini fallback. Gemini uses a single string input (no role separation), so the prompts are joined with `\n\n`. `result.response.text()` extracts the plain text. If neither provider works, throws a descriptive error.

---

### 🧠 `scorePostInterest(postText, authorName)` — Rate a Post 0–100

This function asks the AI: *"Is this post worth commenting on?"*

**System prompt:**
```
You are a professional LinkedIn engagement advisor. Respond ONLY with valid JSON — no markdown, no explanation.
```
Setting the AI's role. The "ONLY valid JSON" instruction prevents the AI from adding prose or markdown code fences.

**User prompt structure (injected values):**
- `✅ Score HIGH` criteria: founder/CEO/engineer authors, tech/AI content, posts with opinions/stories.
- `❌ Score LOW` criteria: job seekers, hiring posts, generic quotes, reshares without commentary.
- `Post by: ${authorName}` — injects the actual author name.
- `${postText.slice(0, 1200)}` — only first 1200 chars (token limit management).
- Required JSON format: `{"score": <0-100>, "reason": "...", "interesting": true|false}`

**Response parsing:**
```js
const raw = await generateText(systemPrompt, userPrompt);
const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
const parsed = JSON.parse(cleaned);
```
- Strips ` ```json ` and ` ``` ` markdown fences in case the AI added them despite instructions.
- `JSON.parse()` converts the string to a JavaScript object.

**Result construction:**
```js
return {
  score:       typeof parsed.score === 'number' ? parsed.score : 0,
  reason:      parsed.reason || '',
  interesting: parsed.interesting === true && (parsed.score || 0) >= config.bot.minInterestScore,
};
```
- Uses the score only if it's actually a number (defensive coding).
- `interesting` is only `true` if the AI says so AND the score meets the config threshold.

---

### 💬 `generateComment(postText, authorName, commentStyle)` — Write the Comment

```js
const { name, headline, about } = config.profile;
```
Destructures your profile data. Using destructuring: `{ name, headline, about } = obj` is equivalent to `const name = obj.name; const headline = obj.headline; ...`

```js
const styleInstruction = commentStyle
  ? `\nYour writing approach — "${commentStyle.label}":\n${commentStyle.instruction}\n`
  : '';
```
Ternary operator: if `commentStyle` is truthy (a style was passed in), builds the injection string. Otherwise empty string.

**System prompt:**
```
You are writing a LinkedIn comment on behalf of Ubaid Waris, a Full Stack Developer.
Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.
```
`headline.split('|')[0].trim()` takes `"Full Stack Developer | Next.js | ..."` → splits on `|` → takes index 0 → `"Full Stack Developer "` → trims → `"Full Stack Developer"`.

**User prompt key sections:**
- `About ${name}: ${about}` — your bio so the AI writes in your voice.
- `${styleInstruction}` — the writing strategy (experiential, contrarian, etc.).
- `Post text...${postText.slice(0, 1500)}` — the post content (first 1500 chars).
- **Rules:** 1–2 sentences, max 180 chars, no emojis, no "Great post!", reference something specific from the post, conversational tone.
- **Required JSON:** `{ interest_score, why_interesting, best_angle, comment }`

**Fallback mode:**
```js
} catch (e) {
  const fallbackPrompt = `Write a 1-2 sentence LinkedIn comment as ${name}...
Write ONLY the comment text:`;
  const raw = await generateText(systemPrompt, fallbackPrompt);
  return { comment: raw.trim(), interestScore: 50, ... };
}
```
If JSON parsing fails, sends a simpler prompt asking for raw text (no JSON requirement). More forgiving, ensures a comment is always generated.

---

### 📊 `estimateHeuristic(text)` — No-AI Fallback Scorer

```js
function estimateHeuristic(text) {
  let score = 0;
  const t = text.toLowerCase();
  if (text.length > 300) score += 20;   // longer = more content
  if (text.length > 600) score += 10;
  const good = ['startup','founder','product','engineer',...];
  for (const kw of good) if (t.includes(kw)) score += 5;  // +5 per keyword
  if (t.includes('hiring for') && text.length < 200) score -= 30;
  if (t.includes('open to work')) score -= 40;
  return Math.min(100, Math.max(0, score));  // clamp to 0-100
}
```
Pure keyword counting — no API calls. Used when AI is unavailable. `Math.min(100, Math.max(0, score))` ensures the score never goes below 0 or above 100.

```js
module.exports = { generateComment, scorePostInterest };
```
Only exports the two public API functions. `generateText` and `estimateHeuristic` are internal helpers.

---

## 🔄 Prompt Generation Flow

```
bot.js
  │
  ├── 1. pickRandomStyle()
  │       Picks 1 of 6 styles (avoids last 3 used)
  │       Returns: { id, label, instruction }
  │
  ├── 2. generateComment(postText, authorName, style)
  │       │
  │       ├── Builds systemPrompt: "You are Ubaid Waris..."
  │       ├── Builds userPrompt:  post + your bio + style instruction + rules
  │       │
  │       └── generateText(systemPrompt, userPrompt)
  │               ├── Try OpenAI (gpt-4o-mini, temp=0.85, max_tokens=400)
  │               └── Fallback → Gemini (gemini-1.5-flash)
  │
  └── 3. Returns { comment, interestScore, whyInteresting, bestAngle }
```

## ⚙️ Config Values That Affect Prompts

| `.env` Key | Default | Effect |
|---|---|---|
| `MY_NAME` | `Ubaid Waris` | Name injected into AI prompt |
| `MY_HEADLINE` | `Full Stack Developer...` | Role context in system prompt |
| `MY_ABOUT` | `I build scalable...` | Bio shapes comment voice |
| `MIN_INTEREST_SCORE` | `40` | Minimum score to proceed |
| `OPENAI_API_KEY` | _(empty)_ | Primary AI provider |
| `GEMINI_API_KEY` | _(empty)_ | Fallback AI provider |
