import asyncio
import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.main import app
from app.core.config import settings
from app.db.database import Base, get_db
from app.schemas.auth import UserCreate
from app.services.auth_service import AuthService
from app.services.token_service import TokenService
from app.core.security import create_jwt_token


# 1. Setup Test Database using File-Based SQLite in /tmp/
TEST_DATABASE_URL = "sqlite+aiosqlite:////tmp/test_ha_server.db"
test_engine = create_async_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
db_session_test_maker = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)

@pytest.fixture(autouse=True, scope="function")
def setup_test_db():
    import app.db.database
    import app.api.websocket
    orig_session_maker = app.db.database.async_session_maker
    orig_ws_session_maker = getattr(app.api.websocket, "async_session_maker", None)
    
    app.db.database.async_session_maker = db_session_test_maker
    app.api.websocket.async_session_maker = db_session_test_maker

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    # Sync helper to run async commands
    async def create_tables():
        async with test_engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    async def drop_tables():
        async with test_engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)

    loop.run_until_complete(create_tables())
    yield
    loop.run_until_complete(drop_tables())
    loop.run_until_complete(test_engine.dispose())
    loop.close()

    app.db.database.async_session_maker = orig_session_maker
    if orig_ws_session_maker is not None:
        app.api.websocket.async_session_maker = orig_ws_session_maker


    # Try removing the DB file cleanly from /tmp
    for db_file in ["/tmp/test_ha_server.db", "/tmp/test_ha_server.db-shm", "/tmp/test_ha_server.db-wal"]:

        if os.path.exists(db_file):
            try:
                os.remove(db_file)
            except Exception:
                pass




# Override get_db dependency to point to our test database
async def override_get_db():
    async with db_session_test_maker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

# --- PHASE 6/7/8: AUTHENTICATION TESTS ---

@pytest.mark.asyncio
async def test_create_user_and_login():
    async with db_session_test_maker() as db:
        user_in = UserCreate(username="testuser", password="secretpassword", display_name="Test User")
        user = await AuthService.create_user(db, user_in)
        assert user.username == "testuser"
        assert user.display_name == "Test User"
        assert user.password_hash != "secretpassword"  # Must be hashed!

        # Try timing-safe authentication
        authed_user = await AuthService.authenticate_user(db, "testuser", "secretpassword")
        assert authed_user is not None
        assert authed_user.username == "testuser"

        # Invalid password authentication
        bad_auth = await AuthService.authenticate_user(db, "testuser", "wrongpassword")
        assert bad_auth is None

        # Invalid username authentication
        bad_user = await AuthService.authenticate_user(db, "unknown", "secretpassword")
        assert bad_user is None


