# 🤖 LinkedIn Comment Bot

A Node.js bot that logs into LinkedIn **once**, saves the session locally, scrapes posts from your target founders/CEOs, generates **AI-powered comments** via Google Gemini, and posts them — tracking everything in CSV files to avoid duplicate comments.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🔐 **Session Persistence** | Login once, never again. Cookies saved to `session/` folder |
| 🤖 **Gemini AI Comments** | Generates thoughtful, human-like 2-3 sentence comments |
| 📋 **CSV Tracking** | Tracks commented posts in `data/commented_posts.csv` |
| 🎯 **Target Profiles** | Add any LinkedIn profile URL to `data/target_profiles.csv` |
| 🏠 **Feed Fallback** | If no targets set, scrapes your home feed |
| 🐌 **Human-like Delays** | Random delays between actions to stay safe |

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
npx playwright install chromium
```

### 2. Configure your `.env`
```bash
copy .env.example .env
```
Then edit `.env` and fill in:
- `GEMINI_API_KEY` — your [Google Gemini API key](https://aistudio.google.com/app/apikey)
- `LINKEDIN_EMAIL` and `LINKEDIN_PASSWORD` (optional — for auto-fill on first run)

### 3. Add target profiles
Edit `data/target_profiles.csv` and add the LinkedIn profile URLs you want to comment on:
```csv
profile_url,name,category
https://www.linkedin.com/in/bill-gates/,Bill Gates,founder
https://www.linkedin.com/in/jeff-weiner-08b306/,Jeff Weiner,ceo
```

### 4. Run the bot
```bash
node bot.js
```

**First run:** A visible Chrome window opens → LinkedIn login page appears → log in manually → press **Enter** in the terminal → session saved! ✅

**All future runs:** Bot skips login entirely and goes straight to commenting.

---

## 📁 Project Structure

```
linkedin-me/
├── bot.js                      ← Main entry point
├── .env                        ← Your config (not committed)
├── .env.example                ← Template
├── src/
│   ├── config.js               ← Centralized settings
│   ├── browser/
│   │   └── session.js          ← Session management (Playwright)
│   ├── linkedin/
│   │   ├── feed.js             ← Post scraper
│   │   └── commenter.js        ← Comment poster
│   ├── ai/
│   │   └── gemini.js           ← Gemini AI comment generator
│   └── data/
│       └── csv.js              ← CSV read/write utilities
├── data/
│   ├── target_profiles.csv     ← Who to engage with (you edit this)
│   └── commented_posts.csv     ← Auto-managed, tracks what's been commented
└── session/                    ← Browser session (auto-created, not committed)
```

---

## ⚙️ Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Your Gemini API key |
| `LINKEDIN_EMAIL` | *(optional)* | Auto-fills email on login page |
| `LINKEDIN_PASSWORD` | *(optional)* | Auto-fills password on login page |
| `MAX_COMMENTS_PER_RUN` | `10` | Max comments per bot run |
| `MIN_DELAY_MS` | `3000` | Min delay between actions (ms) |
| `MAX_DELAY_MS` | `8000` | Max delay between actions (ms) |
| `HEADLESS` | `false` | `true` to hide browser window |
| `SESSION_DIR` | `./session` | Where to store browser session |

---

## 🔒 Safety Notes

- **Never re-comments**: tracked via `data/commented_posts.csv`
- **Human-like behavior**: random typing speed, random delays between actions
- **Visible browser**: runs with `HEADLESS=false` by default so it looks natural
- **Reasonable limits**: default 10 comments/run — don't increase this too much

---

## 🧹 Reset Session

If your session gets corrupted or LinkedIn asks you to log in again:
```bash
# Delete the session folder and re-run
rmdir /s /q session
node bot.js
```
