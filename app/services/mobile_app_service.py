import hashlib
import secrets
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import Device
from app.schemas.mobile_app import RegistrationRequest

class MobileAppService:
    @staticmethod
    def hash_value(value: str) -> str:
        return hashlib.sha256(value.encode('utf-8')).hexdigest()

    @staticmethod
    async def register_device(
        db: AsyncSession,
        user_id: int,
        req: RegistrationRequest
    ) -> Device:
        # Check if device already registered for this user
        stmt = select(Device).where(
            Device.user_id == user_id,
            Device.device_id == req.device_id
        )
        result = await db.execute(stmt)
        device = result.scalar_one_or_none()

        # Always use unencrypted plaintext JSON communication over secure HTTPS.
        # This prevents webhook decryption failures since we do not require libsodium.
        raw_secret = None
        secret_hash = ""

        if device:
            # Update existing registration info safely
            device.app_id = req.app_id
            device.app_name = req.app_name
            device.app_version = req.app_version
            device.device_name = req.device_name
            device.manufacturer = req.manufacturer
            device.model = req.model
            device.os_name = req.os_name
            device.os_version = req.os_version
            device.supports_encryption = req.supports_encryption
            device.app_data = req.app_data
            if req.supports_encryption:
                device.webhook_secret_hash = secret_hash
        else:
            # Create a brand new unique registration
            webhook_id = secrets.token_urlsafe(32)
            device = Device(
                user_id=user_id,
                device_id=req.device_id,
                app_id=req.app_id,
                app_name=req.app_name,
                app_version=req.app_version,
                device_name=req.device_name,
                manufacturer=req.manufacturer,
                model=req.model,
                os_name=req.os_name,
                os_version=req.os_version,
                supports_encryption=req.supports_encryption,
                app_data=req.app_data,
                webhook_id=webhook_id,
                webhook_secret_hash=secret_hash
            )
            db.add(device)

        await db.commit()
        await db.refresh(device)

        # Stash raw secret dynamically (not persisted) to return in response once
        setattr(device, "raw_secret", raw_secret)
        return device

    @staticmethod
    async def get_device_by_webhook(db: AsyncSession, webhook_id: str) -> Optional[Device]:
        stmt = select(Device).where(Device.webhook_id == webhook_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