@pytest.mark.asyncio
async def test_oauth_authorize_and_token_exchange():
    async with db_session_test_maker() as db:
        # Create test user
        user_in = UserCreate(username="oauth_user", password="secure_password", display_name="OAuth User")
        user = await AuthService.create_user(db, user_in)

        # 1. Test GET /auth/authorize (renders login form)
        response = client.get("/auth/authorize?client_id=http://localhost:8123/&redirect_uri=homeassistant://auth-callback&response_type=code&state=xyz123")
        assert response.status_code == 200
        assert "login" in response.text
        assert "oauth_user" not in response.text

        # 2. Test POST /auth/login_submit (successful login & redirect with authorization code)
        form_data = {
            "username": "oauth_user",
            "password": "secure_password",
            "client_id": "http://localhost:8123/",
            "redirect_uri": "homeassistant://auth-callback",
            "response_type": "code",
            "state": "xyz123"
        }
        # Follow_redirects=False to intercept 302
        submit_res = client.post("/auth/login_submit", data=form_data, follow_redirects=False)
        assert submit_res.status_code == 302
        redirect_location = submit_res.headers.get("location")
        assert "homeassistant://auth-callback" in redirect_location
        assert "code=" in redirect_location
        assert "state=xyz123" in redirect_location

        # Extract code from redirect URL
        code = redirect_location.split("code=")[1].split("&")[0]
        assert code is not None

        # 3. Test POST /auth/token (exchange authorization code for access and refresh tokens)
        token_payload = {
            "grant_type": "authorization_code",
            "client_id": "http://localhost:8123/",
            "code": code,
            "redirect_uri": "homeassistant://auth-callback"
        }
        token_res = client.post("/auth/token", data=token_payload)
        assert token_res.status_code == 200
        tokens = token_res.json()
        assert "access_token" in tokens
        assert "refresh_token" in tokens
        assert tokens["token_type"] == "Bearer"

        access_token = tokens["access_token"]
        refresh_token = tokens["refresh_token"]

        # 4. Re-exchange same code (replay attack prevention - code must be single-use)
        replay_res = client.post("/auth/token", data=token_payload)
        assert replay_res.status_code == 400

        # 5. Test refresh token exchange
        refresh_payload = {
            "grant_type": "refresh_token",
            "client_id": "http://localhost:8123/",
            "refresh_token": refresh_token
        }
        refresh_res = client.post("/auth/token", data=refresh_payload)
        assert refresh_res.status_code == 200
        refreshed_tokens = refresh_res.json()
        assert "access_token" in refreshed_tokens
        assert refreshed_tokens["access_token"] != access_token


# --- PHASE 11: REST FOUNDATION & API CONFIG ---

@pytest.mark.asyncio
async def test_api_config_unauthorized_and_authorized():
    # 1. Try unauthorized access
    unauth_res = client.get("/api/config")
    assert unauth_res.status_code == 401

    async with db_session_test_maker() as db:
        user_in = UserCreate(username="rest_user", password="rest_password", display_name="Rest User")
        user = await AuthService.create_user(db, user_in)
        
        # Generate token
        token = TokenService.hash_value("dummy")  # Generate valid token
        # Generate valid JWT
        access_token = create_jwt_token(data={"sub": str(user.id), "typ": "access"})

        # 2. Access with valid Bearer token
        headers = {"Authorization": f"Bearer {access_token}"}
        auth_res = client.get("/api/config", headers=headers)
        assert auth_res.status_code == 200
        config_data = auth_res.json()
        assert "version" in config_data
        assert "components" in config_data
        assert "latitude" in config_data
        assert "longitude" in config_data


# --- PHASE 14/15/16/17: MOBILE REGISTRATION & TELEMETRY WEBHOOKS ---

