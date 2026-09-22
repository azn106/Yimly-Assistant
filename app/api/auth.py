import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Form, HTTPException, Request, status, UploadFile, File
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from app.core.config import settings
from app.core.logging import logger
from app.core.security import create_jwt_token
from app.db.database import get_db
from app.db.models import User
from app.schemas.auth import UserCreate, UserResponse, ProfileUpdate
from app.services.auth_service import AuthService
from app.services.token_service import TokenService

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

class LoginRequest(BaseModel):
    username: str
    password: str

@router.get("/auth/authorize", response_class=HTMLResponse)
async def authorize_get(
    request: Request,
    client_id: str,
    redirect_uri: str,
    response_type: str,
    state: str,
    scope: Optional[str] = None
) -> HTMLResponse:
    # Validate parameters
    if not client_id or not redirect_uri:
        raise HTTPException(status_code=400, detail="Missing required authorize parameters.")

    # Render login form preserving original state parameters
    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": response_type,
            "state": state,
            "error": None
        }
    )

@router.post("/auth/login_submit")
async def authorize_post(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    client_id: str = Form(...),
    redirect_uri: str = Form(...),
    response_type: str = Form(...),
    state: str = Form(...),
    db: AsyncSession = Depends(get_db)
):
    # Authenticate credentials
    user = await AuthService.authenticate_user(db, username, password)
    if not user:
        # Re-render with failure message
        return templates.TemplateResponse(
            request=request,
            name="login.html",
            context={
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "response_type": response_type,
                "state": state,
                "error": "Invalid username or password"
            }
        )

    # Handshake success: Generate temporary single-use Auth Code
    try:
        code = await TokenService.create_authorization_code(
            db=db,
            user_id=user.id,
            client_id=client_id,
            redirect_uri=redirect_uri
        )
    except Exception as e:
        logger.error(f"Failed to generate auth code: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

    # Redirect client/webview to the provided Redirect URI with parameters
    separator = "&" if "?" in redirect_uri else "?"
    redirect_url = f"{redirect_uri}{separator}code={code}&state={state}"
    logger.info(f"User {user.username} authenticated successfully. Redirecting to mobile-app callback.")
    return RedirectResponse(url=redirect_url, status_code=status.HTTP_302_FOUND)

@router.post("/auth/token")
async def exchange_token(
    grant_type: str = Form(...),
    client_id: str = Form(...),
    code: Optional[str] = Form(None),
    redirect_uri: Optional[str] = Form(None),
    refresh_token: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db)
):
    if grant_type == "authorization_code":
        if not code or not redirect_uri:
            raise HTTPException(status_code=400, detail="Code and redirect_uri are required for authorization_code grant.")

        # Validate code atomically
        user_id = await TokenService.redeem_authorization_code(
            db=db,
            raw_code=code,
            client_id=client_id,
            redirect_uri=redirect_uri
        )
        if user_id is None:
            raise HTTPException(status_code=400, detail="Invalid, expired, or already used authorization code.")

        # Create JWT Access Token and Refresh Token
        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_jwt_token(
            data={"sub": str(user_id), "typ": "access"},
            expires_delta=access_token_expires
        )
        
        # Create persistent Refresh Token
        new_refresh_token = await TokenService.create_refresh_token(
            db=db,
            user_id=user_id,
            client_id=client_id
        )

        logger.info(f"Successfully issued access token and refresh token for user {user_id}")
        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": int(access_token_expires.total_seconds()),
            "refresh_token": new_refresh_token
        }

    elif grant_type == "refresh_token":
        if not refresh_token:
            raise HTTPException(status_code=400, detail="refresh_token is required for refresh_token grant.")

        user_id = await TokenService.redeem_refresh_token(
            db=db,
            raw_token=refresh_token,
            client_id=client_id
        )
        if user_id is None:
            raise HTTPException(status_code=400, detail="Invalid, revoked, or expired refresh token.")

        # Issue new Access Token (keep old refresh token active or rotate - we'll keep the same refresh token active)
        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_jwt_token(
            data={"sub": str(user_id), "typ": "access"},
            expires_delta=access_token_expires
        )

        logger.info(f"Successfully refreshed access token for user {user_id}")
        return {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": int(access_token_expires.total_seconds()),
            "refresh_token": refresh_token  # Protocol accepts returning the same refresh token
        }

    else:
        raise HTTPException(status_code=400, detail="Unsupported grant_type.")


@router.get("/api/setup/status")
async def get_setup_status(db: AsyncSession = Depends(get_db)):
    # Check if any user exists in the database
    stmt = select(func.count()).select_from(User)
    result = await db.execute(stmt)
    count = result.scalar()
    return {"needs_setup": count == 0}


@router.post("/api/setup/register", response_model=UserResponse)
async def setup_register(user_in: UserCreate, db: AsyncSession = Depends(get_db)):
    # Verify setup is actually needed (no users in db)
    stmt = select(func.count()).select_from(User)
    result = await db.execute(stmt)
    count = result.scalar()
    if count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Setup has already been completed."
        )

    # Check if username already exists
    existing = await AuthService.get_user_by_username(db, user_in.username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists."
        )

    user = await AuthService.create_user(db, user_in)
    return user


@router.post("/api/auth/register", response_model=UserResponse)
async def api_register(user_in: UserCreate, db: AsyncSession = Depends(get_db)):
    # Verify setup is NOT needed (at least one user exists in the db)
    stmt = select(func.count()).select_from(User)
    result = await db.execute(stmt)
    count = result.scalar()
    if count == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="First-run setup has not been completed yet."
        )

    # Check if username already exists
    existing = await AuthService.get_user_by_username(db, user_in.username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists."
        )

    user = await AuthService.create_user(db, user_in)
    return user


