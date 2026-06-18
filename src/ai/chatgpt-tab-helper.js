const fs = require('fs');
const path = require('path');

let chatPage = null;

/**
 * Gets or creates the ChatGPT page in the existing browser context.
 * @param {object} context - The Playwright browser context.
 * @returns {Promise<object>} The Playwright page object for ChatGPT.
 */
async function getChatGPTPage(context) {
  if (chatPage) return chatPage;

  const urlFile = path.resolve(__dirname, '../../openai_chat_url.txt');
  let targetUrl = 'https://chatgpt.com';
  if (fs.existsSync(urlFile)) {
    targetUrl = fs.readFileSync(urlFile, 'utf8').trim();
  }

  console.log(`[AI] Opening ChatGPT tab: ${targetUrl}`);
  chatPage = await context.newPage();
  
  try {
    await chatPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Robust locator: Look for textarea or contenteditable div that is VISIBLE
    const inputLocator = chatPage.locator('textarea, div[contenteditable="true"], [role="textbox"]').filter({ visible: true });
    await inputLocator.first().waitFor({ timeout: 15000 });
    console.log('[AI] Found visible input field.');
  } catch (e) {
    console.log('[AI] ⚠️ Failed to load specific chat or find visible input. Falling back to base URL.');
    await chatPage.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
    
    const inputLocator = chatPage.locator('textarea, div[contenteditable="true"], [role="textbox"]').filter({ visible: true });
    await inputLocator.first().waitFor({ timeout: 15000 });
  }
  
  return chatPage;
}

/**
 * Generates a comment via the ChatGPT web interface.
 * @param {object} context - The Playwright browser context.
 * @param {string} postText - The LinkedIn post text.
 * @param {string} authorName - The author's name.
 * @param {object} style - The style object with label and instruction.
 * @returns {Promise<object>} The generated comment result.
 */
async function generateCommentViaWeb(context, postText, authorName, style) {
  const page = await getChatGPTPage(context);
  const urlFile = path.resolve(__dirname, '../../openai_chat_url.txt');
  
  // Add a delay to ensure the page is settled before interaction
  console.log('[AI] Waiting 3 seconds for page to settle...');
  await page.waitForTimeout(3000);

  const styleInstruction = style ? `Style: "${style.label}"\nInstruction: ${style.instruction}` : '';
  
  const prompt = `Write a professional LinkedIn comment on this post by ${authorName}.
${styleInstruction}

Post:
"""
${postText.slice(0, 1200)}
"""

Rules:
- Keep it extremely short (under 20 words).
- One punchy, meaningful sentence only.
- Reference a specific detail from the post.
- No emojis, no hashtags, no fluff.
- Do NOT say "Great post!", "I agree", or similar generic openers.

Respond with ONLY this JSON structure:
{
  "comment": "<the comment>",
  "best_angle": "<one sentence describing the angle you took>"
}`;

  try {
    // Count existing assistant messages to detect when the NEW one arrives
    const countBefore = await page.$$eval('div[data-message-author-role="assistant"]', el => el.length);
    console.log(`[AI] Assistant messages count before sending: ${countBefore}`);

    console.log('[AI] Sending prompt to ChatGPT tab...');
    
    // Use the robust locator to find the visible input field
    const inputLocator = page.locator('textarea, div[contenteditable="true"], [role="textbox"]').filter({ visible: true });
    await inputLocator.first().waitFor({ timeout: 15000 });
    
    await inputLocator.first().fill(prompt);
    await page.keyboard.press('Enter');
    
    console.log('[AI] Waiting for a NEW response to appear...');
    // Wait for the count of assistant messages to increase
    try {
      await page.waitForFunction((before) => {
        const elements = document.querySelectorAll('div[data-message-author-role="assistant"]');
        return elements.length > before;
      }, countBefore, { timeout: 20000 });
      console.log('[AI] New message detected.');
    } catch (e) {
      console.log('[AI] ⚠️ Timeout waiting for new message. It may be slow or failed.');
    }
    
    console.log('[AI] Waiting for response to complete streaming (10s)...');
    // Wait for the streaming to finish
    await page.waitForTimeout(10000);
    
    console.log('[AI] Extracting response...');
    const response = await page.$$eval('div[data-message-author-role="assistant"]', elements => {
      const last = elements[elements.length - 1];
      return last ? last.innerText : 'No response found';
    });
    
    // Save new URL if it changed to a new chat
    const currentUrl = page.url();
    const savedUrl = fs.existsSync(urlFile) ? fs.readFileSync(urlFile, 'utf8').trim() : '';
    if (currentUrl !== savedUrl && currentUrl.includes('/c/')) {
      console.log(`[AI] URL changed to a new chat: ${currentUrl}`);
      fs.writeFileSync(urlFile, currentUrl);
    }
    
    // Attempt to parse JSON
    try {
      let cleaned = response.trim();
      // Extract everything between the first { and last }
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleaned = jsonMatch[0];
      } else {
        // Remove code blocks if present
        cleaned = cleaned.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
      }

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (innerError) {
        console.log('[AI] JSON.parse failed, trying regex extraction...');
        // Fallback: Try to extract via regex
        const commentMatch = cleaned.match(/"comment":\s*"(.*?)(?<!\\)"/s);
        const angleMatch = cleaned.match(/"best_angle":\s*"(.*?)(?<!\\)"/s);
        
        if (commentMatch) {
          parsed = {
            comment: commentMatch[1].replace(/\\"/g, '"'),
            best_angle: angleMatch ? angleMatch[1].replace(/\\"/g, '"') : 'Extracted via regex'
          };
        } else {
          throw innerError; // Rethrow if regex also fails
        }
      }

      let comment = parsed.comment || response.trim();
      
      // Clean comment: remove em-dash, en-dash, double dashes, and extra spaces
      comment = comment
        .replace(/\s*[\u2014\u2013\u2500\u2015-]{2,}\s*/g, ' ') // ── or --
        .replace(/\s*[\u2014\u2013\u2500\u2015]\s*/g, ' ')    // — or – or ─
        .replace(/\s{2,}/g, ' ')                             // multiple spaces
        .trim();

      return {
        comment: comment,
        interestScore: 70,
        whyInteresting: 'Generated via ChatGPT Web',
        bestAngle: parsed.best_angle || '',
      };
    } catch (e) {
      console.log('[AI] Total failure to extract comment, using raw response.');
      let comment = response.trim();
      // Final attempt to clean if it's still JSON-like
      comment = comment.replace(/^\{[\s\S]*\}$/, (match) => {
          const m = match.match(/"comment":\s*"(.*?)(?<!\\)"/s);
          return m ? m[1] : match;
      });

      comment = comment
        .replace(/\s*[\u2014\u2013\u2500\u2015-]{2,}\s*/g, ' ')
        .replace(/\s*[\u2014\u2013\u2500\u2015]\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

      return {
        comment: comment,
        interestScore: 70,
        whyInteresting: 'Generated via ChatGPT Web (Raw)',
        bestAngle: 'Fallback',
      };
    }
    
  } catch (error) {
    console.error('[AI] Error in generateCommentViaWeb:', error.message);
    throw error;
  }
}

module.exports = { generateCommentViaWeb };
