import asyncio
from playwright.async_api import async_playwright
import os

# Path to the existing session directory
# Using absolute path based on this file's location
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SESSION_DIR = os.path.abspath(os.path.join(CURRENT_DIR, "../session"))

async def scrape_linkedin_profile(profile_url: str):
    print(f"Starting scrape for: {profile_url}")
    print(f"Using session directory: {SESSION_DIR}")
    
    async with async_playwright() as p:
        try:
            # Launch browser with existing persistent context
            context = await p.chromium.launch_persistent_context(
                user_data_dir=SESSION_DIR,
                headless=False # Set to False to see the browser
            )
            
            page = await context.new_page()
            
            print(f"Navigating to: {profile_url}")
            await page.goto(profile_url)
            
            # Wait for some content to load or a short delay
            await page.wait_for_timeout(3000)
            
            title = await page.title()
            print(f"Page title: {title}")
            
            # Here you would add more logic to extract profile details
            # e.g., name, role, about, etc.
            
            await context.close()
            return {"status": "success", "title": title, "url": profile_url}
            
        except Exception as e:
            print(f"Error during scrape: {e}")
            return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    # Test run
    test_url = "https://www.linkedin.com/in/williamhgates"
    asyncio.run(scrape_linkedin_profile(test_url))
