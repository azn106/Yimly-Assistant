import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import Device, LocationHistory, SensorRegistration
from app.schemas.telemetry import LocationUpdateData, SensorRegistrationData, SensorStateUpdate
from app.services.state_service import StateService

def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r'[^a-z0-9_]', '_', text)
    text = re.sub(r'_+', '_', text)
    return text.strip('_')

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    # Radius of Earth in meters
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * \
        math.sin(delta_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

class TelemetryService:
    @staticmethod
    async def process_location_update(
        db: AsyncSession,
        device: Device,
        data: LocationUpdateData
    ) -> Dict[str, Any]:
        # Validate coordinates (redundant sanity check, Pydantic handles this but good to have)
        if not (-90.0 <= data.latitude <= 90.0) or not (-180.0 <= data.longitude <= 180.0):
            raise ValueError("Coordinates are out of bounds")

        now = datetime.now(timezone.utc)

        # 1. Log Location History
        loc_history = LocationHistory(
            device_id=device.id,
            user_id=device.user_id,
            latitude=data.latitude,
            longitude=data.longitude,
            accuracy=data.gps_accuracy,
            altitude=data.altitude,
            speed=data.speed,
            bearing=data.bearing,
            timestamp=now,
            trigger=data.trigger
        )
        db.add(loc_history)
        await db.commit()

        # 2. Update Device Tracker Entity State
        entity_name = slugify(device.device_name)
        if not entity_name:
            entity_name = f"device_{device.id}"
        entity_id = f"device_tracker.{entity_name}"

        # Determine if "home" or "not_home" (near the configured latitude/longitude from config)
        # We can read home lat/lon from a configuration. Let's default to server 0,0 or check if it's within 100 meters
        # In a real environment, the server is set to a specific location.
        distance_to_home = haversine_distance(data.latitude, data.longitude, 0.0, 0.0)
        state_val = "home" if distance_to_home <= 150.0 else "not_home"

        # Build state attributes
        attributes = {
            "latitude": data.latitude,
            "longitude": data.longitude,
            "gps_accuracy": data.gps_accuracy,
            "altitude": data.altitude,
            "speed": data.speed,
            "course": data.bearing,
            "battery_level": data.battery,
            "friendly_name": device.device_name,
            "source_type": "gps"
        }

        # Filter out None values
        attributes = {k: v for k, v in attributes.items() if v is not None}

        await StateService.set_state(
            db=db,
            user_id=device.user_id,
            entity_id=entity_id,
            state=state_val,
            attributes=attributes,
            device_id=device.id,
            latitude=data.latitude,
            longitude=data.longitude
        )

        # Update last_seen_at for the device
        device.last_seen_at = now
        await db.commit()

        return {"status": "ok"}

    @staticmethod
    async def process_sensor_registration(
        db: AsyncSession,
        device: Device,
        data: SensorRegistrationData
    ) -> Dict[str, Any]:
        # Generate stable entity ID for this sensor
        dev_slug = slugify(device.device_name) or f"device_{device.id}"
        sensor_slug = slugify(data.name) or slugify(data.unique_id)
        domain = data.type if data.type in ["sensor", "binary_sensor"] else "sensor"
        entity_id = f"{domain}.{dev_slug}_{sensor_slug}"

        stmt = select(SensorRegistration).where(
            SensorRegistration.device_id == device.id,
            SensorRegistration.unique_id == data.unique_id
        )
        result = await db.execute(stmt)
        reg = result.scalar_one_or_none()

        if reg:
            # Update metadata
            reg.name = data.name
            reg.entity_id = entity_id
            reg.unit_of_measurement = data.unit_of_measurement
            reg.icon = data.icon
            reg.device_class = data.device_class
            reg.state_class = data.state_class
            reg.entity_category = data.entity_category
            reg.disabled = data.disabled
        else:
            reg = SensorRegistration(
                unique_id=data.unique_id,
                device_id=device.id,
                user_id=device.user_id,
                entity_id=entity_id,
                name=data.name,
                unit_of_measurement=data.unit_of_measurement,
                icon=data.icon,
                device_class=data.device_class,
                state_class=data.state_class,
                entity_category=data.entity_category,
                disabled=data.disabled
            )
            db.add(reg)

        await db.commit()

        # Initialize or register entity state as "unknown" if it does not exist
        now_state = await StateService.get_state(db, device.user_id, entity_id)
        if not now_state:
            attributes = {
                "friendly_name": f"{device.device_name} {data.name}",
                "device_class": data.device_class,
                "unit_of_measurement": data.unit_of_measurement,
                "icon": data.icon
            }
            attributes = {k: v for k, v in attributes.items() if v is not None}
            await StateService.set_state(
                db=db,
                user_id=device.user_id,
                entity_id=entity_id,
                state="unknown",
                attributes=attributes,
                device_id=device.id
            )

        return {"status": "registered"}

    @staticmethod
    async def process_sensor_state_updates(
        db: AsyncSession,
        device: Device,
        updates: List[SensorStateUpdate]
    ) -> Dict[str, Any]:
        results = {}
        for item in updates:
            # Check registration for this unique_id
            stmt = select(SensorRegistration).where(
                SensorRegistration.device_id == device.id,
                SensorRegistration.unique_id == item.unique_id
            )
            result = await db.execute(stmt)
            reg = result.scalar_one_or_none()

            if not reg:
                # If not registered, return an error or skip. Home Assistant expects register_sensor first.
                results[item.unique_id] = {"error": {"code": "not_registered", "message": "Sensor must be registered first"}}
                continue

            entity_id = reg.entity_id

            # Prepare attributes
            attributes = {
                "friendly_name": f"{device.device_name} {reg.name}",
                "unit_of_measurement": reg.unit_of_measurement,
                "icon": reg.icon,
                "device_class": reg.device_class,
                "state_class": reg.state_class
            }
            # Merge incoming attributes
            if item.attributes:
                attributes.update(item.attributes)

            # Clean out None
            attributes = {k: v for k, v in attributes.items() if v is not None}

            # Update State Engine
            await StateService.set_state(
                db=db,
                user_id=device.user_id,
                entity_id=entity_id,
                state=str(item.state),
                attributes=attributes,
                device_id=device.id
            )
            results[item.unique_id] = {"success": True}

        return results
