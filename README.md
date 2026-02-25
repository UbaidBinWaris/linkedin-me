# 🤖 LinkedIn Comment Bot

A Node.js automation tool that logs into LinkedIn, finds **one interesting post** from your home feed, and posts an **AI-generated, human-like comment** — using modular filters to avoid job-seekers, students, and OTW authors.

The browser **stays open** after commenting so you can keep browsing. Close it yourself from the terminal by pressing Enter.

---

## ✨ What It Does (Step by Step)

| Step | Action |
|------|--------|
| 1 | Validate AI API key |
| 2 | Prepare CSV data files |
| 3 | Launch browser + restore or create login session |
| 4 | Navigate to LinkedIn home feed |
| 5 | **Find ONE interesting post** (with author + content filters) |
| 6 | AI double-checks the post's interest score |
| 7 | Pick a random comment writing style |
| 8 | Generate a short, human-like AI comment |
| 9 | Post the comment on LinkedIn |
| 10 | Save to CSV — then **wait for you to press Enter to close** |

---

## 🚀 Quick Start

### 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Configure your .env

```bash
copy .env.example .env
```

Open `.env` and fill in at minimum:

```env
GEMINI_API_KEY=your_key_here      # or OPENAI_API_KEY=sk-...
LINKEDIN_EMAIL=you@example.com    # optional — auto-fills login
LINKEDIN_PASSWORD=yourpassword    # optional — auto-fills login
MY_NAME=Your Name
MY_HEADLINE=Your LinkedIn headline
MY_ABOUT=Short description of you used by the AI to write in your voice
```

### 3. Run the bot

```bash
node bot.js
```

**First run:** A Chrome window opens → LinkedIn login page appears. If you set `LINKEDIN_EMAIL` and `LINKEDIN_PASSWORD`, the form is auto-filled. Complete the login (including any 2FA), then **press Enter in the terminal** when you're on the feed. Session is saved — you won't need to log in again.

**All future runs:** Bot skips login and goes straight to the feed.

---

## 📁 Project Structure

```
linkedin-me/
├── bot.js                         ← Main entry point (run this)
├── .env                           ← Your config (not committed)
├── .env.example                   ← Copy this to .env
├── src/
│   ├── config.js                  ← All settings (reads from .env)
│   ├── browser/
│   │   └── session.js             ← Browser launch, login, session management
│   ├── linkedin/
│   │   ├── feed.js                ← Feed scraper + findOneInterestingPost()
│   │   ├── commenter.js           ← Comment poster (Playwright)
│   │   └── filters.js             ← Author + post filter logic (tunable)
│   ├── ai/
│   │   ├── gemini.js              ← AI comment generator (OpenAI + Gemini)
│   │   └── commentStyles.js       ← Comment writing styles (6 strategies)
│   └── data/
│       └── csv.js                 ← CSV read/write utilities
├── data/
│   ├── target_profiles.csv        ← (Optional) profiles to scrape
│   └── commented_posts.csv        ← Auto-tracked, prevents duplicate comments
└── session/                       ← Browser session files (auto-created)
```

---

## 🧠 How It Decides If a Post Is Interesting

### Step 1 — Author Filters (`src/linkedin/filters.js`)

The bot skips any post where the **author** shows any of these signals:

#### ❌ Open To Work / Job Seeking
Checked in author name, headline, and first 400 chars of post:
```
"open to work", "open to opportunities", "#opentowork", "actively seeking",
"actively looking", "available for hire", "job seeker", "#hireme",
"looking for a job", "looking for work", "seeking a role", ...
```

#### ❌ Student / Junior / Fresher
```
"student", "undergraduate", "intern", "fresher", "fresh graduate",
"recent graduate", "entry level", "aspiring developer", "bootcamp",
"self-taught", "learning to code", "1 year of experience", ...
```

#### ❌ Job Advertisement Posts
Checked in first 800 chars of post text:
```
"we're hiring", "now hiring", "join our team", "apply now",
"send your cv", "job opening", "#hiring", "#vacancy", "#recruitment", ...
```

### Step 2 — Heuristic Interest Score

Posts are scored 0–100 based on keyword matches:

**Boosts score:**  
`startup`, `founder`, `cto`, `ceo`, `saas`, `product`, `engineering`, `ai`,
`llm`, `devops`, `architecture`, `leadership`, `lesson`, `mistake`, `scale`,
`revenue`, `launch`, `mvp`, `bootstrap`, `shipped`, `opinion`, ...

**Penalizes score:**  
`motivational quote`, `agree?`, `thoughts?`, `repost if`, `humble`, `blessed`,
`share if you agree`, ...

Posts scoring below 20 (heuristic) are skipped.

### Step 3 — AI Interest Score

Gemini / OpenAI re-evaluates the post (0–100 scale). The threshold is set by `MIN_INTEREST_SCORE` in `.env` (default: 30). This is logged but does **not** block the post if it already passed the heuristic — it's a second opinion.

> 💡 To make the bot **more selective**, increase `MIN_INTEREST_SCORE` in `.env`.  
> To make it **comment on more posts**, lower it (minimum 0).

---

## 💬 How Comments Are Written

