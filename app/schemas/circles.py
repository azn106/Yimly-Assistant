from pydantic import BaseModel, Field
from datetime import datetime
from typing import List, Optional, Any, Dict

class CircleCreate(BaseModel):
    name: str = Field(..., description="Name of the Circle")

class CircleJoin(BaseModel):
    invite_code: str = Field(..., description="Invitation code for the Circle")

class CircleResponse(BaseModel):
    id: int
    name: str
    owner_id: int
    invite_code: str
    created_at: datetime

    class Config:
        from_attributes = True

class MemberDeviceLocation(BaseModel):
    entity_id: str
    device_name: str
    latitude: float
    longitude: float
    battery: Optional[Any] = None
    accuracy: Optional[float] = None
    last_updated: str

class MemberResponse(BaseModel):
    id: int
    username: str
    display_name: str
    avatar_color: Optional[str] = None
    profile_picture_url: Optional[str] = None
    devices: List[MemberDeviceLocation] = []

    class Config:
        from_attributes = True