@pytest.mark.asyncio
async def test_mobile_app_registration_and_webhooks():
    async with db_session_test_maker() as db:
        user_in = UserCreate(username="mobile_user", password="mobile_password", display_name="Mobile User")
        user = await AuthService.create_user(db, user_in)
        access_token = create_jwt_token(data={"sub": str(user.id), "typ": "access"})
        headers = {"Authorization": f"Bearer {access_token}"}

        # 1. Register a mobile device
        reg_payload = {
            "device_id": "nexus_9",
            "app_id": "io.homeassistant.companion",
            "app_name": "Home Assistant",
            "app_version": "1.0.0",
            "device_name": "Nexus 9",
            "manufacturer": "HTC",
            "model": "Nexus 9",
            "os_name": "Android",
            "os_version": "9.0",
            "supports_encryption": False,
            "app_data": {}
        }
        reg_res = client.post("/api/mobile_app/registrations", json=reg_payload, headers=headers)
        assert reg_res.status_code == 201
        reg_data = reg_res.json()
        assert "webhook_id" in reg_data
        webhook_id = reg_data["webhook_id"]

        # 2. Send location telemetry update via webhook
        loc_payload = {
            "type": "update_location",
            "data": {
                "latitude": 37.7749,
                "longitude": -122.4194,
                "gps_accuracy": 15,
                "altitude": 10.0,
                "speed": 5.0,
                "bearing": 90.0,
                "battery": 92.5,
                "trigger": "background"
            }
        }
        loc_res = client.post(f"/api/webhook/{webhook_id}", json=loc_payload)
        assert loc_res.status_code == 200
        assert loc_res.json() == {"status": "ok"}

        # 3. Read current entity state via REST
        state_res = client.get("/api/states/device_tracker.nexus_9", headers=headers)
        assert state_res.status_code == 200
        state_data = state_res.json()
        assert state_data["entity_id"] == "device_tracker.nexus_9"
        assert state_data["state"] == "not_home"  # far from 0,0 home
        assert state_data["attributes"]["latitude"] == 37.7749
        assert state_data["attributes"]["battery_level"] == 92.5

        # 4. Register a sensor via webhook
        sensor_reg_payload = {
            "type": "register_sensor",
            "data": {
                "unique_id": "battery_sensor_nexus",
                "name": "Battery Level Sensor",
                "type": "sensor",
                "unit_of_measurement": "%",
                "icon": "mdi:battery"
            }
        }
        sensor_reg_res = client.post(f"/api/webhook/{webhook_id}", json=sensor_reg_payload)
        assert sensor_reg_res.status_code == 200
        assert "registered" in sensor_reg_res.text

        # 5. Send sensor state updates via webhook
        sensor_update_payload = {
            "type": "update_sensor_states",
            "data": [
                {
                    "unique_id": "battery_sensor_nexus",
                    "state": "88",
                    "attributes": {
                        "extra_info": "good health"
                    }
                }
            ]
        }
        sensor_update_res = client.post(f"/api/webhook/{webhook_id}", json=sensor_update_payload)
        assert sensor_update_res.status_code == 200
        assert sensor_update_res.json()["battery_sensor_nexus"]["success"] is True

        # 6. Read updated sensor state via REST
        sensor_state_res = client.get("/api/states/sensor.nexus_9_battery_level_sensor", headers=headers)
        assert sensor_state_res.status_code == 200
        sensor_state_data = sensor_state_res.json()
        assert sensor_state_data["state"] == "88"
        assert sensor_state_data["attributes"]["extra_info"] == "good health"


# --- PHASE 20: WEBSOCKET SEQUENCE TESTS ---

def test_websocket_flow_invalid_auth():
    with client.websocket_connect("/api/websocket") as ws:
        # Step 1: Receives challenge
        chal = ws.receive_json()
        assert chal["type"] == "auth_required"

        # Step 2: Send invalid auth
        ws.send_json({
            "type": "auth",
            "access_token": "invalid_access_token"
        })

        # Step 3: Server rejects and closes
        rej = ws.receive_json()
        assert rej["type"] == "auth_invalid"


def test_websocket_flow_valid_auth_and_commands():
    async def create_user_token():
        async with db_session_test_maker() as db:
            user_in = UserCreate(username="ws_user", password="ws_password", display_name="WS User")
            user = await AuthService.create_user(db, user_in)
            access_token = create_jwt_token(data={"sub": str(user.id), "typ": "access"})
            return access_token

    access_token = asyncio.run(create_user_token())

    with client.websocket_connect("/api/websocket") as ws:
        # Step 1: Challenge
        chal = ws.receive_json()
        assert chal["type"] == "auth_required"

        # Step 2: Send valid auth
        ws.send_json({
            "type": "auth",
            "access_token": access_token
        })

        # Step 3: Server accepts auth
        ok = ws.receive_json()
        assert ok["type"] == "auth_ok"

        # Step 4: Run ping command
        ws.send_json({
            "id": 10,
            "type": "ping"
        })
        pong = ws.receive_json()
        assert pong["id"] == 10
        assert pong["type"] == "pong"

        # Step 5: Run get_states command (should be empty initially)
        ws.send_json({
            "id": 11,
            "type": "get_states"
        })
        states_res = ws.receive_json()
        assert states_res["id"] == 11
        assert states_res["type"] == "result"
        assert states_res["success"] is True
        assert len(states_res["result"]) == 0

        # Step 6: Subscribe to state_changed events
        ws.send_json({
            "id": 12,
            "type": "subscribe_events",
            "event_type": "state_changed"
        })
        sub_res = ws.receive_json()
        assert sub_res["id"] == 12
        assert sub_res["success"] is True


