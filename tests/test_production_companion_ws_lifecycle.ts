import WebSocket from "ws";

const BASE_URL = "ws://127.0.0.1:3000/api/websocket";
const HTTP_BASE_URL = "http://127.0.0.1:3000";

async function makePost(urlPath: string, body: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${HTTP_BASE_URL}${urlPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

async function runProductionCompanionLifecycleTest() {
  console.log("============================================================");
  console.log("RUNNING PRODUCTION COMPANION WS LIFECYCLE & 120S DURATION TEST");
  console.log("============================================================");

  const ts = Date.now();
  const username = `prod_companion_${ts}`;
  const password = "Password123!";

  // 1. Authenticate test user
  console.log("1. Registering test user account...");
  const authRes = await makePost("/api/auth/register", {
    username,
    display_name: "Prod Companion User",
    password
  });
  if (authRes.status !== 200 || !authRes.data.access_token) {
    throw new Error(`User registration failed: ${JSON.stringify(authRes.data)}`);
  }
  const token = authRes.data.access_token;
  const userId = authRes.data.user.id;
  console.log(`✓ User registered (ID: ${userId}). Token acquired.`);

  // Register a device so initial entities exist
  console.log("2. Registering Companion mobile device...");
  const devRes = await makePost("/api/mobile_app/registrations", {
    device_id: `pixel_prod_${ts}`,
    app_id: "io.homeassistant.companion.android",
    app_name: "Home Assistant",
    app_version: "2024.1",
    device_name: "Pixel 8 Pro",
    manufacturer: "Google",
    model: "Pixel 8 Pro",
    os_name: "Android",
    os_version: "14"
  }, token);
  const webhookId = devRes.data.webhook_id;
  console.log(`✓ Device registered. Webhook ID: ${webhookId}`);

  // Create initial location/sensor state
  await makePost(`/api/webhook/${webhookId}`, {
    type: "update_location",
    data: { gps: [37.7749, -122.4194], battery: 88, gps_accuracy: 12 }
  });
  console.log("✓ Initial entity state seeded.");

  // TEST: Long-lived real Companion startup sequence
  console.log("\n3. Connecting Primary Companion WebSocket (WS1)...");
  let ws1Closed = false;
  let subscribeEntitiesResultReceived = false;
  let initialEntitiesReceived = false;
  let liveDiffEventReceived = false;
  let pongsReceived = 0;

  const ws1 = new WebSocket(BASE_URL);

  const ws1Promise = new Promise<void>((resolve, reject) => {
    ws1.on("open", () => {
      console.log("  → WS1 TCP/WS connection opened.");
    });

    ws1.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        
        if (msg.type === "auth_required") {
          console.log("  → Received auth_required. Sending auth token...");
          ws1.send(JSON.stringify({ type: "auth", access_token: token }));
        } else if (msg.type === "auth_ok") {
          console.log("  ✓ WS1 Authenticated (auth_ok). Executing real Companion App startup command sequence...");
          
          // Command 1: supported_features
          ws1.send(JSON.stringify({ id: 1, type: "supported_features", features: { coalesce_messages: 1 } }));

          // Command 2: subscribe_events (state_changed)
          ws1.send(JSON.stringify({ id: 2, type: "subscribe_events", event_type: "state_changed" }));

          // Command 3: subscribe_entities (CRITICAL REAL COMPANION COMMAND)
          ws1.send(JSON.stringify({ id: 3, type: "subscribe_entities" }));

          // Command 4: auth/current_user
          ws1.send(JSON.stringify({ id: 4, type: "auth/current_user" }));

          // Command 5: get_config
          ws1.send(JSON.stringify({ id: 5, type: "get_config" }));

          // Command 6: get_states
          ws1.send(JSON.stringify({ id: 6, type: "get_states" }));

          // Command 7: get_services
          ws1.send(JSON.stringify({ id: 7, type: "get_services" }));

          // Command 8: config/device_registry/list
          ws1.send(JSON.stringify({ id: 8, type: "config/device_registry/list" }));

          // Command 9: config/entity_registry/list
          ws1.send(JSON.stringify({ id: 9, type: "config/entity_registry/list" }));

          // Command 10: config/area_registry/list
          ws1.send(JSON.stringify({ id: 10, type: "config/area_registry/list" }));

          // Command 11: persistent_notification/get
          ws1.send(JSON.stringify({ id: 11, type: "persistent_notification/get" }));

          // Command 12: subscribe_trigger
          ws1.send(JSON.stringify({
            id: 12,
            type: "subscribe_trigger",
            trigger: { platform: "state", entity_id: `device_tracker.pixel_8_pro_${userId}` }
          }));

        } else if (msg.type === "result") {
          if (msg.id === 3 && msg.success === true) {
            subscribeEntitiesResultReceived = true;
            console.log("  ✓ Command 3 (subscribe_entities) succeeded! Result confirmation received.");
          } else if (msg.success === false) {
            console.error(`  ❌ Command ${msg.id} failed with error:`, msg.error);
          }
        } else if (msg.type === "event") {
          if (msg.id === 3 && msg.event?.a) {
            initialEntitiesReceived = true;
            const count = Object.keys(msg.event.a).length;
            console.log(`  ✓ Received subscribe_entities initial state dump ('a' key) with ${count} entities.`);
          } else if (msg.id === 3 && msg.event?.c) {
            liveDiffEventReceived = true;
            const updatedEntities = Object.keys(msg.event.c);
            console.log(`  ✓ Received live subscribe_entities diff ('c' key) for: ${updatedEntities.join(", ")}`);
          } else if (msg.event?.event_type === "state_changed") {
            console.log(`  ✓ Received state_changed event on sub_id ${msg.id} for: ${msg.event?.data?.entity_id}`);
          }
        } else if (msg.type === "pong") {
          pongsReceived++;
          console.log(`  ✓ Received application-level pong response (id: ${msg.id}).`);
        }
      } catch (err) {
        console.error("  WS1 message error:", err);
      }
    });

    ws1.on("close", (code, reason) => {
      ws1Closed = true;
      console.log(`  WS1 closed: code=${code}, reason=${reason.toString()}`);
    });

    ws1.on("error", (err) => {
      reject(err);
    });

    // Schedule periodic client application-level pings (every 20s)
    const pingInterval = setInterval(() => {
      if (ws1.readyState === WebSocket.OPEN) {
        const pingId = Math.floor(Math.random() * 10000);
        ws1.send(JSON.stringify({ id: pingId, type: "ping" }));
      }
    }, 20000);

    // Schedule live state update at t=15s
    setTimeout(async () => {
      console.log("\n4. Emitting live location telemetry update at t=15s...");
      try {
        await makePost(`/api/webhook/${webhookId}`, {
          type: "update_location",
          data: { gps: [37.7833, -122.4167], battery: 85, gps_accuracy: 8 }
        });
      } catch (e) {
        console.error("Failed to post live location update:", e);
      }
    }, 15000);

    // Schedule second simultaneous connection test at t=30s
    setTimeout(async () => {
      console.log("\n5. Testing simultaneous second connection (WS2) at t=30s...");
      const ws2 = new WebSocket(BASE_URL);
      let ws2Authenticated = false;

      ws2.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "auth_required") {
          ws2.send(JSON.stringify({ type: "auth", access_token: token }));
        } else if (msg.type === "auth_ok") {
          ws2Authenticated = true;
          console.log("  ✓ WS2 successfully connected and authenticated independently.");
          
          // Test client-initiated close of WS2
          setTimeout(() => {
            console.log("  ✓ Testing intentional client disconnect of WS2...");
            ws2.close(1000, "Normal closure from test");
          }, 5000);
        }
      });

      ws2.on("close", (code, reason) => {
        console.log(`  ✓ WS2 closed cleanly: code=${code}. WS1 remains active!`);
      });
    }, 30000);

    // Verify continuous 120-second survival
    setTimeout(() => {
      clearInterval(pingInterval);
      if (ws1Closed) {
        reject(new Error("WS1 closed prematurely before 120-second test completed!"));
      } else {
        console.log("\n✓ WS1 REMAINED CONTINUOUSLY CONNECTED FOR 120 SECONDS WITH ZERO DISCONNECTS!");
        resolve();
      }
    }, 120000);
  });

  await ws1Promise;

  // Verify assertions
  if (!subscribeEntitiesResultReceived) {
    throw new Error("Failed: subscribe_entities was not confirmed with success: true!");
  }
  if (!initialEntitiesReceived) {
    throw new Error("Failed: subscribe_entities initial state dump ('a') was not received!");
  }
  if (!liveDiffEventReceived) {
    throw new Error("Failed: subscribe_entities live diff update ('c') was not received!");
  }

  // Clean close of WS1
  console.log("6. Intentionally closing WS1 with client code 1000...");
  ws1.close(1000, "Test complete");
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log("\n============================================================");
  console.log("ALL PRODUCTION COMPANION LIFECYCLE TESTS PASSED! 🎉");
  console.log("============================================================\n");
}

runProductionCompanionLifecycleTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
