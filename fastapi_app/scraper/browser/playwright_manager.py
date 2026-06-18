import os
from playwright.async_api import async_playwright

# Path to the existing session directory
# From fastapi_app/scraper/browser/, the session is at ../../../session
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SESSION_DIR = os.path.abspath(os.path.join(CURRENT_DIR, "../../../session"))

class PlaywrightManager:
    def __init__(self):
        self.playwright = None
        self.context = None

    async def start(self, headless=False):
        """Start Playwright and launch the browser with persistent context."""
        if not self.playwright:
            self.playwright = await async_playwright().start()
            
        if not self.context:
            print(f"Launching browser with session at: {SESSION_DIR}")
            self.context = await self.playwright.chromium.launch_persistent_context(
                user_data_dir=SESSION_DIR,
                headless=headless
            )
        return self.context

    async def get_page(self):
        """Get a new page from the context."""
        if not self.context:
            await self.start()
        return await self.context.new_page()

    async def close(self):
        """Close the context and stop Playwright."""
        if self.context:
            await self.context.close()
            self.context = None
        if self.playwright:
            await self.playwright.stop()
            self.playwright = None

# Singleton instance
manager = PlaywrightManager()
