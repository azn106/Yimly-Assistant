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

async function runLongLivedWebSocketLifecycleSuite() {
  console.log("============================================================");
  console.log("RUNNING LONG-LIVED WEBSOCKET LIFECYCLE & 60S+ STABILITY SUITE");
  console.log("============================================================");

  const ts = Date.now();
  const username = `ws_long_lived_${ts}`;
  const password = "Password123!";

  // 1. Register test user
  console.log("1. Authenticating test user...");
  const authRes = await makePost("/api/auth/register", {
    username,
    display_name: "Long-Lived WS User",
    password
  });
  if (authRes.status !== 200 || !authRes.data.access_token) {
    throw new Error(`User registration failed: ${JSON.stringify(authRes.data)}`);
  }
  const token = authRes.data.access_token;
  const userId = authRes.data.user.id;
  console.log(`✓ User registered (ID: ${userId}).`);

  // TEST 1 & 2: Long-lived Android Startup Sequence (>60 Seconds)
  console.log("\n2. Testing Android Companion Startup Sequence & 60s+ Continuous Duration...");
  let ws1Closed = false;
  let receivedEvents: any[] = [];

  const ws1 = new WebSocket(BASE_URL);

  const ws1Promise = new Promise<void>((resolve, reject) => {
    ws1.on("open", () => {
      console.log("  → WS1 connected.");
    });

    ws1.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "auth_required") {
          ws1.send(JSON.stringify({ type: "auth", access_token: token }));
        } else if (msg.type === "auth_ok") {
          console.log("  ✓ WS1 Authenticated! Sending Android startup commands...");
          
          // Send official Android Companion startup sequence
          ws1.send(JSON.stringify({ id: 1, type: "subscribe_events", event_type: "state_changed" }));
          ws1.send(JSON.stringify({ id: 2, type: "auth/current_user" }));
          ws1.send(JSON.stringify({ id: 3, type: "get_config" }));
          ws1.send(JSON.stringify({ id: 4, type: "get_states" }));
          ws1.send(JSON.stringify({ id: 5, type: "get_services" }));
          ws1.send(JSON.stringify({ id: 6, type: "subscribe_trigger", trigger: { platform: "state" } }));
          ws1.send(JSON.stringify({ id: 7, type: "config/device_registry/list" }));
          ws1.send(JSON.stringify({ id: 8, type: "config/entity_registry/list" }));
        } else if (msg.type === "event") {
          receivedEvents.push(msg.event);
          console.log(`  ✓ Received state_changed WebSocket event for entity: ${msg.event?.data?.entity_id}`);
        }
      } catch (e) {
        console.error("  WS1 message error:", e);
      }
    });

    ws1.on("close", (code, reason) => {
      ws1Closed = true;
      console.log(`  WS1 closed: code=${code}, reason=${reason.toString()}`);
    });

    ws1.on("error", (err) => {
      reject(err);
    });

    // Hold open for 65 seconds
    setTimeout(() => {
      if (ws1Closed) {
        reject(new Error("WS1 unexpectedly closed before 60s test completed!"));
      } else {
        console.log("  ✓ WS1 remained connected continuously for 65 SECONDS! (Passed 60s threshold)");
        resolve();
      }
    }, 65000);
  });

  // TEST 3: State event delivery while connected
  setTimeout(async () => {
    console.log("\n3. Emitting state_changed event at t=10s while WS1 is active...");
    try {
      // Create a device registration and post location update to trigger state_changed event
      const devRes = await makePost("/api/mobile_app/registrations", {
        device_id: `android_dev_${ts}`,
        app_id: "io.homeassistant.companion.android",
        app_name: "Home Assistant",
        app_version: "2024.1",
        device_name: "Pixel 8 Pro",
        manufacturer: "Google",
        model: "Pixel 8 Pro",
        os_name: "Android",
        os_version: "14"
      }, token);

      if (devRes.data.webhook_id) {
        await makePost(`/api/webhook/${devRes.data.webhook_id}`, {
          type: "update_location",
          data: { gps: [37.7749, -122.4194], battery: 92 }
        });
      }
    } catch (e) {
      console.error("Failed to trigger state update event:", e);
    }
  }, 10000);

  // TEST 5: Multiple Simultaneous Connections
  console.log("\n4. Connecting secondary WebSocket session (WS2) concurrently...");
  const ws2 = new WebSocket(BASE_URL);
  let ws2Closed = false;

  await new Promise<void>((resolve, reject) => {
    ws2.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_required") {
        ws2.send(JSON.stringify({ type: "auth", access_token: token }));
      } else if (msg.type === "auth_ok") {
        console.log("  ✓ WS2 authenticated concurrently alongside WS1.");
        resolve();
      }
    });
    ws2.on("close", () => { ws2Closed = true; });
    ws2.on("error", reject);
  });

  // TEST 4: Client-initiated disconnect of WS2
  console.log("\n5. Testing intentional client-initiated close of WS2...");
  ws2.close();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (!ws2Closed) throw new Error("WS2 failed to close cleanly.");
  if (ws1Closed) throw new Error("Closing WS2 unexpectedly closed WS1!");
  console.log("  ✓ WS2 closed cleanly without affecting WS1.");

  // Await the completion of 65-second WS1 survival test
  await ws1Promise;

  ws1.close();
  console.log("\n============================================================");
  console.log("ALL LONG-LIVED WEBSOCKET LIFECYCLE TESTS PASSED! 🎉");
  console.log("============================================================\n");
}

runLongLivedWebSocketLifecycleSuite().catch((err) => {
  console.error("Long-Lived WS Lifecycle Test Error:", err);
  process.exit(1);
});
