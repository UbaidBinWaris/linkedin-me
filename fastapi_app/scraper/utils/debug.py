import os
import datetime

async def save_debug_snapshot(page, prefix="debug"):
    """Step 10: Save screenshot and HTML snapshot on failure or for debugging."""
    # Ensure debug directory exists in the project root
    # We'll save it relative to the current working directory
    debug_dir = os.path.abspath("debug")
    os.makedirs(debug_dir, exist_ok=True)
    
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    
    screenshot_path = os.path.join(debug_dir, f"{prefix}_{timestamp}.png")
    html_path = os.path.join(debug_dir, f"{prefix}_{timestamp}.html")
    
    # Save screenshot
    await page.screenshot(path=screenshot_path)
    
    # Save HTML
    html_content = await page.content()
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
        
    print(f"Debug snapshot saved: {screenshot_path} and {html_path}")
    return {"screenshot": screenshot_path, "html": html_path}