def test_full_companion_app_simulation():
    # 1. Create a User directly in the database
    async def init_data():
        async with db_session_test_maker() as db:
            user_in = UserCreate(username="companion_user", password="companion_password", display_name="Companion User")
            user = await AuthService.create_user(db, user_in)
            return user.id
    
    user_id = asyncio.run(init_data())

    # 2. Simulate OAuth login_submit to get auth code
    response = client.post(
        "/auth/login_submit",
        data={
            "username": "companion_user",
            "password": "companion_password",
            "client_id": "https://home-assistant.io/android",
            "redirect_uri": "https://home-assistant.io/android",
            "response_type": "code",
            "state": "oauth_state_123"
        },
        follow_redirects=False
    )
    assert response.status_code == 302
    location_header = response.headers["location"]
    assert "code=" in location_header
    assert "state=oauth_state_123" in location_header
    
    # Extract authorization code from redirect URL
    import urllib.parse as urlparse
    parsed = urlparse.urlparse(location_header)
    auth_code = urlparse.parse_qs(parsed.query)["code"][0]
    
    # 3. Exchange auth code for tokens
    token_response = client.post(
        "/auth/token",
        data={
            "grant_type": "authorization_code",
            "code": auth_code,
            "client_id": "https://home-assistant.io/android",
            "redirect_uri": "https://home-assistant.io/android"
        }
    )
    assert token_response.status_code == 200
    token_data = token_response.json()
    assert "access_token" in token_data
    assert "refresh_token" in token_data
    access_token = token_data["access_token"]
    refresh_token = token_data["refresh_token"]
    
    # 4. Fetch Config using Access Token
    config_response = client.get(
        "/api/config",
        headers={"Authorization": f"Bearer {access_token}"}
    )
    assert config_response.status_code == 200
    config_data = config_response.json()
    assert "components" in config_data
    assert "version" in config_data
    
    # 5. Register Mobile App Companion
    reg_response = client.post(
        "/api/mobile_app/registrations",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "device_id": "test_companion_device_id",
            "app_id": "io.homeassistant.companion.android",
            "app_name": "Home Assistant",
            "app_version": "2026.9.1-play",
            "device_name": "Pixel 9 Pro",
            "manufacturer": "Google",
            "model": "Pixel 9 Pro",
            "os_name": "Android",
            "os_version": "14",
            "supports_encryption": True
        }
    )
    assert reg_response.status_code == 201
    reg_data = reg_response.json()
    assert "webhook_id" in reg_data
    webhook_id = reg_data["webhook_id"]
    # Check that secret is null/None since we opted out of encryption for smooth compatibility
    assert reg_data["secret"] is None
    
    # 6. Send Location Update to Webhook
    loc_response = client.post(
        f"/api/webhook/{webhook_id}",
        json={
            "type": "update_location",
            "data": {
                "latitude": 37.7749,
                "longitude": -122.4194,
                "gps_accuracy": 15.0,
                "battery": 88.0,
                "trigger": "periodic"
            }
        }
    )
    assert loc_response.status_code == 200
    assert loc_response.json() == {"status": "ok"}
    
    # 7. Register a Sensor on Webhook
    sensor_reg_response = client.post(
        f"/api/webhook/{webhook_id}",
        json={
            "type": "register_sensor",
            "data": {
                "unique_id": "pixel_battery",
                "name": "Battery Level",
                "type": "sensor",
                "unit_of_measurement": "%",
                "icon": "mdi:battery",
                "device_class": "battery"
            }
        }
    )
    assert sensor_reg_response.status_code == 200
    assert sensor_reg_response.json() == {"status": "registered"}
    
    # 8. Send Sensor State Update to Webhook
    sensor_update_response = client.post(
        f"/api/webhook/{webhook_id}",
        json={
            "type": "update_sensor_states",
            "data": [
                {
                    "unique_id": "pixel_battery",
                    "state": "88",
                    "attributes": {
                        "is_charging": False
                    }
                }
            ]
        }
    )
    assert sensor_update_response.status_code == 200
    assert "pixel_battery" in sensor_update_response.json()
    assert sensor_update_response.json()["pixel_battery"]["success"] is True

    # 9. Establish WebSocket Connection, Authenticate, Subscribe, and Verify Event pushes
    with client.websocket_connect("/api/websocket") as ws:
        # Step A: Receives challenge
        chal = ws.receive_json()
        assert chal["type"] == "auth_required"
        
        # Step B: Authenticate with obtained access token
        ws.send_json({
            "type": "auth",
            "access_token": access_token
        })
        auth_ok = ws.receive_json()
        assert auth_ok["type"] == "auth_ok"
        
        # Step C: Retrieve current states
        ws.send_json({
            "id": 100,
            "type": "get_states"
        })
        states_res = ws.receive_json()
        assert states_res["id"] == 100
        assert states_res["success"] is True
        
        # Map states by entity_id
        states_by_id = {s["entity_id"]: s for s in states_res["result"]}
        assert "device_tracker.pixel_9_pro" in states_by_id
        assert "sensor.pixel_9_pro_battery_level" in states_by_id
        
        # Check initial states
        assert states_by_id["device_tracker.pixel_9_pro"]["state"] in ["home", "not_home"]
        assert states_by_id["sensor.pixel_9_pro_battery_level"]["state"] == "88"
        assert states_by_id["sensor.pixel_9_pro_battery_level"]["attributes"]["unit_of_measurement"] == "%"
        assert states_by_id["sensor.pixel_9_pro_battery_level"]["attributes"]["is_charging"] is False
        
        # Step D: Subscribe to events
        ws.send_json({
            "id": 101,
            "type": "subscribe_events",
            "event_type": "state_changed"
        })
        sub_ok = ws.receive_json()
        assert sub_ok["id"] == 101
        assert sub_ok["success"] is True
        
        # Step E: Trigger another sensor update via Webhook while WebSocket is active!
        sensor_update_response2 = client.post(
            f"/api/webhook/{webhook_id}",
            json={
                "type": "update_sensor_states",
                "data": [
                    {
                        "unique_id": "pixel_battery",
                        "state": "87",
                        "attributes": {
                            "is_charging": True
                        }
                    }
                ]
            }
        )
        assert sensor_update_response2.status_code == 200
        assert sensor_update_response2.json()["pixel_battery"]["success"] is True
        
        # Step F: Verify that WebSocket received the event!
        event_msg = ws.receive_json()
        assert event_msg["type"] == "event"
        assert event_msg["id"] == 101
        event_data = event_msg["event"]
        assert event_data["event_type"] == "state_changed"
        assert event_data["data"]["entity_id"] == "sensor.pixel_9_pro_battery_level"
        assert event_data["data"]["new_state"]["state"] == "87"
        assert event_data["data"]["new_state"]["attributes"]["is_charging"] is True


