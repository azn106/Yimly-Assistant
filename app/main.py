import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from app.core.config import settings
from app.core.logging import setup_logging, logger
from app.db.database import Base, engine
from app.api import auth, rest, mobile_app, webhook, websocket, circles

# Initialize logging configuration
setup_logging()

app = FastAPI(
    title="Home Assistant Companion App Compatible Server",
    description="A fully featured production-ready compatible backend server.",
    version="1.0.0",
)

# CORS config
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def on_startup() -> None:
    logger.info("Starting up Home Assistant compatible server backend...")
    try:
        async with engine.begin() as conn:
            # Idempotently create tables
            await conn.run_sync(Base.metadata.create_all)
            
            # Dynamically migrate avatar_color if it doesn't exist
            from sqlalchemy import text
            try:
                await conn.execute(text("ALTER TABLE users ADD COLUMN avatar_color VARCHAR(50);"))
                logger.info("Database migration: Added avatar_color column to users table.")
            except Exception:
                # Column likely already exists, ignore
                pass

            # Dynamically migrate profile_picture_url if it doesn't exist
            try:
                await conn.execute(text("ALTER TABLE users ADD COLUMN profile_picture_url VARCHAR(500);"))
                logger.info("Database migration: Added profile_picture_url column to users table.")
            except Exception:
                # Column likely already exists, ignore
                pass

            # Dynamically migrate map_style if it doesn't exist
            try:
                await conn.execute(text("ALTER TABLE users ADD COLUMN map_style VARCHAR(50) DEFAULT 'osm';"))
                logger.info("Database migration: Added map_style column to users table.")
            except Exception:
                # Column likely already exists, ignore
                pass

            # Dynamically migrate map_selected_icon_size if it doesn't exist
            try:
                await conn.execute(text("ALTER TABLE users ADD COLUMN map_selected_icon_size INTEGER DEFAULT 48;"))
                logger.info("Database migration: Added map_selected_icon_size column to users table.")
            except Exception:
                # Column likely already exists, ignore
                pass

            # Dynamically migrate map_unselected_icon_size if it doesn't exist
            try:
                await conn.execute(text("ALTER TABLE users ADD COLUMN map_unselected_icon_size INTEGER DEFAULT 36;"))
                logger.info("Database migration: Added map_unselected_icon_size column to users table.")
            except Exception:
                # Column likely already exists, ignore
                pass
                
        logger.info("Database schemas created/verified successfully.")
    except Exception as e:
        logger.critical(f"Database schema initialization failed: {e}")
        raise e

# Persistent uploads directory setup
uploads_path = os.path.join(os.getcwd(), "uploads")
os.makedirs(os.path.join(uploads_path, "profile_pictures"), exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_path), name="uploads")

# Register endpoint routers
app.include_router(auth.router)
app.include_router(rest.router)
app.include_router(mobile_app.router)
app.include_router(webhook.router)
app.include_router(websocket.router)
app.include_router(circles.router)

# Serve the static compiled React app from dist/
dist_path = os.path.join(os.getcwd(), "dist")

@app.get("/{full_path:path}")
async def serve_static_or_spa(full_path: str):
    # Do not intercept API or uploads endpoints
    if full_path.startswith("api/") or full_path == "api" or full_path.startswith("uploads/") or full_path == "uploads":
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    
    if os.path.exists(dist_path):
        target_file = os.path.join(dist_path, full_path)
        if full_path and os.path.isfile(target_file):
            return FileResponse(target_file)
        index_file = os.path.join(dist_path, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
            
    return JSONResponse(
        status_code=200,
        content={
            "status": "online",
            "message": "Home Assistant compatible server is running."
        }
    )
