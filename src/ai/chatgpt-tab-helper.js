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
- 1-2 tight sentences. First sentence is your take, optional second is a follow-up.
- Reference a specific detail from the post.
- No emojis, no hashtags.
- Do NOT say "Great post!" or similar generic openers.

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
      const cleaned = response.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        comment: parsed.comment || response.trim(),
        interestScore: 70,
        whyInteresting: 'Generated via ChatGPT Web',
        bestAngle: parsed.best_angle || '',
      };
    } catch (e) {
      console.log('[AI] Failed to parse JSON, returning raw text.');
      return {
        comment: response.trim(),
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
