import asyncio
import fnmatch
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Set, Union
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from app.core.logging import logger
from app.core.security import verify_jwt_token
from app.db.database import async_session_maker
from app.db.models import User, Device, EntityState, Place, CircleMember
from app.services.event_service import event_bus
from app.services.state_service import StateService
from app.services.websocket_service import session_manager

router = APIRouter()

# ---------------------------------------------------------------------------
# Home Assistant Entity Filter Implementation (Core helpers/entityfilter.py)
# ---------------------------------------------------------------------------

class EntityFilter:
    """Matches entities against entity_ids, include/exclude domains, entities, and globs."""

    def __init__(
        self,
        entity_ids: Optional[Set[str]] = None,
        include_domains: Optional[Set[str]] = None,
        include_entities: Optional[Set[str]] = None,
        include_globs: Optional[List[str]] = None,
        exclude_domains: Optional[Set[str]] = None,
        exclude_entities: Optional[Set[str]] = None,
        exclude_globs: Optional[List[str]] = None,
    ) -> None:
        self.explicit_entity_ids = entity_ids
        self.include_d = include_domains or set()
        self.include_e = include_entities or set()
        self.exclude_d = exclude_domains or set()
        self.exclude_e = exclude_entities or set()

        self.include_pattern = self._compile_globs(include_globs)
        self.exclude_pattern = self._compile_globs(exclude_globs)

        self.have_include = bool(self.include_e or self.include_d or self.include_pattern)
        self.have_exclude = bool(self.exclude_e or self.exclude_d or self.exclude_pattern)

    @staticmethod
    def _compile_globs(globs: Optional[List[str]]) -> Optional[re.Pattern]:
        if not globs:
            return None
        patterns = [fnmatch.translate(g) for g in globs if g]
        if not patterns:
            return None
        return re.compile("|".join(patterns))

    def matches(self, entity_id: str) -> bool:
        # If top-level entity_ids was explicitly given, entity must be present in it
        if self.explicit_entity_ids is not None:
            if entity_id not in self.explicit_entity_ids:
                return False

        # If neither include nor exclude are specified, match everything
        if not self.have_include and not self.have_exclude:
            return True

        domain = entity_id.split(".", 1)[0] if "." in entity_id else ""

        # Case 2: Only includes
        if self.have_include and not self.have_exclude:
            return (
                entity_id in self.include_e
                or domain in self.include_d
                or bool(self.include_pattern and self.include_pattern.match(entity_id))
            )

        # Case 3: Only excludes
        if not self.have_include and self.have_exclude:
            return not (
                entity_id in self.exclude_e
                or domain in self.exclude_d
                or bool(self.exclude_pattern and self.exclude_pattern.match(entity_id))
            )

        # Case 4: Domain and/or glob includes (may also have excludes)
        if self.include_d or self.include_pattern:
            return entity_id in self.include_e or (
                entity_id not in self.exclude_e
                and (
                    bool(self.include_pattern and self.include_pattern.match(entity_id))
                    or (
                        domain in self.include_d
                        and not (self.exclude_pattern and self.exclude_pattern.match(entity_id))
                    )
                )
            )

        # Case 5: Domain and/or glob excludes (no domain and/or glob includes)
        if self.exclude_d or self.exclude_pattern:
            if domain in self.exclude_d or bool(self.exclude_pattern and self.exclude_pattern.match(entity_id)):
                return entity_id in self.include_e
            return entity_id not in self.exclude_e

        # Fallback: only include_e and exclude_e
        return entity_id in self.include_e and entity_id not in self.exclude_e