Comments are generated by AI using one of **6 rotating writing styles** (picked randomly each run):

| Style | What It Does |
|-------|-------------|
| **Share Personal Experience** | References a real, concrete developer experience related to the post |
| **Gentle Contrarian Take** | Respectfully disagrees with or adds nuance to a point in the post |
| **Add Analytical Depth** | Picks the most interesting claim and expands on trade-offs or WHY it works |
| **Thoughtful Question** | Asks a single specific, curious question that shows you actually read the post |
| **Draw a Parallel** | Connects the post to a pattern from software engineering or product development |
| **Builder Perspective** | Reacts from the point of view of someone who has actually built and shipped a product |

**All styles follow these hard rules:**
- Max 1–2 sentences, max 150 characters
- No emojis, no hashtags, no "Great post!" openers
- References something specific from the post
- Sounds conversational and human — not AI-generated
- Does not mention your own name or flatter the author

> 💡 To add your own style, open `src/ai/commentStyles.js` and push a new object into `COMMENT_STYLES`.

---

## ⚙️ Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required if no OpenAI)* | [Get here](https://aistudio.google.com/app/apikey) |
| `OPENAI_API_KEY` | *(optional)* | Used first if both are set |
| `LINKEDIN_EMAIL` | *(optional)* | Auto-fills login form on first run |
| `LINKEDIN_PASSWORD` | *(optional)* | Auto-fills login form on first run |
| `MIN_INTEREST_SCORE` | `30` | 0–100. Posts below this are skipped by AI scoring |
| `MIN_DELAY_MS` | `3000` | Min delay between actions (ms) |
| `MAX_DELAY_MS` | `8000` | Max delay between actions (ms) |
| `HEADLESS` | `false` | `true` to hide the browser window |
| `SESSION_DIR` | `./session` | Where browser session cookies are stored |
| `MY_NAME` | `Ubaid Waris` | Your name (AI writes comments in your voice) |
| `MY_HEADLINE` | see .env.example | Used in AI prompt context |
| `MY_ABOUT` | see .env.example | Used in AI prompt context |

---

## 🔧 Tuning the Filter Logic

All filter keywords live in **`src/linkedin/filters.js`** — you can edit the arrays at the top of that file:

```js
// Add more job-seeking signals
OTW_SIGNALS.push('seeking opportunities', 'available immediately');

// Add more student signals
STUDENT_SIGNALS.push('bsc 2025', 'csit student');

// Add more interesting topic keywords
GOOD_SIGNALS.push('distributed systems', 'rust', 'golang');
```

The filter functions are modular — each one can be used independently:

```js
const { isOpenToWork, isStudent, isJobPost, shouldSkip, heuristicInterestScore } = require('./src/linkedin/filters');
```

---

## 📋 CSV Data Files

### `data/commented_posts.csv` (auto-managed)
Tracks every post you've commented on. The bot reads this on startup to avoid double-commenting.

Format: `post_url, author_name, comment, timestamp`

### `data/target_profiles.csv` (optional, you edit this)
If you want to also scrape posts from specific LinkedIn profiles, add them here:

```csv
profile_url,name,category
https://www.linkedin.com/in/bill-gates/,Bill Gates,founder
https://www.linkedin.com/in/jeff-weiner-08b306/,Jeff Weiner,ceo
```

> Currently the main flow only uses the feed. Profile scraping is available in `feed.js` as `scrapeProfilePosts()` for custom use.

---

## 🔒 Safety Notes

- **No duplicate comments** — tracked via `data/commented_posts.csv`
- **Human-like behavior** — random typing speed, random delays between actions
- **Visible browser** — `HEADLESS=false` by default so it looks natural
- **You stay in control** — browser doesn't close until YOU press Enter
- **One comment per run** — no loops, no automation spam

---

## 🧹 Troubleshooting

### No posts found / all posts filtered out
1. The feed might not have loaded yet — try running again
2. Lower `MIN_INTEREST_SCORE` in `.env`
3. Check if the keywords in `GOOD_SIGNALS` (in `filters.js`) match your feed's content

### "Session expired" or LinkedIn login page appears mid-run
Delete the session folder and re-run:
```bash
# Windows
rmdir /s /q session
node bot.js

# macOS/Linux
rm -rf session
node bot.js
```

### Comment box not found
LinkedIn sometimes changes its DOM. Check `src/linkedin/commenter.js` selector arrays, they may need updating.

### AI returns empty comment
Check your API key in `.env`. Test Gemini separately with `node test-gemini.js`.

---

## 🏗 How to Extend

| Goal | Where to change |
|------|----------------|
| Add new OTW / student filter words | `src/linkedin/filters.js` → top arrays |
| Add a new comment writing style | `src/ai/commentStyles.js` → `COMMENT_STYLES` array |
| Score posts differently | `src/linkedin/filters.js` → `heuristicInterestScore()` |
| Change how AI generates comments | `src/ai/gemini.js` → `generateComment()` |
| Scrape profiles instead of feed | `src/linkedin/feed.js` → `scrapeProfilePosts()` |
| Change browser settings | `src/browser/session.js` → `launchBrowser()` |
