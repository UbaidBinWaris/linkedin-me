const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

function waitForEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => { rl.close(); resolve(); });
  });
}

async function main() {
  // Save session in a folder called .openai_session in the project root
  const sessionDir = path.resolve(__dirname, '.openai_session');
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  console.log('Launching browser with persistent context...');
  console.log(`Session will be saved in: ${sessionDir}`);
  
  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: false, // Must be visible to let you log in
    viewport: { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'], // Help avoid bot detection
  });

  const page = await context.newPage();
  
  try {
    console.log('Navigating to ChatGPT...');
    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
    
    console.log('\n──────────────────────────────────────────────────');
    console.log('  📋 Please log in to your OpenAI account in the browser.');
    console.log('  ✔  Once you are logged in and see the chat interface,');
    console.log('     come back here and press ENTER.');
    console.log('──────────────────────────────────────────────────');
    
    await waitForEnter('  Press ENTER after logging in to save the session...\n');
    
    console.log('Closing browser and saving session...');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await context.close();
    console.log('Session saved. You can now run your test script.');
  }
}

main();
