import asyncio
import json
import logging
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Set
from urllib.parse import urlparse

from app.core.config import settings
from app.schemas.circles import MemberDeviceLocation

logger = logging.getLogger(__name__)

class HomeAssistantClient:
    """
    Official Home Assistant Core Client for Yimly-Assistant.
    Communicates with official Home Assistant Core via REST API and WebSocket API
    using a Home Assistant Long-Lived Access Token (LLAT).
    
    Architecture:
    Official Home Assistant Core -> HA REST & WebSocket API -> LLAT -> Yimly Backend -> Yimly Map -> User
    """

    def __init__(self) -> None:
        self.ha_url: str = settings.HA_URL.rstrip("/") if settings.HA_URL else ""
        self.token: str = settings.HA_LONG_LIVED_ACCESS_TOKEN or ""
        self.is_connected: bool = False
        self.ws_task: Optional[asyncio.Task] = None
        self._should_run: bool = False

        # In-memory entity states cache: entity_id -> state dict
        self._entities: Dict[str, Dict[str, Any]] = {}
        self._config: Dict[str, Any] = {}
        self._subscribers: Set[Callable[[str, Optional[Dict[str, Any]], Optional[Dict[str, Any]]], None]] = set()
        self._lock = asyncio.Lock()
        self._msg_id: int = 1

    def reload_config(self) -> None:
        """Reloads settings from environment / config dynamically if updated."""
        self.ha_url = settings.HA_URL.rstrip("/") if settings.HA_URL else ""
        self.token = settings.HA_LONG_LIVED_ACCESS_TOKEN or ""

    def is_configured(self) -> bool:
        """Checks if Home Assistant Core connection parameters are configured."""
        self.reload_config()
        return bool(self.ha_url and self.token)

    def validate_url(self) -> bool:
        """Validates that HA_URL is a well-formed http or https URL."""
        if not self.ha_url:
            return False
        try:
            parsed = urlparse(self.ha_url)
            return parsed.scheme in ("http", "https") and bool(parsed.netloc)
        except Exception:
            return False

    def get_ws_url(self) -> str:
        """Derives the WebSocket URL from the configured HA_URL."""
        if not self.ha_url:
            return ""
        parsed = urlparse(self.ha_url)
        ws_scheme = "wss" if parsed.scheme == "https" else "ws"
        return f"{ws_scheme}://{parsed.netloc}/api/websocket"

    def _get_headers(self) -> Dict[str, str]:
        """Builds HTTP headers with the server-side Long-Lived Access Token."""
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    async def fetch_rest(
        self, endpoint: str, method: str = "GET", body: Optional[Dict[str, Any]] = None
    ) -> Optional[Any]:
        """Executes an authenticated REST call to Home Assistant Core."""
        if not self.is_configured():
            return None

        url = f"{self.ha_url}{endpoint}"
        headers = self._get_headers()
        data = json.dumps(body).encode("utf-8") if body else None

        def _do_request():
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=10) as response:
                    raw = response.read().decode("utf-8")
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as e:
                logger.warning(f"[HA-CLIENT] REST error HTTP {e.code} for endpoint {endpoint}")
                return None
            except Exception as e:
                logger.warning(f"[HA-CLIENT] REST connection failed for endpoint {endpoint}: {e}")
                return None

        return await asyncio.to_thread(_do_request)

    async def get_config(self) -> Optional[Dict[str, Any]]:
        """Fetches Home Assistant Core system configuration."""
        data = await self.fetch_rest("/api/config")
        if isinstance(data, dict):
            self._config = data
        return data

    async def get_states(self) -> List[Dict[str, Any]]:
        """Fetches all entity states from Home Assistant Core and updates the cache."""
        data = await self.fetch_rest("/api/states")
        if isinstance(data, list):
            async with self._lock:
                for state_obj in data:
                    if isinstance(state_obj, dict) and "entity_id" in state_obj:
                        self._entities[state_obj["entity_id"]] = state_obj
            return data
        return []

    async def get_state(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """Fetches state for a specific entity."""
        async with self._lock:
            if entity_id in self._entities:
                return self._entities[entity_id]

        data = await self.fetch_rest(f"/api/states/{entity_id}")
        if isinstance(data, dict) and "entity_id" in data:
            async with self._lock:
                self._entities[data["entity_id"]] = data
            return data
        return None

    async def get_history(
        self, entity_id: str, start_time: Optional[datetime] = None
    ) -> List[Any]:
        """Fetches historical state data from Home Assistant Core history API."""
        if start_time:
            timestamp_str = start_time.strftime("%Y-%m-%dT%H:%M:%S%z")
            endpoint = f"/api/history/period/{timestamp_str}?filter_entity_id={entity_id}"
        else:
            endpoint = f"/api/history/period?filter_entity_id={entity_id}"
        
        data = await self.fetch_rest(endpoint)
        if isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
            return data[0]
        return []

    def subscribe_state_changes(
        self, callback: Callable[[str, Optional[Dict[str, Any]], Optional[Dict[str, Any]]], None]
    ) -> Callable[[], None]:
        """Subscribes an internal listener to real-time state_changed events."""
        self._subscribers.add(callback)
        return lambda: self._subscribers.discard(callback)

    async def start(self) -> None:
        """Starts the Home Assistant Core client and launches real-time WebSocket sync."""
        if not self.is_configured():
            logger.info("[HA-CLIENT] Home Assistant Core integration is not configured (HA_URL or HA_LONG_LIVED_ACCESS_TOKEN unset).")
            return

        if not self.validate_url():
            logger.error(f"[HA-CLIENT] Invalid HA_URL configured: '{self.ha_url}'. Must start with http:// or https://")
            return

        logger.info(f"[HA-CLIENT] Initializing connection to Home Assistant Core at {self.ha_url}...")
        self._should_run = True

        # Prime entity states via REST
        try:
            await self.get_config()
            await self.get_states()
        except Exception as e:
            logger.warning(f"[HA-CLIENT] Initial REST sync warning: {e}")

        # Start WebSocket background loop
        if not self.ws_task or self.ws_task.done():
            self.ws_task = asyncio.create_task(self._ws_loop())

    async def stop(self) -> None:
        """Cleanly terminates the WebSocket connection and background tasks."""
        self._should_run = False
        if self.ws_task:
            self.ws_task.cancel()
            try:
                await self.ws_task
            except asyncio.CancelledError:
                pass
            self.ws_task = None
        self.is_connected = False
        logger.info("[HA-CLIENT] Home Assistant Core client disconnected.")

    async def _ws_loop(self) -> None:
        """Main WebSocket loop with automatic reconnect and event subscription."""
        import websockets

        ws_url = self.get_ws_url()
        if not ws_url:
            return

        while self._should_run:
            try:
                logger.info(f"[HA-CLIENT] Connecting to Home Assistant WebSocket at {ws_url}...")
                async with websockets.connect(
                    ws_url,
                    ping_interval=20,
                    ping_timeout=20,
                    close_timeout=5,
                    max_size=10 * 1024 * 1024
                ) as ws:
                    # 1. Wait for auth_required challenge from Home Assistant Core
                    auth_req_raw = await ws.recv()
                    auth_req = json.loads(auth_req_raw)
                    if auth_req.get("type") != "auth_required":
                        logger.warning(f"[HA-CLIENT] Expected auth_required challenge, got: {auth_req.get('type')}")
                        await asyncio.sleep(5)
                        continue

                    # 2. Authenticate using the Long-Lived Access Token (LLAT)
                    await ws.send(json.dumps({
                        "type": "auth",
                        "access_token": self.token
                    }))

                    # 3. Wait for authentication confirmation
                    auth_res_raw = await ws.recv()
                    auth_res = json.loads(auth_res_raw)
                    if auth_res.get("type") != "auth_ok":
                        err_msg = auth_res.get("message", "Invalid access token")
                        logger.error(f"[HA-CLIENT] Home Assistant Core authentication rejected: {err_msg}")
                        self.is_connected = False
                        await asyncio.sleep(10)
                        continue

                    ha_version = auth_res.get("ha_version", "unknown")
                    logger.info(f"[HA-CLIENT] Successfully authenticated with Home Assistant Core (version {ha_version})!")
                    self.is_connected = True

                    # 4. Subscribe to state_changed events for real-time live map telemetry
                    self._msg_id = 1
                    await ws.send(json.dumps({
                        "id": self._msg_id,
                        "type": "subscribe_events",
                        "event_type": "state_changed"
                    }))

                    # 5. Prime state cache
                    self._msg_id += 1
                    await ws.send(json.dumps({
                        "id": self._msg_id,
                        "type": "get_states"
                    }))

                    # 6. Stream incoming messages
                    while self._should_run:
                        msg_raw = await ws.recv()
                        msg = json.loads(msg_raw)
                        msg_type = msg.get("type")

                        if msg_type == "result" and msg.get("success") and isinstance(msg.get("result"), list):
                            async with self._lock:
                                for s in msg["result"]:
                                    if isinstance(s, dict) and "entity_id" in s:
                                        self._entities[s["entity_id"]] = s
                            logger.info(f"[HA-CLIENT] Synchronized {len(msg['result'])} entities from Home Assistant Core.")

                        elif msg_type == "event" and msg.get("event", {}).get("event_type") == "state_changed":
                            event_data = msg["event"].get("data", {})
                            entity_id = event_data.get("entity_id")
                            old_state = event_data.get("old_state")
                            new_state = event_data.get("new_state")

                            if entity_id:
                                async with self._lock:
                                    if new_state:
                                        self._entities[entity_id] = new_state
                                    else:
                                        self._entities.pop(entity_id, None)

                                # Dispatch to subscribers
                                for sub in list(self._subscribers):
                                    try:
                                        sub(entity_id, old_state, new_state)
                                    except Exception as sub_err:
                                        logger.warning(f"[HA-CLIENT] Error in subscriber callback: {sub_err}")

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.is_connected = False
                logger.warning(f"[HA-CLIENT] Home Assistant WebSocket disconnected: {e}. Reconnecting in 5s...")
                await asyncio.sleep(5)

    def get_discovered_devices(self) -> List[Dict[str, Any]]:
        """
        Discovers and returns all available location-capable devices/trackers from Home Assistant Core.
        Extracts entity_id, friendly_name, state/zone, availability, coordinates, battery, charging, and platform.
        """
        discovered: List[Dict[str, Any]] = []
        if not self._entities:
            return discovered

        now_iso = datetime.now(timezone.utc).isoformat()

        for entity_id, state_obj in self._entities.items():
            if not (entity_id.startswith("device_tracker.") or entity_id.startswith("person.")):
                continue

            attrs = state_obj.get("attributes", {}) if isinstance(state_obj.get("attributes"), dict) else {}
            friendly_name = attrs.get("friendly_name") or entity_id.split(".", 1)[1].replace("_", " ").title()
            state_val = str(state_obj.get("state", "unknown"))
            is_available = state_val.lower() not in ("unavailable", "unknown")

            lat = attrs.get("latitude")
            lon = attrs.get("longitude")
            accuracy = attrs.get("gps_accuracy")
            battery = attrs.get("battery_level") or attrs.get("battery")
            charging = attrs.get("battery_charging") or attrs.get("charging")
            source_type = attrs.get("source_type") or ("GPS" if lat is not None else "Router/Tracker")
            last_updated = state_obj.get("last_updated") or now_iso

            # Check for linked battery sensor if battery is not directly in attributes
            if battery is None:
                clean_name = entity_id.split(".", 1)[1].lower()
                for s_id, s_obj in self._entities.items():
                    if s_id.startswith("sensor.") and "battery" in s_id.lower() and clean_name in s_id.lower():
                        try:
                            battery = float(s_obj.get("state"))
                            break
                        except (ValueError, TypeError):
                            pass

            lat_f = float(lat) if lat is not None else None
            lon_f = float(lon) if lon is not None else None
            acc_f = float(accuracy) if accuracy is not None else None
            bat_f = float(battery) if battery is not None else None

            discovered.append({
                "entity_id": entity_id,
                "device_name": friendly_name,
                "state": state_val,
                "is_available": is_available,
                "latitude": lat_f,
                "longitude": lon_f,
                "accuracy": acc_f,
                "battery": bat_f,
                "charging": bool(charging) if charging is not None else None,
                "platform": source_type,
                "last_updated": last_updated,
                "map_icon": "📱 Phone" if "phone" in entity_id.lower() or "mobile" in entity_id.lower() else "📍 Tracker"
            })

        # Sort: available first, then by device_name
        discovered.sort(key=lambda d: (0 if d["is_available"] else 1, d["device_name"].lower()))
        return discovered

    def get_entity_location(self, entity_id: str) -> Optional[MemberDeviceLocation]:
        """
        Retrieves live location telemetry for a specific assigned Home Assistant entity_id.
        Returns None if entity has no coordinates or is unavailable.
        """
        if not entity_id or entity_id not in self._entities:
            return None

        state_obj = self._entities[entity_id]
        attrs = state_obj.get("attributes", {}) if isinstance(state_obj.get("attributes"), dict) else {}
        state_val = str(state_obj.get("state", "unknown"))

        # If state is unavailable, return None or location if coordinates exist
        lat = attrs.get("latitude")
        lon = attrs.get("longitude")
        if lat is None or lon is None:
            return None

        try:
            lat_f = float(lat)
            lon_f = float(lon)
        except (ValueError, TypeError):
            return None

        friendly_name = attrs.get("friendly_name") or entity_id.split(".", 1)[1].replace("_", " ").title()
        accuracy = attrs.get("gps_accuracy")
        battery = attrs.get("battery_level") or attrs.get("battery")
        charging = attrs.get("battery_charging") or attrs.get("charging")
        now_iso = datetime.now(timezone.utc).isoformat()
        last_updated = state_obj.get("last_updated") or now_iso

        return MemberDeviceLocation(
            entity_id=entity_id,
            device_name=friendly_name,
            latitude=lat_f,
            longitude=lon_f,
            battery=float(battery) if battery is not None else None,
            charging=bool(charging) if charging is not None else None,
            accuracy=float(accuracy) if accuracy is not None else None,
            last_updated=last_updated,
            map_icon="📱 Phone" if "phone" in entity_id.lower() or "mobile" in entity_id.lower() else "📍 Tracker",
            location_visibility="family",
            is_default=True
        )

    def get_member_locations(
        self, member_username: str, member_display_name: str, assigned_entity_id: Optional[str] = None
    ) -> List[MemberDeviceLocation]:
        """
        Dynamically extracts and maps real Home Assistant location telemetry for a Yimly member.
        If an explicit assigned_entity_id is provided, queries that entity directly.
        """
        if not self._entities:
            return []

        # 1. If an explicit assigned entity is set, use it directly
        if assigned_entity_id:
            loc = self.get_entity_location(assigned_entity_id)
            if loc:
                return [loc]
            return []

        clean_username = member_username.strip().lower()
        clean_display_name = member_display_name.strip().lower()

        devices: List[MemberDeviceLocation] = []
        now_iso = datetime.now(timezone.utc).isoformat()

        # 1. Look for matching person entity in Home Assistant Core
        matching_person: Optional[Dict[str, Any]] = None
        for entity_id, state_obj in self._entities.items():
            if not entity_id.startswith("person."):
                continue

            p_name = entity_id.split(".", 1)[1].lower()
            attrs = state_obj.get("attributes", {})
            friendly_name = str(attrs.get("friendly_name", "")).strip().lower()

            if (
                p_name == clean_username
                or friendly_name == clean_username
                or (clean_display_name and friendly_name == clean_display_name)
            ):
                matching_person = state_obj
                break

        # If matching person entity exists with valid coordinates:
        if matching_person:
            p_attrs = matching_person.get("attributes", {})
            lat = p_attrs.get("latitude")
            lon = p_attrs.get("longitude")
            accuracy = p_attrs.get("gps_accuracy")
            source_dt = p_attrs.get("source")
            friendly_name = p_attrs.get("friendly_name") or matching_person.get("entity_id")

            battery = p_attrs.get("battery_level") or p_attrs.get("battery")
            charging = p_attrs.get("battery_charging") or p_attrs.get("charging")
            last_updated = matching_person.get("last_updated") or now_iso

            # Check source device_tracker for richer telemetry (battery, charging, etc.)
            if source_dt and source_dt in self._entities:
                dt_obj = self._entities[source_dt]
                dt_attrs = dt_obj.get("attributes", {})
                if battery is None:
                    battery = dt_attrs.get("battery_level") or dt_attrs.get("battery")
                if charging is None:
                    charging = dt_attrs.get("battery_charging") or dt_attrs.get("charging")
                if lat is None:
                    lat = dt_attrs.get("latitude")
                    lon = dt_attrs.get("longitude")
                    accuracy = dt_attrs.get("gps_accuracy")
                if dt_obj.get("last_updated"):
                    last_updated = dt_obj.get("last_updated")

            # Check associated battery sensors if battery level is still not present
            if battery is None:
                for s_id, s_obj in self._entities.items():
                    if s_id.startswith("sensor.") and "battery" in s_id.lower():
                        if clean_username in s_id.lower() or (
                            source_dt and source_dt.split(".", 1)[1] in s_id.lower()
                        ):
                            try:
                                battery = float(s_obj.get("state"))
                                break
                            except (ValueError, TypeError):
                                pass

            # Only add device if valid coordinates exist in Home Assistant
            if lat is not None and lon is not None:
                try:
                    lat_f = float(lat)
                    lon_f = float(lon)
                    devices.append(
                        MemberDeviceLocation(
                            entity_id=source_dt or matching_person.get("entity_id"),
                            device_name=friendly_name,
                            latitude=lat_f,
                            longitude=lon_f,
                            battery=battery,
                            charging=charging,
                            accuracy=float(accuracy) if accuracy is not None else None,
                            last_updated=last_updated,
                            map_icon="📱 Phone",
                            location_visibility="family",
                            is_default=True,
                        )
                    )
                except (ValueError, TypeError):
                    pass

        # 2. Search for device_tracker entities directly associated with the member
        for entity_id, state_obj in self._entities.items():
            if not entity_id.startswith("device_tracker."):
                continue

            # Skip if already added as source
            if any(d.entity_id == entity_id for d in devices):
                continue

            dt_name = entity_id.split(".", 1)[1].lower()
            attrs = state_obj.get("attributes", {})
            friendly_name = str(attrs.get("friendly_name", "")).strip().lower()

            if (
                clean_username in dt_name
                or clean_username in friendly_name
                or (clean_display_name and clean_display_name in friendly_name)
            ):
                lat = attrs.get("latitude")
                lon = attrs.get("longitude")
                if lat is not None and lon is not None:
                    try:
                        lat_f = float(lat)
                        lon_f = float(lon)
                        battery = attrs.get("battery_level") or attrs.get("battery")
                        charging = attrs.get("battery_charging") or attrs.get("charging")
                        accuracy = attrs.get("gps_accuracy")
                        devices.append(
                            MemberDeviceLocation(
                                entity_id=entity_id,
                                device_name=attrs.get("friendly_name") or entity_id,
                                latitude=lat_f,
                                longitude=lon_f,
                                battery=battery,
                                charging=charging,
                                accuracy=float(accuracy) if accuracy is not None else None,
                                last_updated=state_obj.get("last_updated") or now_iso,
                                map_icon="📱 Phone",
                                location_visibility="family",
                                is_default=len(devices) == 0,
                            )
                        )
                    except (ValueError, TypeError):
                        pass

        return devices

    def get_zones(self) -> List[Dict[str, Any]]:
        """Extracts zone.* entities from Home Assistant Core."""
        zones: List[Dict[str, Any]] = []
        for entity_id, state_obj in self._entities.items():
            if not entity_id.startswith("zone."):
                continue
            attrs = state_obj.get("attributes", {})
            lat = attrs.get("latitude")
            lon = attrs.get("longitude")
            radius = attrs.get("radius", 100)
            friendly_name = attrs.get("friendly_name") or entity_id.split(".", 1)[1]
            icon = attrs.get("icon")

            if lat is not None and lon is not None:
                zones.append({
                    "entity_id": entity_id,
                    "name": friendly_name,
                    "latitude": float(lat),
                    "longitude": float(lon),
                    "radius": float(radius),
                    "icon": icon,
                })
        return zones

# Global Singleton Instance
ha_client = HomeAssistantClient()
