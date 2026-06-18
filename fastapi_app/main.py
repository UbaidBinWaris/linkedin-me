from fastapi import FastAPI, BackgroundTasks
from .scraper.linkedin.profile_scraper import scrape_profile

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI!"}

@app.post("/scrape/profile")
async def trigger_profile_scrape(url: str, background_tasks: BackgroundTasks):
    # Trigger the scraping task in the background
    background_tasks.add_task(scrape_profile, url)
    return {
        "status": "Scraping task started in background",
        "url": url,
        "note": "Check logs for progress as it runs in background"
    }
