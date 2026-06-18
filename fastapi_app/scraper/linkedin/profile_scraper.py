import asyncio
import random
import datetime
import hashlib
from ..browser.playwright_manager import manager
from ..parsers.profile_parser import ProfileParser
from ..validators.profile_validator import validate_profile
from ..pipelines.save_raw_snapshot import save_raw_snapshot
from ..pipelines.save_profile import upsert_profile
from ..utils.debug import save_debug_snapshot
from ..detectors.linkedin_page_detector import detect_page_type

async def scrape_profile(profile_url: str):
    """Orchestrate the full flow: Scrape -> Save Raw -> Parse -> Validate -> Save Clean."""
    print(f"Starting pipeline for: {profile_url}")
    
    # Get context (visible mode by default)
    context = await manager.start(headless=False)
    page = await context.new_page()
    
    try:
        # Step 6: Simulate human behavior
        await asyncio.sleep(random.uniform(2.0, 5.0))
        
        print(f"Navigating to: {profile_url}")
        await page.goto(profile_url)
        
        # Wait for content to load
        await asyncio.sleep(random.uniform(3.0, 6.0))
        
        # 1. Capture HTML
        html_content = await page.content()
        
        # Step 1: Page Type Detection
        page_type = detect_page_type(html_content)
        print(f"Detected page type: {page_type}")
        
        # Step 7: HTML Hashing
        html_hash = hashlib.md5(html_content.encode()).hexdigest()
        print(f"HTML Hash: {html_hash}")
        
        if page_type != "profile":
            print(f"Skipping parsing for non-profile page: {page_type}")
            await save_debug_snapshot(page, prefix=f"non_profile_{page_type}")
            await page.close()
            return {"status": "skipped", "reason": page_type, "url": profile_url}
            
        # 2. Save Raw Snapshot
        print("Saving raw snapshot...")
        snapshot_id = await save_raw_snapshot(
            source_type="profile",
            source_url=profile_url,
            html_content=html_content
        )
        
        # 3. Parse Structured Data
        print("Parsing profile data...")
        parser = ProfileParser(html_content)
        parsed_data = parser.parse_profile()
        
        # Add metadata (Step 6)
        parsed_data["linkedin_url"] = profile_url
        
        print(f"Parsed Data: {parsed_data}")
        
        # 4. Validate
        print("Validating data...")
        validated_data = validate_profile(parsed_data)
        
        if validated_data:
            # 5. Save Clean Profile (Upsert)
            print("Upserting profile to DB...")
            profile_id = await upsert_profile(validated_data)
            
            await page.close()
            return {
                "status": "success",
                "profile_id": profile_id,
                "snapshot_id": snapshot_id,
                "url": profile_url
            }
        else:
            print("Validation failed. Saving debug files.")
            await save_debug_snapshot(page, prefix="validation_fail")
            await page.close()
            return {"status": "validation_failed", "url": profile_url}
            
    except Exception as e:
        print(f"Error during scrape pipeline: {e}")
        # Step 10: Save debug snapshot on failure
        try:
            await save_debug_snapshot(page, prefix="error")
        except Exception as debug_err:
            print(f"Failed to save debug snapshot: {debug_err}")
            
        await page.close()
        return {"status": "error", "message": str(e), "url": profile_url}
    finally:
        # We keep the manager open for other tasks
        pass
