const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
  const sessionDir = path.resolve(__dirname, '.openai_session');
  const urlFile = path.resolve(__dirname, 'openai_chat_url.txt');
  
  let targetUrl = 'https://chatgpt.com'; // Default to new chat
  
  // Read saved URL if it exists
  if (fs.existsSync(urlFile)) {
    targetUrl = fs.readFileSync(urlFile, 'utf8').trim();
    console.log(`Read saved chat URL: ${targetUrl}`);
  } else {
    console.log('No saved chat URL found, using default (new chat).');
  }

  console.log('Launching browser with saved session...');
  
  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: false,
    viewport: { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = await context.newPage();
  
  try {
    console.log(`Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Check if we hit an error or the chat is invalid
    // If the URL contains a chat ID but we can't find the input box, it might be an invalid chat
    console.log('Checking for input field...');
    try {
      await page.waitForSelector('textarea', { timeout: 10000 });
    } catch (e) {
      console.log('⚠️ Could not find input field in this chat. It might be invalid or deleted.');
      if (targetUrl !== 'https://chatgpt.com') {
        console.log('Falling back to a new chat...');
        targetUrl = 'https://chatgpt.com';
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('textarea', { timeout: 15000 });
      } else {
        throw e; // If even the fallback fails, throw error
      }
    }
    
    console.log('Typing message: "hello"...');
    await page.fill('textarea', 'hello');
    
    console.log('Sending message...');
    await page.keyboard.press('Enter');
    
    console.log('Waiting for AI to respond (waiting 10 seconds for completion)...');
    await page.waitForTimeout(10000);
    
    console.log('Extracting response...');
    const response = await page.$$eval('div[data-message-author-role="assistant"]', elements => {
      const last = elements[elements.length - 1];
      return last ? last.innerText : 'No response found or selector changed.';
    });
    
    console.log('\n======================================');
    console.log('🤖 Response from ChatGPT:');
    console.log('======================================');
    console.log(response.trim());
    console.log('======================================\n');
    
    // Check if the URL has changed (meaning a new chat was created)
    const currentUrl = page.url();
    if (currentUrl !== targetUrl && currentUrl.includes('/c/')) {
      console.log(`📝 URL changed to a new chat: ${currentUrl}`);
      console.log(`Saving new URL to ${urlFile}`);
      fs.writeFileSync(urlFile, currentUrl);
    }
    
  } catch (error) {
    console.error('\n❌ Error during automation:', error.message);
  } finally {
    console.log('Closing browser...');
    await context.close();
    console.log('Done.');
  }
}

main();
