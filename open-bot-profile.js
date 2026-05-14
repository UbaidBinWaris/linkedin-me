const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const config = require('./src/config');

function waitForEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => { rl.close(); resolve(); });
  });
}

async function main() {
  const sessionDir = path.resolve(config.browser.sessionDir);
  console.log('Launching browser with LinkedIn session profile...');
  console.log(`Session directory: ${sessionDir}`);
  
  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: false,
    viewport: { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = await context.newPage();
  
  try {
    console.log('Navigating to ChatGPT...');
    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
    
    console.log('\n──────────────────────────────────────────────────');
    console.log('  📋 Please log in to your OpenAI account in this browser.');
    console.log('  ✔  Once you are logged in and see the chat interface,');
    console.log('     come back here and press ENTER.');
    console.log('──────────────────────────────────────────────────');
    
    await waitForEnter('  Press ENTER to save session and close browser...\n');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await context.close();
    console.log('Browser closed. Session saved.');
  }
}

main();
