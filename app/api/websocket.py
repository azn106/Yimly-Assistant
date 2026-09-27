import asyncio
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from app.core.logging import logger
from app.core.security import verify_jwt_token
from app.db.database import async_session_maker
from app.db.models import User
from app.services.event_service import event_bus
from app.services.state_service import StateService
from app.services.websocket_service import session_manager

router = APIRouter()

async def session_keepalive(session: Any) -> None:
    """Keeps session alive. WS protocol ping/pong is handled at transport layer."""
    try:
        while True:
            await asyncio.sleep(25)
    except asyncio.CancelledError:
        pass

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

async def handle_command(session: Any, cmd_id: int, cmd_type: str, msg: Dict[str, Any]) -> None:
    user_id = session.user_id

    if cmd_type == "auth/current_user":
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
        event_type = msg.get("event_type", "state_changed")

        # Define dynamic callback to send events belonging to this session's user
        async def event_callback(event_obj: Dict[str, Any]) -> None:
            # Enforce user boundary/isolation
            event_user_id = event_obj.get("context", {}).get("user_id")
            if event_user_id is None or event_user_id == user_id or str(event_user_id) == str(user_id):
                await session.send_json({
                    "id": cmd_id,  # Critical: Must match client's subscription request ID!
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
        entity_ids = msg.get("entity_ids")
        filter_set = set(entity_ids) if isinstance(entity_ids, list) and entity_ids else None

        async with async_session_maker() as db:
            entities = await StateService.get_all_states(db, user_id)

        now_ts = time.time()
        initial_entities = {}
        for e in entities:
            if filter_set and e.entity_id not in filter_set:
                continue
            lc = e.last_changed.timestamp() if hasattr(e.last_changed, "timestamp") else now_ts
            lu = e.last_updated.timestamp() if hasattr(e.last_updated, "timestamp") else now_ts
            initial_entities[e.entity_id] = {
                "s": str(e.state),
                "a": e.attributes or {},
                "c": f"ctx_{e.entity_id}",
                "lc": lc,
                "lu": lu
            }

        # 1. Acknowledge subscription success
        await session.send_json({
            "id": cmd_id,
            "type": "result",
            "success": True,
            "result": None
        })

        # 2. Emit initial entities dump under "a" key
        await session.send_json({
            "id": cmd_id,
            "type": "event",
            "event": {
                "a": initial_entities
            }
        })

        # 3. Stream state_changed updates as diffs under "c"
        async def entity_diff_callback(event_obj: Dict[str, Any]) -> None:
            event_user_id = event_obj.get("context", {}).get("user_id")
            if event_user_id is not None and event_user_id != user_id and str(event_user_id) != str(user_id):
                return

            data = event_obj.get("data", {})
            entity_id = data.get("entity_id")
            if not entity_id or (filter_set and entity_id not in filter_set):
                return

            new_state_obj = data.get("new_state", {})
            now_t = time.time()
            await session.send_json({
                "id": cmd_id,
                "type": "event",
                "event": {
                    "c": {
                        entity_id: {
                            "+": {
                                "s": str(new_state_obj.get("state", "")),
                                "a": new_state_obj.get("attributes", {}),
                                "lu": now_t,
                                "lc": now_t,
                                "c": event_obj.get("context", {}).get("id") or f"ctx_{cmd_id}"
                            }
                        }
                    }
                }
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
                "error": {"code": "not_found", "message": "Subscription ID not active or found."}
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
            from app.db.models import Device
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
            from app.db.models import EntityState
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

    elif cmd_type == "config/area_registry/list":
        async with async_session_maker() as db:
            from app.db.models import Place, CircleMember
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
