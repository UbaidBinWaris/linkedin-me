from prisma import Prisma
import datetime

async def save_raw_snapshot(source_type: str, source_url: str, html_content: str):
    """Step 4: Save raw HTML to database."""
    db = Prisma()
    await db.connect()
    try:
        snapshot = await db.rawsnapshot.create(
            data={
                "sourceType": source_type,
                "sourceUrl": source_url,
                "htmlContent": html_content
            }
        )
        print(f"Saved raw snapshot ID: {snapshot.id}")
        return snapshot.id
    except Exception as e:
        print(f"Failed to save raw snapshot: {e}")
        return None
    finally:
        await db.disconnect()
