from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import require_authenticated_user
from app.core.logging import logger
from app.db.database import get_db
from app.db.models import User
from app.schemas.mobile_app import RegistrationRequest, RegistrationResponse
from app.services.mobile_app_service import MobileAppService

router = APIRouter()

@router.post(
    "/api/mobile_app/registrations",
    response_model=RegistrationResponse,
    status_code=status.HTTP_201_CREATED
)
async def register_mobile_app(
    payload: RegistrationRequest,
    user: User = Depends(require_authenticated_user),
    db: AsyncSession = Depends(get_db)
) -> RegistrationResponse:
    logger.info(f"Received device registration request from app_id: {payload.app_id}, device_id: {payload.device_id}")
    try:
        device = await MobileAppService.register_device(
            db=db,
            user_id=user.id,
            req=payload
        )
    except Exception as e:
        logger.error(f"Error registering mobile device: {e}")
        raise HTTPException(status_code=500, detail="Failed to complete device registration transaction.")

    raw_secret = getattr(device, "raw_secret", None)
    logger.info(f"Successfully registered device {device.device_name} (ID: {device.id}). Webhook ID generated.")

    return RegistrationResponse(
        webhook_id=device.webhook_id,
        secret=raw_secret,
        cloudhook_url=None,
        remote_ui_url=None
    )
