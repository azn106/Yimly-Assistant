from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import EntityState
from app.services.event_service import event_bus

class StateService:
    @staticmethod
    async def get_state(db: AsyncSession, user_id: int, entity_id: str) -> Optional[EntityState]:
        stmt = select(EntityState).where(
            EntityState.user_id == user_id,
            EntityState.entity_id == entity_id
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_all_states(db: AsyncSession, user_id: int) -> List[EntityState]:
        stmt = select(EntityState).where(EntityState.user_id == user_id)
        result = await db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def set_state(
        db: AsyncSession,
        user_id: int,
        entity_id: str,
        state: str,
        attributes: Dict[str, Any],
        device_id: Optional[int] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None
    ) -> EntityState:
        domain = entity_id.split(".", 1)[0] if "." in entity_id else "sensor"
        now = datetime.now(timezone.utc)

        stmt = select(EntityState).where(
            EntityState.user_id == user_id,
            EntityState.entity_id == entity_id
        )
        result = await db.execute(stmt)
        entity = result.scalar_one_or_none()

        old_state = None
        if entity:
            old_state = {
                "entity_id": entity.entity_id,
                "state": entity.state,
                "attributes": entity.attributes,
                "last_changed": entity.last_changed.isoformat(),
                "last_updated": entity.last_updated.isoformat()
            }
            # If the state string changes, last_changed changes, otherwise remains
            if entity.state != str(state):
                entity.last_changed = now
            entity.last_updated = now
            entity.state = str(state)
            entity.attributes = attributes
            if device_id is not None:
                entity.device_id = device_id
            if latitude is not None:
                entity.latitude = latitude
            if longitude is not None:
                entity.longitude = longitude
        else:
            entity = EntityState(
                entity_id=entity_id,
                device_id=device_id,
                user_id=user_id,
                domain=domain,
                state=str(state),
                attributes=attributes,
                latitude=latitude,
                longitude=longitude,
                last_changed=now,
                last_updated=now
            )
            db.add(entity)

        await db.commit()
        await db.refresh(entity)

        new_state = {
            "entity_id": entity.entity_id,
            "state": entity.state,
            "attributes": entity.attributes,
            "last_changed": entity.last_changed.isoformat(),
            "last_updated": entity.last_updated.isoformat()
        }

        # Fire state_changed event
        await event_bus.fire(
            event_type="state_changed",
            event_data={
                "entity_id": entity_id,
                "old_state": old_state,
                "new_state": new_state
            },
            user_id=user_id
        )

        return entity