def extract_entity_filter(msg: Dict[str, Any]) -> EntityFilter:
    explicit_entity_ids = None
    if "entity_ids" in msg and isinstance(msg["entity_ids"], list):
        explicit_entity_ids = set(str(e) for e in msg["entity_ids"] if e)

    inc = msg.get("include") if isinstance(msg.get("include"), dict) else {}
    exc = msg.get("exclude") if isinstance(msg.get("exclude"), dict) else {}

    def ensure_list(v: Any) -> List[str]:
        if isinstance(v, list):
            return [str(x) for x in v if x is not None]
        if isinstance(v, str):
            return [v]
        return []

    include_domains = set(ensure_list(inc.get("domains") or msg.get("include_domains")))
    include_entities = set(ensure_list(inc.get("entities") or msg.get("include_entities")))
    include_globs = ensure_list(inc.get("entity_globs") or msg.get("include_entity_globs"))

    exclude_domains = set(ensure_list(exc.get("domains") or msg.get("exclude_domains")))
    exclude_entities = set(ensure_list(exc.get("entities") or msg.get("exclude_entities")))
    exclude_globs = ensure_list(exc.get("entity_globs") or msg.get("exclude_entity_globs"))

    return EntityFilter(
        entity_ids=explicit_entity_ids,
        include_domains=include_domains,
        include_entities=include_entities,
        include_globs=include_globs,
        exclude_domains=exclude_domains,
        exclude_entities=exclude_entities,
        exclude_globs=exclude_globs,
    )


# ---------------------------------------------------------------------------
# Compressed Entity Serialization (HA Core as_compressed_state & messages.py)
# ---------------------------------------------------------------------------

def to_timestamp_seconds(val: Any, default_val: float) -> float:
    if val is None:
        return default_val
    if isinstance(val, (int, float)):
        return float(val)
    if hasattr(val, "timestamp"):
        return val.timestamp()
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00")).timestamp()
        except Exception:
            return default_val
    return default_val


def build_compressed_entity_state(
    state_val: Any,
    attributes: Optional[Dict[str, Any]],
    context_obj: Any,
    last_changed: Any,
    last_updated: Any
) -> Dict[str, Any]:
    now_ts = time.time()
    lc_ts = to_timestamp_seconds(last_changed, now_ts)
    lu_ts = to_timestamp_seconds(last_updated, lc_ts)

    # Format context
    ctx = "ctx"
    if isinstance(context_obj, str):
        ctx = context_obj
    elif isinstance(context_obj, dict):
        if context_obj.get("parent_id") is None and context_obj.get("user_id") is None and "id" in context_obj:
            ctx = str(context_obj["id"])
        else:
            ctx = {k: v for k, v in context_obj.items() if v is not None}

    s_str = "unknown" if state_val is None else str(state_val)

    compressed: Dict[str, Any] = {
        "s": s_str,
        "a": attributes or {},
        "c": ctx,
        "lc": lc_ts
    }
    # HA Core: omit 'lu' if last_updated == last_changed
    if lu_ts != lc_ts:
        compressed["lu"] = lu_ts

    return compressed


