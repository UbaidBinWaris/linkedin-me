from prisma import Prisma
import datetime

async def upsert_profile(profile_data: dict):
    """Step 5: Upsert clean profile data to database."""
    db = Prisma()
    await db.connect()
    try:
        # Use linkedinUrl as the unique identifier for upsert
        profile = await db.linkedinprofile.upsert(
            where={
                "linkedinUrl": profile_data["linkedin_url"]
            },
            data={
                "create": {
                    "linkedinUrl": profile_data["linkedin_url"],
                    "fullName": profile_data["full_name"],
                    "headline": profile_data["headline"],
                    "about": profile_data["about"],
                    "followers": profile_data["followers"],
                    "location": profile_data["location"]
                },
                "update": {
                    "fullName": profile_data["full_name"],
                    "headline": profile_data["headline"],
                    "about": profile_data["about"],
                    "followers": profile_data["followers"],
                    "location": profile_data["location"]
                }
            }
        )
        print(f"Upserted profile: {profile.id}")
        return profile.id
    except Exception as e:
        print(f"Failed to upsert profile: {e}")
        return None
    finally:
        await db.disconnect()
