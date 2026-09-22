import uuid
import logging
from typing import List
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_authenticated_user
from app.db.database import get_db
from app.db.models import User, Circle, CircleMember, EntityState
from app.schemas.circles import CircleCreate, CircleJoin, CircleResponse, MemberResponse, MemberDeviceLocation

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/circles", tags=["Circles"])

def generate_invite_code() -> str:
    # Generates a clean 8-character uppercase alphanumeric code
    return str(uuid.uuid4()).replace("-", "")[:8].upper()

@router.post("", response_model=CircleResponse)
async def create_circle(
    circle_in: CircleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_authenticated_user)
):
    invite_code = generate_invite_code()
    
    # Ensure code is unique in the DB
    for _ in range(5):
        stmt = select(Circle).where(Circle.invite_code == invite_code)
        res = await db.execute(stmt)
        if not res.scalar_one_or_none():
            break
        invite_code = generate_invite_code()

    new_circle = Circle(
        name=circle_in.name,
        owner_id=user.id,
        invite_code=invite_code
    )
    db.add(new_circle)
    await db.commit()
    await db.refresh(new_circle)

    # Automatically add owner as a member
    member = CircleMember(
        circle_id=new_circle.id,
        user_id=user.id
    )
    db.add(member)
    await db.commit()

    return new_circle

@router.post("/join", response_model=CircleResponse)
async def join_circle(
    join_in: CircleJoin,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_authenticated_user)
):
    normalized_code = join_in.invite_code.strip().upper()
    stmt = select(Circle).where(Circle.invite_code == normalized_code)
    result = await db.execute(stmt)
    circle = result.scalar_one_or_none()

    if not circle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation code not found or invalid."
        )

    # Check if already a member
    stmt_member = select(CircleMember).where(
        CircleMember.circle_id == circle.id,
        CircleMember.user_id == user.id
    )
    res_member = await db.execute(stmt_member)
    if res_member.scalar_one_or_none():
        return circle

    new_member = CircleMember(
        circle_id=circle.id,
        user_id=user.id
    )
    db.add(new_member)
    await db.commit()

    return circle

@router.get("", response_model=List[CircleResponse])
async def list_circles(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_authenticated_user)
):
    # Retrieve all circles where user is a member
    stmt = select(Circle).join(CircleMember).where(CircleMember.user_id == user.id)
    result = await db.execute(stmt)
    return list(result.scalars().all())

@router.get("/{circle_id}/members", response_model=List[MemberResponse])
async def list_circle_members(
    circle_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_authenticated_user)
):
    # Verify current user is a member of this circle
    stmt_check = select(CircleMember).where(
        CircleMember.circle_id == circle_id,
        CircleMember.user_id == user.id
    )
    res_check = await db.execute(stmt_check)
    if not res_check.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to view this Circle."
        )

    # Query all members of the circle
    stmt_members = select(User).join(CircleMember).where(CircleMember.circle_id == circle_id)
    res_members = await db.execute(stmt_members)
    members_list = res_members.scalars().all()

    response = []
    for member in members_list:
        # Look up all "device_tracker" entities belonging to this member to fetch real locations
        stmt_states = select(EntityState).where(
            EntityState.user_id == member.id,
            EntityState.domain == "device_tracker"
        )
        res_states = await db.execute(stmt_states)
        device_trackers = res_states.scalars().all()

        devices_loc = []
        for dt in device_trackers:
            # ONLY include devices with valid, non-None real location coordinates
            if dt.latitude is not None and dt.longitude is not None:
                attrs = dt.attributes if isinstance(dt.attributes, dict) else {}
                friendly_name = attrs.get("friendly_name") or dt.entity_id
                battery = attrs.get("battery") or attrs.get("battery_level") or attrs.get("battery_bar")
                accuracy = attrs.get("gps_accuracy")
                
                if dt.last_updated:
                    last_updated_str = dt.last_updated.isoformat() if hasattr(dt.last_updated, "isoformat") else str(dt.last_updated)
                else:
                    last_updated_str = datetime.now(timezone.utc).isoformat()

                devices_loc.append(MemberDeviceLocation(
                    entity_id=dt.entity_id,
                    device_name=friendly_name,
                    latitude=dt.latitude,
                    longitude=dt.longitude,
                    battery=battery,
                    accuracy=accuracy,
                    last_updated=last_updated_str
                ))

        response.append(MemberResponse(
            id=member.id,
            username=member.username,
            display_name=member.display_name,
            avatar_color=member.avatar_color,
            profile_picture_url=member.profile_picture_url,
            devices=devices_loc
        ))

    return response
