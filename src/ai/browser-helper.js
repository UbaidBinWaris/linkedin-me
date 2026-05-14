const { exec } = require('child_process');

/**
 * Opens ChatGPT in the default browser.
 * This can be used when you don't have an API key and want to use the web interface.
 */
function openChatGPT() {
  const command = process.platform === 'linux' ? 'xdg-open' : 'open';
  const url = 'https://chatgpt.com';
  
  console.log(`Opening ${url} in browser...`);
  
  exec(`${command} ${url}`, (error) => {
    if (error) {
      console.error('Failed to open browser:', error.message);
    } else {
      console.log('Browser opened successfully.');
    }
  });
}

module.exports = { openChatGPT };
