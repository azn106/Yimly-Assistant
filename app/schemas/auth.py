from typing import Optional
from pydantic import BaseModel, Field

class UserCreate(BaseModel):
    username: str = Field(..., description="Unique email or username")
    password: str = Field(..., min_length=6, description="Secure password")
    display_name: str = Field(..., description="User's display name")

class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    avatar_color: Optional[str] = None
    profile_picture_url: Optional[str] = None
    map_style: Optional[str] = "osm"
    map_selected_icon_size: Optional[int] = 48
    map_unselected_icon_size: Optional[int] = 36
    is_active: bool

    class Config:
        from_attributes = True

class ProfileUpdate(BaseModel):
    avatar_color: Optional[str] = None
    display_name: Optional[str] = None
    map_style: Optional[str] = None
    map_selected_icon_size: Optional[int] = Field(None, ge=24, le=72, description="Selected member map icon size (24-72 px)")
    map_unselected_icon_size: Optional[int] = Field(None, ge=24, le=72, description="Unselected member map icon size (24-72 px)")

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_token: Optional[str] = None
