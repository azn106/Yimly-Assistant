from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.logging import logger
from app.db.database import get_db
from app.schemas.telemetry import LocationUpdateData, SensorRegistrationData, SensorStateUpdate
from app.services.mobile_app_service import MobileAppService
from app.services.telemetry_service import TelemetryService

router = APIRouter()

@router.post("/api/webhook/{webhook_id}")
async def handle_webhook(
    webhook_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    device = await MobileAppService.get_device_by_webhook(db, webhook_id)
    if not device:
        # HTTP 410 Gone is critical! It signals the mobile app that the server deleted/revoked
        # this registration, which triggers the app to prompt the user to re-establish the pairing.
        logger.warning(f"Unrecognized webhook_id {webhook_id}. Returning HTTP 410.")
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Webhook deleted or not found.")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request body is not valid JSON.")

    req_type = payload.get("type")
    req_data = payload.get("data")

    if not req_type or req_data is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payload must contain 'type' and 'data' fields.")

    if req_type == "update_location":
        try:
            # Handle list/dict flexibility
            if isinstance(req_data, list):
                if not req_data:
                    return {"status": "ok"}
                req_data = req_data[0]
            
            loc_data = LocationUpdateData(**req_data)
            res = await TelemetryService.process_location_update(db, device, loc_data)
            return res
        except Exception as e:
            logger.error(f"Failed to process location update webhook: {e}")
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Location payload validation error: {e}")

    elif req_type == "register_sensor":
        try:
            sensor_data = SensorRegistrationData(**req_data)
            res = await TelemetryService.process_sensor_registration(db, device, sensor_data)
            return res
        except Exception as e:
            logger.error(f"Failed to process sensor registration: {e}")
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Sensor registration validation error: {e}")

    elif req_type == "update_sensor_states":
        try:
            if not isinstance(req_data, list):
                raise ValueError("update_sensor_states data field must be an array.")
            
            updates = [SensorStateUpdate(**item) for item in req_data]
            res = await TelemetryService.process_sensor_state_updates(db, device, updates)
            return res
        except Exception as e:
            logger.error(f"Failed to process sensor updates: {e}")
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Sensor states update error: {e}")

    else:
        logger.warning(f"Received unhandled webhook command type: {req_type}")
        return {}
