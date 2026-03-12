'use strict';
/**
 * connectionNote.js — AI-generated LinkedIn connection note
 *
 * Uses the existing OpenAI / Gemini provider (same key from .env).
 * Priority: OpenAI → Gemini → static template fallback.
 *
 * EXPORTS:
 *   generateConnectionNote(name, headline, location, templates)
 *     → string (note, max 295 chars)
 */

const config = require('../config');

// ── Lazy clients (same pattern as gemini.js) ──────────────────────

let _openaiClient = null;
let _geminiModel  = null;

function hasOpenAI() {
  return !!(config.openaiApiKey && config.openaiApiKey.startsWith('sk-') && config.openaiApiKey.length > 20);
}
function hasGemini() {
  return !!(config.geminiApiKey && config.geminiApiKey.length > 20);
}

function getOpenAI() {
  if (!_openaiClient) {
    const { OpenAI } = require('openai');
    _openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return _openaiClient;
}

function getGemini() {
  if (!_geminiModel) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const g = new GoogleGenerativeAI(config.geminiApiKey);
    _geminiModel = g.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }
  return _geminiModel;
}

// ── Prompt ────────────────────────────────────────────────────────

function buildPrompt(name, headline, location) {
  const firstName = (name || 'there').split(' ')[0];
  const { name: myName, headline: myHeadline, about: myAbout } = config.profile;

  return {
    system: `You are writing a short, sincere LinkedIn connection request note on behalf of ${myName}. 
Write in first person as ${myName}. Sound like a real human professional, not an AI or a sales pitch.
Keep it warm, brief, and specific to the recipient's role. NEVER be generic or templated-sounding.
Return ONLY the note text — no quotes, no explanation, no subject line.`,

    user: `Write a LinkedIn connection request note to ${firstName}.

About ${firstName}:
- Name: ${name}
- Headline: ${headline || 'tech professional'}
- Location: ${location || 'not specified'}

About me (${myName}):
${myHeadline}
${myAbout}

Rules:
- Address them by first name: "${firstName}"
- Reference something SPECIFIC from their headline (their role or company type)
- Mention I'm a Full-Stack developer working on SaaS / AI tooling — but keep it brief
- The goal is to connect with decision-makers and founders, NOT to pitch immediately
- Sound like a peer reaching out, not a vendor
- End with a friendly close (e.g. "Would love to connect!")
- NO hashtags, NO emojis, NO "I came across your profile" cliché, NO em-dashes
- HARD LIMIT: 170 characters total. Count carefully. Be concise.

Return ONLY the note text.`,
  };
}

// ── AI call ───────────────────────────────────────────────────────

async function callAI(systemPrompt, userPrompt) {
  // OpenAI first
  if (hasOpenAI()) {
    try {
      const ai  = getOpenAI();
      const res = await ai.chat.completions.create({
        model:       'gpt-4o-mini',   // cheap + fast for short notes
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        max_tokens:  120,
        temperature: 0.80,
      });
      console.log('    [AI] Note generated via OpenAI gpt-4o-mini');
      return res.choices[0].message.content.trim();
    } catch (e) {
      if (!hasGemini()) throw e;
      console.log('    [connectionNote] OpenAI failed, falling back to Gemini:', e.message.slice(0, 60));
    }
  }

  // Gemini fallback
  if (hasGemini()) {
    const m      = getGemini();
    const result = await m.generateContent(systemPrompt + '\n\n' + userPrompt);
    console.log('    [AI] Note generated via Gemini');
    return result.response.text().trim();
  }

  throw new Error('No AI provider available for connection note generation.');
}

// ── Static template fallback ──────────────────────────────────────

function staticFallback(name, headline, templates) {
  if (!templates || templates.length === 0) {
    const firstName = (name || 'there').split(' ')[0];
    return `Hi ${firstName}, I'm a Full-Stack dev building SaaS and AI tools. Your background caught my eye, would love to connect!`.slice(0, 190);
  }
  const template  = templates[Math.floor(Math.random() * templates.length)];
  const firstName = (name || 'there').split(' ')[0];
  const roleGuess = headline
    ? headline.split('|')[0].split(' at ')[0].trim().split(' ').slice(0, 3).join(' ')
    : 'tech';
  return template
    .replace(/{firstName}/g, firstName)
    .replace(/{role}/g,      roleGuess)
    .slice(0, 190);
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Generate a personalised LinkedIn connection note using AI.
 *
 * @param {string}   name       - Recipient's full name
 * @param {string}   headline   - Recipient's LinkedIn headline
 * @param {string}   location   - Recipient's location (from search card)
 * @param {string[]} templates  - Fallback static templates (from connection-config.js)
 * @returns {Promise<string>}   - Note text (≤ 295 chars)
 */
async function generateConnectionNote(name, headline, location, templates = []) {
  if (!hasOpenAI() && !hasGemini()) {
    console.log('    [connectionNote] No AI key — using static template.');
    return staticFallback(name, headline, templates);
  }

  try {
    const { system, user } = buildPrompt(name, headline, location);
    let note = await callAI(system, user);

    // Strip any accidental quotes
    note = note.replace(/^["']|["']$/g, '').trim();

    // Enforce 190-char hard cap (LinkedIn free limit is 200, -10 for safety)
    if (note.length > 190) {
      // Trim at last sentence boundary if possible
      const trimmed = note.slice(0, 187);
      const lastPeriod = trimmed.lastIndexOf('.');
      note = lastPeriod > 120 ? trimmed.slice(0, lastPeriod + 1) : trimmed + '...';
    }

    // Sanity: too short means AI hallucinated or failed
    if (note.length < 20) {
      return staticFallback(name, headline, templates);
    }

    return note;
  } catch (e) {
    console.log(`    [connectionNote] AI error: ${e.message.slice(0, 80)}. Using static template.`);
    return staticFallback(name, headline, templates);
  }
}

module.exports = { generateConnectionNote };