@router.post("/api/auth/login")
async def api_login(login_in: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await AuthService.authenticate_user(db, login_in.username, login_in.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )

    # Generate JWT Access Token and Refresh Token
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_jwt_token(
        data={"sub": str(user.id), "typ": "access"},
        expires_delta=access_token_expires
    )

    new_refresh_token = await TokenService.create_refresh_token(
        db=db,
        user_id=user.id,
        client_id="web_ui"
    )

    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": int(access_token_expires.total_seconds()),
        "refresh_token": new_refresh_token,
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "avatar_color": user.avatar_color,
            "profile_picture_url": user.profile_picture_url,
            "map_style": user.map_style or "osm",
            "map_selected_icon_size": user.map_selected_icon_size or 48,
            "map_unselected_icon_size": user.map_unselected_icon_size or 36
        }
    }


from app.api.deps import require_authenticated_user

@router.get("/api/auth/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(require_authenticated_user)):
    return current_user

@router.put("/api/auth/profile", response_model=UserResponse)
async def update_profile(
    profile_in: ProfileUpdate,
    current_user: User = Depends(require_authenticated_user),
    db: AsyncSession = Depends(get_db)
):
    if profile_in.avatar_color is not None:
        current_user.avatar_color = profile_in.avatar_color
    if profile_in.display_name is not None:
        current_user.display_name = profile_in.display_name
    if profile_in.map_style is not None:
        allowed_styles = {"osm", "openfree_positron", "openfree_bright", "openfree_liberty", "openfree_dark", "openfree_fiord", "carto_voyager", "carto_positron", "carto_dark"}
        if profile_in.map_style in allowed_styles:
            current_user.map_style = profile_in.map_style
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid map_style value. Must be one of {allowed_styles}"
            )
    if profile_in.map_selected_icon_size is not None:
        if 24 <= profile_in.map_selected_icon_size <= 72:
            current_user.map_selected_icon_size = profile_in.map_selected_icon_size
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="map_selected_icon_size must be between 24 and 72 pixels."
            )
    if profile_in.map_unselected_icon_size is not None:
        if 24 <= profile_in.map_unselected_icon_size <= 72:
            current_user.map_unselected_icon_size = profile_in.map_unselected_icon_size
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="map_unselected_icon_size must be between 24 and 72 pixels."
            )
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/api/auth/profile/picture", response_model=UserResponse)
@router.post("/api/auth/profile-picture", response_model=UserResponse)
async def upload_profile_picture(
    file: UploadFile = File(...),
    current_user: User = Depends(require_authenticated_user),
    db: AsyncSession = Depends(get_db)
):
    allowed_types = ["image/jpeg", "image/jpg", "image/png", "image/webp"]
    allowed_exts = [".jpg", ".jpeg", ".png", ".webp"]
    
    filename_lower = file.filename.lower() if file.filename else ""
    ext = os.path.splitext(filename_lower)[1]
    
    if ext not in allowed_exts or (file.content_type and file.content_type.lower() not in allowed_types):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Only JPEG, PNG, and WebP images are allowed."
        )

    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024: # 5MB limit
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size exceeds maximum limit of 5MB."
        )

    # Basic magic bytes check
    is_valid_magic = (
        contents.startswith(b"\xff\xd8\xff") or # JPEG
        contents.startswith(b"\x89PNG\r\n\x1a\n") or # PNG
        (contents.startswith(b"RIFF") and b"WEBP" in contents[:16]) # WebP
    )
    if not is_valid_magic:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Corrupted or invalid image file content."
        )

    # Remove existing photo if present
    if current_user.profile_picture_url:
        old_file_name = os.path.basename(current_user.profile_picture_url)
        old_file_path = os.path.join(os.getcwd(), "uploads", "profile_pictures", old_file_name)
        if os.path.exists(old_file_path):
            try:
                os.remove(old_file_path)
            except Exception as e:
                logger.warning(f"Failed to delete old profile picture {old_file_path}: {e}")

    # Generate safe server-side filename
    safe_ext = ext if ext in allowed_exts else ".jpg"
    unique_filename = f"user_{current_user.id}_{int(datetime.now(timezone.utc).timestamp())}_{uuid.uuid4().hex[:8]}{safe_ext}"
    upload_dir = os.path.join(os.getcwd(), "uploads", "profile_pictures")
    os.makedirs(upload_dir, exist_ok=True)
    target_path = os.path.join(upload_dir, unique_filename)

    with open(target_path, "wb") as f:
        f.write(contents)

    picture_url = f"/uploads/profile_pictures/{unique_filename}"
    current_user.profile_picture_url = picture_url
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.delete("/api/auth/profile/picture", response_model=UserResponse)
@router.delete("/api/auth/profile-picture", response_model=UserResponse)
async def delete_profile_picture(
    current_user: User = Depends(require_authenticated_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.profile_picture_url:
        old_file_name = os.path.basename(current_user.profile_picture_url)
        old_file_path = os.path.join(os.getcwd(), "uploads", "profile_pictures", old_file_name)
        if os.path.exists(old_file_path):
            try:
                os.remove(old_file_path)
            except Exception as e:
                logger.warning(f"Failed to delete profile picture {old_file_path}: {e}")
        current_user.profile_picture_url = None
        db.add(current_user)
        await db.commit()
        await db.refresh(current_user)
    return current_user