def test_shared_auth_and_user_integration():
    import urllib.parse
    from app.core.security import verify_jwt_token

    client = TestClient(app)

    # A. Start with zero users
    status_response = client.get("/api/setup/status")
    assert status_response.status_code == 200
    assert status_response.json()["needs_setup"] is True

    # B. Create an account through the web UI /api/setup/register
    reg_payload = {
        "username": "User@Example.com",  # Using mixed case to test case-insensitive normalization
        "password": "strong_password123",
        "display_name": "Test User"
    }
    reg_response = client.post("/api/setup/register", json=reg_payload)
    assert reg_response.status_code == 200
    reg_data = reg_response.json()
    assert reg_data["username"] == "user@example.com"  # Normalized to lowercase
    assert reg_data["display_name"] == "Test User"

    # C. Verify exactly one user exists in the database
    status_response2 = client.get("/api/setup/status")
    assert status_response2.status_code == 200
    assert status_response2.json()["needs_setup"] is False

    # D. Log into /api/auth/login using those exact credentials
    login_payload = {
        "username": "USER@example.com",  # Mixed case to check case-insensitive match
        "password": "strong_password123"
    }
    web_login_response = client.post("/api/auth/login", json=login_payload)
    assert web_login_response.status_code == 200
    web_login_data = web_login_response.json()
    assert "access_token" in web_login_data
    web_token = web_login_data["access_token"]
    
    # Decode and check web user ID
    web_payload = verify_jwt_token(web_token)
    assert web_payload is not None
    web_user_id = web_payload["sub"]

    # E. Verify the native HA-compatible /auth/authorize + /auth/token flow can authenticate that SAME account using the SAME password.
    # Step E1: Login submit
    form_data = {
        "username": "user@example.com",
        "password": "strong_password123",
        "client_id": "https://home-assistant.io/android",
        "redirect_uri": "https://home-assistant.io/android",
        "response_type": "code",
        "state": "oauth_state_456"
    }
    submit_res = client.post("/auth/login_submit", data=form_data, follow_redirects=False)
    assert submit_res.status_code == 302
    location = submit_res.headers["location"]
    assert "code=" in location
    assert "state=oauth_state_456" in location

    # Extract auth code from redirect location
    parsed = urllib.parse.urlparse(location)
    params = urllib.parse.parse_qs(parsed.query)
    auth_code = params["code"][0]

    # Step E2: Exchange code for native access token
    token_form = {
        "grant_type": "authorization_code",
        "client_id": "https://home-assistant.io/android",
        "code": auth_code,
        "redirect_uri": "https://home-assistant.io/android"
    }
    token_res = client.post("/auth/token", data=token_form)
    assert token_res.status_code == 200
    token_data = token_res.json()
    assert "access_token" in token_data
    native_token = token_data["access_token"]

    # F. Verify both authentication paths identify the same internal user ID.
    native_payload = verify_jwt_token(native_token)
    assert native_payload is not None
    native_user_id = native_payload["sub"]

    assert web_user_id == native_user_id
    assert int(web_user_id) == reg_data["id"]

    # G. Confirm incorrect credentials fail through BOTH authentication paths
    # G1: Web Login incorrect password
    bad_login_payload = {
        "username": "user@example.com",
        "password": "wrong_password"
    }
    bad_web_res = client.post("/api/auth/login", json=bad_login_payload)
    assert bad_web_res.status_code == 401

    # G2: OAuth Login submit incorrect password
    bad_form_data = {
        "username": "user@example.com",
        "password": "wrong_password",
        "client_id": "https://home-assistant.io/android",
        "redirect_uri": "https://home-assistant.io/android",
        "response_type": "code",
        "state": "oauth_state_bad"
    }
    bad_submit_res = client.post("/auth/login_submit", data=bad_form_data, follow_redirects=False)
    assert bad_submit_res.status_code == 200
    assert "Invalid username or password" in bad_submit_res.text