def build_state_diff_event(
    entity_id: str,
    old_state: Optional[Dict[str, Any]],
    new_state: Optional[Dict[str, Any]],
    context_obj: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    # Case 1: Entity removed/deleted
    if new_state is None:
        return {"r": [entity_id]}

    ctx = context_obj or {}
    ctx_val: Union[str, Dict[str, Any]] = ctx.get("id") or f"ctx_{entity_id}"
    if ctx.get("user_id") is not None or ctx.get("parent_id") is not None:
        ctx_val = {k: v for k, v in ctx.items() if v is not None}

    # Case 2: Entity added
    if old_state is None:
        compressed = build_compressed_entity_state(
            state_val=new_state.get("state"),
            attributes=new_state.get("attributes"),
            context_obj=ctx_val,
            last_changed=new_state.get("last_changed"),
            last_updated=new_state.get("last_updated")
        )
        return {"a": {entity_id: compressed}}

    # Case 3: Entity changed
    additions: Dict[str, Any] = {}
    diff: Dict[str, Any] = {"+": additions}

    old_s = str(old_state.get("state", ""))
    new_s = str(new_state.get("state", ""))
    if old_s != new_s:
        additions["s"] = new_s

    now_ts = time.time()
    old_lc = to_timestamp_seconds(old_state.get("last_changed"), now_ts)
    new_lc = to_timestamp_seconds(new_state.get("last_changed"), now_ts)
    old_lu = to_timestamp_seconds(old_state.get("last_updated"), old_lc)
    new_lu = to_timestamp_seconds(new_state.get("last_updated"), new_lc)

    if old_lc != new_lc:
        additions["lc"] = new_lc
    elif old_lu != new_lu:
        additions["lu"] = new_lu

    additions["c"] = ctx_val

    old_attrs = old_state.get("attributes") or {}
    new_attrs = new_state.get("attributes") or {}

    added_attrs = {
        k: v for k, v in new_attrs.items()
        if k not in old_attrs or old_attrs[k] != v
    }
    if added_attrs:
        additions["a"] = added_attrs

    removed_keys = list(old_attrs.keys() - new_attrs.keys())
    if removed_keys:
        diff["-"] = {"a": removed_keys}

    return {"c": {entity_id: diff}}


async def session_keepalive(session: Any) -> None:
    """Keeps session alive. WS protocol ping/pong is handled at transport layer."""
    try:
        while True:
            await asyncio.sleep(25)
    except asyncio.CancelledError:
        pass


# ---------------------------------------------------------------------------
# WebSocket Endpoint Lifecycle
# ---------------------------------------------------------------------------

@router.websocket("/api/websocket")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    session = session_manager.connect(websocket)
    client_ip = websocket.client.host if websocket.client else "unknown"
    logger.info(f"WebSocket client connected [conn_id={session.id}, ip={client_ip}]. Initiating Home Assistant handshake.")

    explicit_close_called = False

    # 1. Send auth_required challenge
    await session.send_json({
        "type": "auth_required",
        "ha_version": "2026.9.1"
    })

    # 2. Wait for auth response
    try:
        auth_msg = await websocket.receive_json()
        if not isinstance(auth_msg, dict) or auth_msg.get("type") != "auth":
            await session.send_json({
                "type": "auth_invalid",
                "message": "Auth message required"
            })
            explicit_close_called = True
            await websocket.close()
            session_manager.disconnect(session)
            return

        token = auth_msg.get("access_token")
        payload = verify_jwt_token(token or "")
        if not payload:
            await session.send_json({
                "type": "auth_invalid",
                "message": "Invalid access token"
            })
            explicit_close_called = True
            await websocket.close()
            session_manager.disconnect(session)
            return

        # Authenticate user
        user_id_str = payload.get("sub")
        if not user_id_str:
            await session.send_json({
                "type": "auth_invalid",
                "message": "Malformed token sub claim"
            })
            explicit_close_called = True
            await websocket.close()
            session_manager.disconnect(session)
            return

        user_id = int(user_id_str)
        async with async_session_maker() as db:
            stmt = select(User).where(User.id == user_id, User.is_active == True)
            res = await db.execute(stmt)
            user = res.scalar_one_or_none()

        if not user:
            await session.send_json({
                "type": "auth_invalid",
                "message": "User not found or deactivated"
            })
            explicit_close_called = True
            await websocket.close()
            session_manager.disconnect(session)
            return

        # Handshake success!
        session.user_id = user_id
        await session.send_json({
            "type": "auth_ok",
            "ha_version": "2026.9.1"
        })
        logger.info(f"WebSocket client authenticated successfully [conn_id={session.id}, user_id={user.id}, username={user.username}]")

    except Exception as e:
        logger.error(f"WebSocket auth handshake failed [conn_id={session.id}]: {e}")
        try:
            explicit_close_called = True
            await websocket.close()
        except Exception:
            pass
        session_manager.disconnect(session)
        return

    # Start keepalive heartbeat task
    keepalive_task = asyncio.create_task(session_keepalive(session))

    # 3. Handle commands loop
    try:
        while True:
            msg = await websocket.receive_json()
            if not isinstance(msg, dict):
                continue

            cmd_id = msg.get("id")
            cmd_type = msg.get("type")

            if cmd_type == "pong":
                continue

            if cmd_type == "ping" and cmd_id is None:
                await session.send_json({"type": "pong"})
                continue

            if not isinstance(cmd_id, int) or not cmd_type:
                await session.send_json({
                    "type": "result",
                    "success": False,
                    "error": {"code": "invalid_format", "message": "Message ID (int) and type are required."}
                })
                continue

            try:
                await handle_command(session, cmd_id, cmd_type, msg)
            except Exception as cmd_err:
                logger.error(f"Error handling WebSocket command '{cmd_type}' (id: {cmd_id}, conn_id={session.id}): {cmd_err}")
                await session.send_json({
                    "id": cmd_id,
                    "type": "result",
                    "success": False,
                    "error": {"code": "internal_error", "message": f"Error executing command '{cmd_type}'."}
                })

    except WebSocketDisconnect as wsd:
        duration = round(time.time() - session.connected_at, 2)
        code = getattr(wsd, "code", 1000)
        reason = getattr(wsd, "reason", "") or "No reason provided"
        logger.info(
            f"WebSocket receive loop terminated: CLIENT -> CLOSE "
            f"[conn_id={session.id}, user_id={session.user_id}, duration={duration}s, "
            f"close_code={code}, reason='{reason}', server_close_called={explicit_close_called}]"
        )
    except Exception as e:
        duration = round(time.time() - session.connected_at, 2)
        logger.error(
            f"WebSocket receive loop terminated with exception "
            f"[conn_id={session.id}, user_id={session.user_id}, duration={duration}s, "
            f"error_type={type(e).__name__}, error={e}, server_close_called={explicit_close_called}]"
        )
    finally:
        keepalive_task.cancel()
        session_manager.disconnect(session)
        duration = round(time.time() - session.connected_at, 2)
        logger.info(
            f"WebSocket endpoint returned and session destroyed "
            f"[conn_id={session.id}, user_id={session.user_id}, duration={duration}s]"
        )


# ---------------------------------------------------------------------------
# Command Dispatcher
# ---------------------------------------------------------------------------

async def handle_command(session: Any, cmd_id: int, cmd_type: str, msg: Dict[str, Any]) -> None:
    user_id = session.user_id

    if cmd_type in ("auth/current_user", "user/current"):
        async with async_session_maker() as db:
            stmt = select(User).where(User.id == user_id)
            res = await db.execute(stmt)
            u = res.scalar_one_or_none()
            user_name = (u.display_name or u.username) if u else f"User {user_id}"
            user_id_str = str(u.id) if u else str(user_id)

        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": {
                "id": user_id_str,
                "name": user_name,
                "is_owner": True,
                "is_admin": True,
                "credentials": [],
                "mfa_modules": []
            }
        })

    elif cmd_type == "ping":
        await session.send_json({
            "id": cmd_id,
            "type": "pong"
        })

    elif cmd_type == "supported_features":
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": None
        })

    elif cmd_type == "get_states":
        async with async_session_maker() as db:
            entities = await StateService.get_all_states(db, user_id)
            states_list = [
                {
                    "entity_id": e.entity_id,
                    "state": e.state,
                    "attributes": e.attributes,
                    "last_changed": e.last_changed.isoformat(),
                    "last_updated": e.last_updated.isoformat(),
                    "context": {"id": f"ctx_{e.entity_id}", "user_id": str(user_id)}
                }
                for e in entities
            ]
            await session.send_json({
                "id": cmd_id,
                "type": "result",
                "success": True,
                "result": states_list
            })

    elif cmd_type == "get_config":
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": {
                "latitude": 0.0,
                "longitude": 0.0,
                "elevation": 0,
                "unit_system": {"length": "km", "mass": "g", "temperature": "°C", "volume": "L"},
                "location_name": "Home Assistant",
                "time_zone": "UTC",
                "components": ["api", "websocket", "mobile_app", "device_tracker", "sensor"],
                "version": "2026.9.1"
            }
        })

    elif cmd_type == "subscribe_events":
        if cmd_id in session.subscriptions:
            await session.send_json({
                "id": cmd_id,
                "type": "result",
                "success": False,
                "error": {"code": "id_reuse", "message": "Identifier values have to increase."}
            })
            return

        event_type = msg.get("event_type", "state_changed")

        # Define dynamic callback to send events belonging to this session's user
        async def event_callback(event_obj: Dict[str, Any]) -> None:
            # Enforce user boundary/isolation
            event_user_id = event_obj.get("context", {}).get("user_id")
            if event_user_id is None or event_user_id == user_id or str(event_user_id) == str(user_id):
                await session.send_json({
                    "id": cmd_id,  # Must match client's subscription request ID
                    "type": "event",
                    "event": event_obj
                })

        # Register event listener
        unsubscribe_func = event_bus.subscribe(event_type, event_callback)
        session.subscriptions[cmd_id] = unsubscribe_func

        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": None
        })
        logger.info(f"User {user_id} subscribed to WebSocket event type: {event_type} (sub_id: {cmd_id})")

    elif cmd_type == "subscribe_entities":
        if cmd_id in session.subscriptions:
            await session.send_json({
                "id": cmd_id,
                "type": "result",
                "success": False,
                "error": {"code": "id_reuse", "message": "Identifier values have to increase."}
            })
            return

        entity_filter = extract_entity_filter(msg)

        async with async_session_maker() as db:
            entities = await StateService.get_all_states(db, user_id)

        now_ts = time.time()
        initial_entities: Dict[str, Any] = {}
        for e in entities:
            if not entity_filter.matches(e.entity_id):
                continue
            initial_entities[e.entity_id] = build_compressed_entity_state(
                state_val=e.state,
                attributes=e.attributes,
                context_obj=f"ctx_{e.entity_id}",
                last_changed=e.last_changed,
                last_updated=e.last_updated
            )

        # 1. Acknowledge subscription success (send result confirmation first)
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": None
        })

        # 2. Emit initial entities snapshot under "a" key
        await session.send_json({
            "id": cmd_id,
            "type": "event",
            "event": {
                "a": initial_entities
            }
        })

        # 3. Stream live state_changed updates matching filter
        async def entity_diff_callback(event_obj: Dict[str, Any]) -> None:
            # Enforce user boundary/isolation
            event_user_id = event_obj.get("context", {}).get("user_id")
            if event_user_id is not None and event_user_id != user_id and str(event_user_id) != str(user_id):
                return

            data = event_obj.get("data", {})
            entity_id = data.get("entity_id")
            if not entity_id or not entity_filter.matches(entity_id):
                return

            diff_event = build_state_diff_event(
                entity_id=entity_id,
                old_state=data.get("old_state"),
                new_state=data.get("new_state"),
                context_obj=event_obj.get("context")
            )
            if diff_event:
                await session.send_json({
                    "id": cmd_id,
                    "type": "event",
                    "event": diff_event
                })

        unsubscribe_func = event_bus.subscribe("state_changed", entity_diff_callback)
        session.subscriptions[cmd_id] = unsubscribe_func
        logger.info(f"User {user_id} subscribed to WebSocket entities stream [conn_id={session.id}, sub_id={cmd_id}, initial_count={len(initial_entities)}]")

    elif cmd_type in ("unsubscribe_events", "unsubscribe_entities"):
        sub_id = msg.get("subscription")
        if isinstance(sub_id, int) and sub_id in session.subscriptions:
            unsubscribe_func = session.subscriptions.pop(sub_id)
            try:
                unsubscribe_func()
            except Exception:
                pass
            await session.send_json({
                "id": cmd_id,
                "type": "result",
                "success": True,
                "result": None
            })
            logger.info(f"User {user_id} unsubscribed from subscription ID: {sub_id} [conn_id={session.id}]")
        else:
            await session.send_json({
                "id": cmd_id,
                "type": "result",
                "success": False,
                "error": {"code": "not_found", "message": "Subscription not found."}
            })

    elif cmd_type == "get_services":
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": {}
        })

    elif cmd_type == "get_panels":
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": {
                "lovelace": {
                    "title": "Home",
                    "icon": "mdi:home-assistant",
                    "url_path": "lovelace",
                    "config": {"views": []}
                }
            }
        })

    elif cmd_type == "frontend/get_translations":
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": {"resources": {}}
        })

    elif cmd_type == "manifest/list":
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": []
        })

    elif cmd_type == "config/device_registry/list":
        async with async_session_maker() as db:
            stmt = select(Device).where(Device.user_id == user_id)
            res = await db.execute(stmt)
            devices = res.scalars().all()
            device_list = [
                {
                    "id": str(d.id),
                    "name": d.device_name,
                    "model": d.model,
                    "manufacturer": d.manufacturer,
                    "sw_version": d.os_version,
                    "identifiers": [["mobile_app", d.device_id]],
                    "connections": [],
                    "area_id": None,
                    "disabled_by": None,
                    "entry_type": None
                }
                for d in devices
            ]
            await session.send_json({
                "id": cmd_id,
                "type": "result",
                "success": True,
                "result": device_list
            })

    elif cmd_type == "config/entity_registry/list":
        async with async_session_maker() as db:
            stmt = select(EntityState).where(EntityState.user_id == user_id)
            res = await db.execute(stmt)
            entities = res.scalars().all()
            entity_list = [
                {
                    "entity_id": e.entity_id,
                    "name": e.attributes.get("friendly_name") if isinstance(e.attributes, dict) else None,
                    "icon": e.attributes.get("icon") if isinstance(e.attributes, dict) else None,
                    "platform": "mobile_app",
                    "config_entry_id": None,
                    "device_id": str(e.device_id) if e.device_id else None,
                    "area_id": None,
                    "disabled_by": None,
                    "capabilities": {}
                }
                for e in entities
            ]
            await session.send_json({
                "id": cmd_id,
                "type": "result",
                "success": True,
                "result": entity_list
            })

    elif cmd_type == "config/entity_registry/list_for_display":
        async with async_session_maker() as db:
            stmt = select(EntityState).where(EntityState.user_id == user_id)
            res = await db.execute(stmt)
            entities = res.scalars().all()
            display_entities = [
                {
                    "entity_id": e.entity_id,
                    "name": e.attributes.get("friendly_name") if isinstance(e.attributes, dict) else None,
                    "icon": e.attributes.get("icon") if isinstance(e.attributes, dict) else None,
                    "platform": "mobile_app",
                    "device_id": str(e.device_id) if e.device_id else None,
                    "area_id": None,
                    "disabled_by": None,
                    "hidden_by": None,
                    "entity_category": None,
                    "translation_key": None
                }
                for e in entities
            ]
            await session.send_json({
                "id": cmd_id,
                "type": "result",
                "success": True,
                "result": {
                    "entity_categories": {},
                    "entities": display_entities
                }
            })

    elif cmd_type in ("config/floor_registry/list", "config/label_registry/list", "config/category_registry/list"):
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": []
        })

    elif cmd_type == "config/zone_registry/list":
        async with async_session_maker() as db:
            stmt_circles = select(CircleMember.circle_id).where(CircleMember.user_id == user_id)
            res_circles = await db.execute(stmt_circles)
            circle_ids = res_circles.scalars().all()
            zone_list = []
            if circle_ids:
                stmt_places = select(Place).where(Place.circle_id.in_(circle_ids))
                res_places = await db.execute(stmt_places)
                places = res_places.scalars().all()
                zone_list = [
                    {
                        "id": f"zone_{p.id}",
                        "name": p.name,
                        "latitude": p.latitude,
                        "longitude": p.longitude,
                        "radius": p.radius or 100,
                        "icon": "mdi:map-marker",
                        "passive": False
                    }
                    for p in places
                ]
            await session.send_json({
                "id": cmd_id,
                "type": "result",
                "success": True,
                "result": zone_list
            })

    elif cmd_type == "config/area_registry/list":
        async with async_session_maker() as db:
            stmt_circles = select(CircleMember.circle_id).where(CircleMember.user_id == user_id)
            res_circles = await db.execute(stmt_circles)
            circle_ids = res_circles.scalars().all()
            area_list = []
            if circle_ids:
                stmt_places = select(Place).where(Place.circle_id.in_(circle_ids))
                res_places = await db.execute(stmt_places)
                places = res_places.scalars().all()
                area_list = [
                    {
                        "area_id": f"area_{p.id}",
                        "name": p.name,
                        "picture": None,
                        "aliases": []
                    }
                    for p in places
                ]
            await session.send_json({
                "id": cmd_id,
                "type": "result",
                "success": True,
                "result": area_list
            })

    elif cmd_type == "frontend/get_user_data":
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": {
                "show_advanced_options": False
            }
        })

    elif cmd_type == "persistent_notification/get":
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": []
        })

    elif cmd_type in (
        "subscribe_trigger",
        "persistent_notification/subscribe",
        "mobile_app/push_notification_channel",
        "mobile_app/push_notification_confirm",
        "mobile_app/get_push_notifications",
        "sensor/push",
        "camera/stream",
        "render_template"
    ):
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": None
        })

    elif cmd_type == "call_service":
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": {
                "context": {
                    "id": f"ctx_{cmd_id}",
                    "user_id": str(user_id)
                }
            }
        })

    else:
        # Return standard unknown_command error for unrecognized commands
        logger.warning(f"Unsupported command type received: {cmd_type}")
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": False,
            "error": {"code": "unknown_command", "message": f"Command '{cmd_type}' is not supported."}
        })
