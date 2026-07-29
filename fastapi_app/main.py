from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from .scraper.linkedin.profile_scraper import scrape_profile
from .agents.comment_analyzer import comment_analyzer
from .agents.post_writer import post_writer
from .agents.personal_coach import personal_coach

app = FastAPI(
    title="LinkedIn Intelligence Platform API",
    description="Multi-Agent AI Engine & Scraper Gateway for LinkedIn Automation",
    version="2.0.0"
)

# ── Pydantic Request Schemas ──
class AnalyzeCommentRequest(BaseModel):
    comment_text: str

class GeneratePostRequest(BaseModel):
    topic: str
    target_audience: Optional[str] = "Engineering Leaders"

class GenerateCommentRequest(BaseModel):
    post_text: str
    author_name: Optional[str] = ""

class PredictEngagementRequest(BaseModel):
    draft_text: str

# ── Memory Draft Store (Mock / In-Memory for API demo before DB sync) ──
DRAFTS_DB = []

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "LinkedIn Multi-Agent Platform API",
        "agents": [
            "Feed Collector", "Comment Analyzer", "Viral Pattern Detector",
            "Personal Coach", "AI Writer", "Comment Generator",
            "Engagement Predictor", "Scheduler", "Competitor Monitor", "Memory Engine"
        ]
    }

# ── Agent Endpoints ──

@app.post("/agents/comment-analyzer")
def analyze_comment_endpoint(req: AnalyzeCommentRequest):
    return comment_analyzer.analyze_comment(req.comment_text)

@app.post("/agents/generate-post-draft")
def generate_post_draft_endpoint(req: GeneratePostRequest):
    draft = post_writer.generate_post_draft(req.topic, req.target_audience)
    DRAFTS_DB.append(draft)
    return draft

@app.post("/agents/generate-comment-draft")
def generate_comment_draft_endpoint(req: GenerateCommentRequest):
    draft = post_writer.generate_comment_draft(req.post_text, req.author_name)
    DRAFTS_DB.append(draft)
    return draft

@app.get("/agents/daily-recommendation")
def daily_recommendation_endpoint(niche: str = "Software Engineering & AI Automation"):
    return personal_coach.get_daily_recommendation(niche)

@app.post("/agents/predict-engagement")
def predict_engagement_endpoint(req: PredictEngagementRequest):
    return personal_coach.predict_engagement(req.draft_text)

# ── Draft Review Portal Endpoints (Human-in-the-Loop Safety) ──

@app.get("/drafts")
def get_all_drafts():
    return {"drafts": DRAFTS_DB}

@app.post("/drafts/{draft_id}/approve")
def approve_draft(draft_id: int):
    if 0 <= draft_id < len(DRAFTS_DB):
        DRAFTS_DB[draft_id]["status"] = "APPROVED"
        return {"status": "success", "draft": DRAFTS_DB[draft_id]}
    raise HTTPException(status_code=404, detail="Draft not found")

@app.post("/scrape/profile")
async def trigger_profile_scrape(url: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(scrape_profile, url)
    return {
        "status": "Scraping task started in background",
        "url": url
    }