@pytest.mark.asyncio
async def test_normal_user_registration_after_setup():
    client = TestClient(app)

    # 1. Registration through /api/auth/register fails if setup is not completed
    fail_res = client.post("/api/auth/register", json={
        "username": "User2",
        "password": "secure_password456",
        "display_name": "User Two"
    })
    assert fail_res.status_code == 400
    assert "setup" in fail_res.json()["detail"].lower()

    # 2. Perform initial first-run setup
    setup_res = client.post("/api/setup/register", json={
        "username": "AdminUser",
        "password": "adminpassword123",
        "display_name": "System Administrator"
    })
    assert setup_res.status_code == 200

    # 3. Setup has been completed. Now setup_register fails
    setup_fail = client.post("/api/setup/register", json={
        "username": "User2",
        "password": "secure_password456",
        "display_name": "User Two"
    })
    assert setup_fail.status_code == 400

    # 4. Try to register with an existing username (case-insensitive check)
    dup_res = client.post("/api/auth/register", json={
        "username": "adminuser",
        "password": "different_password",
        "display_name": "Another Admin"
    })
    assert dup_res.status_code == 400
    assert "exists" in dup_res.json()["detail"].lower()

    # 5. Successfully register second user
    success_res = client.post("/api/auth/register", json={
        "username": "User2",
        "password": "secure_password456",
        "display_name": "User Two"
    })
    assert success_res.status_code == 200
    reg_data = success_res.json()
    assert reg_data["username"] == "user2"
    assert reg_data["display_name"] == "User Two"

    # 6. Verify second user can log in normally
    login_res = client.post("/api/auth/login", json={
        "username": "user2",
        "password": "secure_password456"
    })
    assert login_res.status_code == 200
    assert "access_token" in login_res.json()


@pytest.mark.asyncio
async def test_circle_join_flow():
    client = TestClient(app)

    # 1. Setup/Register User A (Admin)
    res_a = client.post("/api/setup/register", json={
        "username": "UserA",
        "password": "passwordA123",
        "display_name": "User Alpha"
    })
    assert res_a.status_code == 200
    
    # Login as User A to get token
    login_a = client.post("/api/auth/login", json={
        "username": "UserA",
        "password": "passwordA123"
    })
    assert login_a.status_code == 200
    token_a = login_a.json()["access_token"]

    # Create Circle as User A
    res_circle = client.post("/api/circles", json={"name": "Alpha Circle"}, headers={
        "Authorization": f"Bearer {token_a}"
    })
    assert res_circle.status_code == 200
    circle_data = res_circle.json()
    invite_code = circle_data["invite_code"]
    assert len(invite_code) == 8

    # 2. Register User B
    res_b = client.post("/api/auth/register", json={
        "username": "UserB",
        "password": "passwordB123",
        "display_name": "User Beta"
    })
    assert res_b.status_code == 200

    # Login as User B
    login_b = client.post("/api/auth/login", json={
        "username": "UserB",
        "password": "passwordB123"
    })
    assert login_b.status_code == 200
    token_b = login_b.json()["access_token"]

    # 3. Join with invalid code (should fail)
    bad_join = client.post("/api/circles/join", json={"invite_code": "INVALID8"}, headers={
        "Authorization": f"Bearer {token_b}"
    })
    assert bad_join.status_code == 404

    # 4. Join with valid code (should succeed)
    good_join = client.post("/api/circles/join", json={"invite_code": invite_code}, headers={
        "Authorization": f"Bearer {token_b}"
    })
    assert good_join.status_code == 200
    joined_data = good_join.json()
    assert joined_data["id"] == circle_data["id"]
    assert joined_data["name"] == "Alpha Circle"

    # 5. Join again with same valid code (idempotent, should succeed and return same circle)
    dupe_join = client.post("/api/circles/join", json={"invite_code": invite_code}, headers={
        "Authorization": f"Bearer {token_b}"
    })
    assert dupe_join.status_code == 200
    assert dupe_join.json()["id"] == circle_data["id"]

    # 6. Verify User B can see User A's circle in their circle list
    res_list = client.get("/api/circles", headers={
        "Authorization": f"Bearer {token_b}"
    })
    assert res_list.status_code == 200
    circles_list = res_list.json()
    assert len(circles_list) == 1
    assert circles_list[0]["id"] == circle_data["id"]


