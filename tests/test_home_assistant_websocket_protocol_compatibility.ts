import WebSocket from "ws";

const WS_BASE_URL = "ws://127.0.0.1:3000/api/websocket";
const HTTP_BASE_URL = "http://127.0.0.1:3000";

interface ApiResponse {
  status: number;
  data: any;
}

async function postJson(path: string, body: any, token?: string): Promise<ApiResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${HTTP_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

async function deleteJson(path: string, token?: string): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${HTTP_BASE_URL}${path}`, {
    method: "DELETE",
    headers
  });
  return { status: res.status, data: await res.json() };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runProtocolCompatibilityTest() {
  console.log("================================================================================");
  console.log("HOME ASSISTANT CORE & COMPANION WEBSOCKET PROTOCOL COMPATIBILITY TEST SUITE");
  console.log("================================================================================");

  // Clear yimly_store_preview.json database to prevent entity id suffix accumulation pollution (_2, _3, etc.)
  try {
    const fs = await import("fs");
    const path = await import("path");
    const dbPath = path.join(process.cwd(), "yimly_store_preview.json");
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log("[Setup] Cleared yimly_store_preview.json database file for clean slate.");
    }
  } catch (err) {
    console.warn("[Setup] Could not clear database file:", err);
  }

  const runId = Date.now();

  // Create User A
  console.log("\n[Setup] Registering User A...");
  const userARes = await postJson("/api/auth/register", {
    username: `user_a_${runId}`,
    display_name: "Alice User",
    password: "Password123!"
  });
  if (!userARes.data.access_token) {
    throw new Error(`User A registration failed: ${JSON.stringify(userARes.data)}`);
  }
  const tokenA = userARes.data.access_token;
  const userAId = userARes.data.user.id;
  console.log(`  ✓ User A registered (id=${userAId})`);

  // Create User B
  console.log("\n[Setup] Registering User B...");
  const userBRes = await postJson("/api/auth/register", {
    username: `user_b_${runId}`,
    display_name: "Bob User",
    password: "Password123!"
  });
  if (!userBRes.data.access_token) {
    throw new Error(`User B registration failed: ${JSON.stringify(userBRes.data)}`);
  }
  const tokenB = userBRes.data.access_token;
  const userBId = userBRes.data.user.id;
  console.log(`  ✓ User B registered (id=${userBId})`);

  // Register mobile app for User A to obtain webhook_id
  const regARes = await postJson("/api/mobile_app/registrations", {
    device_id: "alice_phone",
    device_name: "Alice Phone",
    app_id: "io.homeassistant.companion.android",
    app_name: "Home Assistant",
    app_version: "2026.9",
    manufacturer: "Google",
    model: "Pixel 8",
    os_name: "Android",
    os_version: "14",
    supports_encryption: false
  }, tokenA);
  const webhookA = regARes.data.webhook_id;

  // Register mobile app for User B to obtain webhook_id
  const regBRes = await postJson("/api/mobile_app/registrations", {
    device_id: "bob_phone",
    device_name: "Bob Phone",
    app_id: "io.homeassistant.companion.android",
    app_name: "Home Assistant",
    app_version: "2026.9",
    manufacturer: "Google",
    model: "Pixel 8",
    os_name: "Android",
    os_version: "14",
    supports_encryption: false
  }, tokenB);
  const webhookB = regBRes.data.webhook_id;

  // Seed states for User A via webhooks
  console.log("\n[Setup] Seeding initial states for User A via webhooks...");
  await postJson(`/api/webhook/${webhookA}`, {
    type: "update_location",
    data: { latitude: 37.77, longitude: -122.41, gps_accuracy: 5 }
  });
  await postJson(`/api/webhook/${webhookA}`, {
    type: "register_sensor",
    data: { unique_id: "battery_a", name: "Battery Level", state: "95", type: "sensor", unit_of_measurement: "%", device_class: "battery" }
  });
  await postJson(`/api/webhook/${webhookA}`, {
    type: "register_sensor",
    data: { unique_id: "car_a", name: "Alice Car", state: "not_home", type: "sensor" }
  });
  console.log("  ✓ Seeded device_tracker.alice_phone, sensor.alice_phone_battery_level, sensor.alice_phone_alice_car for User A.");

  // Seed states for User B via webhooks
  console.log("\n[Setup] Seeding initial states for User B via webhooks...");
  await postJson(`/api/webhook/${webhookB}`, {
    type: "update_location",
    data: { latitude: 51.50, longitude: -0.12, gps_accuracy: 5 }
  });
  await postJson(`/api/webhook/${webhookB}`, {
    type: "register_sensor",
    data: { unique_id: "battery_b", name: "Battery Level", state: "80", type: "sensor", unit_of_measurement: "%" }
  });
  console.log("  ✓ Seeded device_tracker.bob_phone, sensor.bob_phone_battery_level for User B.");

  // Test Results Tracker
  const results: Record<string, boolean> = {
    android_startup: false,
    ios_startup: false,
    subscribe_entities_entity_ids: false,
    include_filtering: false,
    exclude_filtering: false,
    initial_snapshot_format: false,
    live_c_update_diff: false,
    live_a_addition: false,
    live_r_removal: false,
    ping_pong: false,
    duplicate_subscription_id_reuse: false,
    unsubscribe_handling: false,
    reconnect_resubscribe: false,
    multi_user_isolation: false,
    continuous_120s_connection: false
  };

  // -------------------------------------------------------------------------
  // 1 & 15. PRIMARY LONG-LIVED WEBSOCKET (User A) - Android Lifecycle
  // -------------------------------------------------------------------------
  console.log("\n--- Phase 1: Android-style Startup & Primary Long-lived Connection (WS1) ---");
  const ws1 = new WebSocket(WS_BASE_URL);
  let ws1Open = false;
  let ws1Closed = false;
  const ws1Events: any[] = [];
  const ws1Results: Record<number, any> = {};

  const ws1ConnectedPromise = new Promise<void>((resolve, reject) => {
    ws1.on("open", () => {
      ws1Open = true;
      console.log("  ✓ WS1 TCP/WS connection opened");
    });

    ws1.on("error", (err) => {
      console.error("  ❌ WS1 error:", err);
      reject(err);
    });

    ws1.on("close", (code, reason) => {
      ws1Closed = true;
      console.log(`  WS1 closed: code=${code}, reason=${reason.toString()}`);
    });

    ws1.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "auth_required") {
          console.log("  ✓ Received auth_required. Sending auth token for User A...");
          ws1.send(JSON.stringify({ type: "auth", access_token: tokenA }));
        } else if (msg.type === "auth_ok") {
          console.log("  ✓ WS1 Authenticated with auth_ok!");
          resolve();
        } else if (msg.type === "result") {
          ws1Results[msg.id] = msg;
        } else if (msg.type === "event") {
          ws1Events.push(msg);
        } else if (msg.type === "pong") {
          ws1Results[msg.id] = msg;
        }
      } catch (e) {
        console.error("  WS1 message parse error:", e);
      }
    });
  });

  await ws1ConnectedPromise;

  // Send Android startup sequence
  console.log("\n[Test 1] Executing Android Companion App Startup Sequence on WS1...");
  ws1.send(JSON.stringify({ id: 1, type: "supported_features", features: { coalesce_messages: 1 } }));
  ws1.send(JSON.stringify({ id: 2, type: "subscribe_events", event_type: "state_changed" }));
  ws1.send(JSON.stringify({ id: 3, type: "config/device_registry/list" }));
  ws1.send(JSON.stringify({ id: 4, type: "config/entity_registry/list" }));
  ws1.send(JSON.stringify({ id: 5, type: "config/entity_registry/list_for_display" }));
  ws1.send(JSON.stringify({ id: 6, type: "config/area_registry/list" }));
  ws1.send(JSON.stringify({ id: 7, type: "config/floor_registry/list" }));
  ws1.send(JSON.stringify({ id: 8, type: "persistent_notification/get" }));
  ws1.send(JSON.stringify({ id: 9, type: "subscribe_trigger", trigger: { platform: "state", entity_id: "person.alice" } }));
  ws1.send(JSON.stringify({ id: 10, type: "mobile_app/push_notification_channel" }));

  await delay(1500);

  // Verify Android Startup Results
  if (
    ws1Results[1]?.success === true &&
    ws1Results[2]?.success === true &&
    ws1Results[3]?.success === true &&
    Array.isArray(ws1Results[3]?.result) &&
    ws1Results[4]?.success === true &&
    Array.isArray(ws1Results[4]?.result) &&
    ws1Results[5]?.success === true &&
    Array.isArray(ws1Results[5]?.result?.entities) &&
    ws1Results[6]?.success === true &&
    ws1Results[7]?.success === true &&
    Array.isArray(ws1Results[7]?.result) &&
    ws1Results[8]?.success === true &&
    ws1Results[9]?.success === true &&
    ws1Results[10]?.success === true
  ) {
    results.android_startup = true;
    console.log("  ✓ Test 1: Android startup sequence completely validated!");
  } else {
    throw new Error(`Test 1 Failed: Android startup results mismatch: ${JSON.stringify(ws1Results)}`);
  }

  // -------------------------------------------------------------------------
  // 9. Application Ping/Pong
  // -------------------------------------------------------------------------
  console.log("\n[Test 9] Testing Application-level Ping/Pong on WS1...");
  const pingId = 9999;
  ws1.send(JSON.stringify({ id: pingId, type: "ping" }));
  await delay(500);
  if (ws1Results[pingId]?.type === "pong" && ws1Results[pingId]?.id === pingId) {
    results.ping_pong = true;
    console.log(`  ✓ Test 9: Ping/Pong verified with matching id=${pingId}!`);
  } else {
    throw new Error(`Test 9 Failed: Ping response incorrect: ${JSON.stringify(ws1Results[pingId])}`);
  }

  // -------------------------------------------------------------------------
  // 3 & 6. subscribe_entities with entity_ids filter & snapshot validation
  // -------------------------------------------------------------------------
  console.log("\n[Test 3 & 6] Testing subscribe_entities with explicit entity_ids filter...");
  const subFilteredId = 20;
  ws1.send(JSON.stringify({
    id: subFilteredId,
    type: "subscribe_entities",
    entity_ids: ["device_tracker.alice_phone", "sensor.alice_phone_battery_level"]
  }));
  await delay(1000);

  if (ws1Results[subFilteredId]?.success !== true) {
    throw new Error(`subscribe_entities failed: ${JSON.stringify(ws1Results[subFilteredId])}`);
  }

  const snapshotEvent = ws1Events.find((e) => e.id === subFilteredId && e.event?.a);
  if (!snapshotEvent) {
    throw new Error("Initial snapshot event 'a' not received for sub_id 20!");
  }

  const snapshotA = snapshotEvent.event.a;
  console.log("  Snapshot 'a' keys received:", Object.keys(snapshotA));

  // Verify entity_ids filter strictly obeyed
  if (snapshotA["device_tracker.alice_phone"] && snapshotA["sensor.alice_phone_battery_level"] && !snapshotA["sensor.alice_phone_alice_car"]) {
    results.subscribe_entities_entity_ids = true;
    console.log("  ✓ Test 3: entity_ids filter accurately delivered ONLY device_tracker.alice_phone and sensor.alice_phone_battery_level!");
  } else {
    throw new Error(`Test 3 Failed: entity_ids filtering failed: ${JSON.stringify(snapshotA)}`);
  }

  // Verify initial snapshot structure and types
  const alicePhoneState = snapshotA["device_tracker.alice_phone"];
  if (
    typeof alicePhoneState.s === "string" &&
    typeof alicePhoneState.a === "object" &&
    typeof alicePhoneState.lc === "number" &&
    typeof alicePhoneState.c !== "undefined"
  ) {
    results.initial_snapshot_format = true;
    console.log("  ✓ Test 6: Snapshot entity format strictly adheres to Home Assistant Core compressed schema!");
  } else {
    throw new Error(`Test 6 Failed: compressed entity state malformed: ${JSON.stringify(alicePhoneState)}`);
  }

  // -------------------------------------------------------------------------
  // 4 & 5. Include and Exclude Domain Filters
  // -------------------------------------------------------------------------
  console.log("\n[Test 4 & 5] Testing subscribe_entities with include & exclude domain filters...");
  const subIncludeId = 30;
  ws1.send(JSON.stringify({
    id: subIncludeId,
    type: "subscribe_entities",
    include: { domains: ["sensor"] }
  }));
  await delay(1000);
  const incEvent = ws1Events.find((e) => e.id === subIncludeId && e.event?.a);
  const incKeys = Object.keys(incEvent?.event?.a || {});
  if (incKeys.every((k) => k.startsWith("sensor.")) && incKeys.includes("sensor.alice_phone_battery_level")) {
    results.include_filtering = true;
    console.log("  ✓ Test 4: Include filter for domain 'sensor' successfully verified!");
  } else {
    throw new Error(`Test 4 Failed: Include filter failed: ${JSON.stringify(incKeys)}`);
  }

  const subExcludeId = 40;
  ws1.send(JSON.stringify({
    id: subExcludeId,
    type: "subscribe_entities",
    exclude: { domains: ["device_tracker"] }
  }));
  await delay(1000);
  const excEvent = ws1Events.find((e) => e.id === subExcludeId && e.event?.a);
  const excKeys = Object.keys(excEvent?.event?.a || {});
  if (!excKeys.some((k) => k.startsWith("device_tracker.")) && excKeys.includes("sensor.alice_phone_battery_level")) {
    results.exclude_filtering = true;
    console.log("  ✓ Test 5: Exclude filter for domain 'device_tracker' successfully verified!");
  } else {
    throw new Error(`Test 5 Failed: Exclude filter failed: ${JSON.stringify(excKeys)}`);
  }

  // -------------------------------------------------------------------------
  // 10. Duplicate Subscription Handling (id_reuse)
  // -------------------------------------------------------------------------
  console.log("\n[Test 10] Testing duplicate subscription identifier rejection (id_reuse)...");
  ws1.send(JSON.stringify({
    id: subFilteredId, // Reusing existing active subscription ID 20
    type: "subscribe_entities"
  }));
  await delay(500);
  const reuseResult = ws1Results[subFilteredId];
  // Since we sent another command with id: 20, the second response will overwrite ws1Results[20]
  if (reuseResult?.success === false && reuseResult?.error?.code === "id_reuse") {
    results.duplicate_subscription_id_reuse = true;
    console.log("  ✓ Test 10: Reused subscription ID rejected with official 'id_reuse' error!");
  } else {
    throw new Error(`Test 10 Failed: Expected id_reuse error: ${JSON.stringify(reuseResult)}`);
  }

  // -------------------------------------------------------------------------
  // 7. Live "c" Changes & Diff Protocol
  // -------------------------------------------------------------------------
  console.log("\n[Test 7] Testing Live State Changes & Attribute Diffs ('c' event)...");
  ws1Events.length = 0; // Clear events to isolate live diff

  await postJson(`/api/webhook/${webhookA}`, {
    type: "update_location",
    data: { latitude: 37.80, longitude: -122.40, speed: 25 }
  });
  await delay(1000);

  const diffEvent = ws1Events.find((e) => e.id === subFilteredId && e.event?.c?.["device_tracker.alice_phone"]);
  if (!diffEvent) {
    throw new Error(`Live diff 'c' event not received for device_tracker.alice_phone: ${JSON.stringify(ws1Events)}`);
  }
  const diffPayload = diffEvent.event.c["device_tracker.alice_phone"];
  console.log("  Diff '+' received for device_tracker.alice_phone:", diffPayload["+"]);
  if (
    diffPayload["+"]?.a?.speed === 25
  ) {
    results.live_c_update_diff = true;
    console.log("  ✓ Test 7: Live diff event 'c' with '+' additions correctly transmitted!");
  } else {
    throw new Error(`Test 7 Failed: diff payload incorrect: ${JSON.stringify(diffPayload)}`);
  }

  // -------------------------------------------------------------------------
  // 7b. Live "a" Additions Protocol
  // -------------------------------------------------------------------------
  console.log("\n[Test 7b] Testing Live Addition of a New Entity ('a' event)...");
  ws1Events.length = 0;
  // Subscribe to all entities on a new sub ID 50
  const subAllId = 50;
  ws1.send(JSON.stringify({ id: subAllId, type: "subscribe_entities" }));
  await delay(1000);

  // Add a brand new entity via webhook
  await postJson(`/api/webhook/${webhookA}`, {
    type: "register_sensor",
    data: { unique_id: "alice_steps", name: "Steps Today", state: "8500", type: "sensor", unit_of_measurement: "steps" }
  });
  await delay(1000);

  const additionEvent = ws1Events.find((e) => e.id === subAllId && e.event?.a?.["sensor.alice_phone_steps_today"]);
  if (additionEvent) {
    results.live_a_addition = true;
    console.log("  ✓ Test 7b: Brand new entity delivered via 'a' addition event:", additionEvent.event.a["sensor.alice_phone_steps_today"]);
  } else {
    throw new Error(`Test 7b Failed: 'a' addition event not received for sensor.alice_phone_steps_today: ${JSON.stringify(ws1Events)}`);
  }

  // -------------------------------------------------------------------------
  // 8. Live "r" Removals Protocol
  // -------------------------------------------------------------------------
  console.log("\n[Test 8] Testing Live Entity Removal / Deletion ('r' event)...");
  ws1Events.length = 0;

  const delRes = await deleteJson(`/api/devices/sensor.alice_phone_steps_today`, tokenA);
  if (delRes.status !== 200) {
    throw new Error(`Failed to delete sensor.alice_phone_steps_today: ${JSON.stringify(delRes.data)}`);
  }
  await delay(1000);

  const removalEvent = ws1Events.find((e) => e.id === subAllId && Array.isArray(e.event?.r) && e.event.r.includes("sensor.alice_phone_steps_today"));
  if (removalEvent) {
    results.live_r_removal = true;
    console.log("  ✓ Test 8: Entity removal delivered via 'r' event:", removalEvent.event.r);
  } else {
    throw new Error(`Test 8 Failed: 'r' removal event not received: ${JSON.stringify(ws1Events)}`);
  }

  // -------------------------------------------------------------------------
  // 11. Unsubscribe Handling
  // -------------------------------------------------------------------------
  console.log("\n[Test 11] Testing Unsubscribe Handling...");
  const unsubCmdId = 60;
  ws1.send(JSON.stringify({
    id: unsubCmdId,
    type: "unsubscribe_entities",
    subscription: subFilteredId // Unsubscribing sub_id 20
  }));
  await delay(500);

  if (ws1Results[unsubCmdId]?.success === true) {
    console.log("  ✓ Unsubscribe acknowledged with success: true");
    // Verify that subsequent state changes do NOT arrive on sub_id 20
    ws1Events.length = 0;
    await postJson(`/api/webhook/${webhookA}`, {
      type: "update_location",
      data: { latitude: 37.77, longitude: -122.41 }
    });
    await delay(1000);

    const staleEvent = ws1Events.find((e) => e.id === subFilteredId);
    if (!staleEvent) {
      results.unsubscribe_handling = true;
      console.log("  ✓ Test 11: Unsubscribe verified! Zero events received on unsubscribed ID.");
    } else {
      throw new Error(`Test 11 Failed: Event received on unsubscribed ID: ${JSON.stringify(staleEvent)}`);
    }
  } else {
    throw new Error(`Test 11 Failed: unsubscribe rejected: ${JSON.stringify(ws1Results[unsubCmdId])}`);
  }

  // -------------------------------------------------------------------------
  // 2. iOS-style Startup on a Separate Connection (WS_iOS)
  // -------------------------------------------------------------------------
  console.log("\n--- Phase 2: iOS-style Startup & Commands (WS_iOS) ---");
  const wsIos = new WebSocket(WS_BASE_URL);
  const iosResults: Record<number, any> = {};

  const iosConnectedPromise = new Promise<void>((resolve, reject) => {
    wsIos.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "auth_required") {
        wsIos.send(JSON.stringify({ type: "auth", access_token: tokenA }));
      } else if (msg.type === "auth_ok") {
        resolve();
      } else if (msg.type === "result") {
        iosResults[msg.id] = msg;
      }
    });
    wsIos.on("error", reject);
  });

  await iosConnectedPromise;

  console.log("[Test 2] Executing iOS HAKit Companion App Startup Sequence...");
  wsIos.send(JSON.stringify({ id: 101, type: "auth/current_user" }));
  wsIos.send(JSON.stringify({ id: 102, type: "get_config" }));
  wsIos.send(JSON.stringify({ id: 103, type: "get_states" }));
  wsIos.send(JSON.stringify({ id: 104, type: "get_services" }));
  wsIos.send(JSON.stringify({ id: 105, type: "get_panels" }));
  wsIos.send(JSON.stringify({ id: 106, type: "frontend/get_translations" }));
  wsIos.send(JSON.stringify({ id: 107, type: "manifest/list" }));
  wsIos.send(JSON.stringify({ id: 108, type: "render_template", template: "{{ states('person.alice') }}" }));

  await delay(1500);

  if (
    iosResults[101]?.success === true && iosResults[101]?.result?.id === String(userAId) &&
    iosResults[102]?.success === true && iosResults[102]?.result?.version &&
    iosResults[103]?.success === true && Array.isArray(iosResults[103]?.result) &&
    iosResults[104]?.success === true &&
    iosResults[105]?.success === true &&
    iosResults[106]?.success === true &&
    iosResults[107]?.success === true &&
    iosResults[108]?.success === true
  ) {
    results.ios_startup = true;
    console.log("  ✓ Test 2: iOS HAKit startup sequence verified with 100% success!");
  } else {
    throw new Error(`Test 2 Failed: iOS results mismatch: ${JSON.stringify(iosResults)}`);
  }

  wsIos.close(1000, "iOS test complete");

  // -------------------------------------------------------------------------
  // 12. Reconnect / Resubscribe Test
  // -------------------------------------------------------------------------
  console.log("\n[Test 12] Testing Reconnect and Resubscription flow...");
  const wsRecon = new WebSocket(WS_BASE_URL);
  let reconSnapshotReceived = false;

  await new Promise<void>((resolve, reject) => {
    wsRecon.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "auth_required") {
        wsRecon.send(JSON.stringify({ type: "auth", access_token: tokenA }));
      } else if (msg.type === "auth_ok") {
        // Resubscribe immediately
        wsRecon.send(JSON.stringify({ id: 1, type: "subscribe_entities" }));
      } else if (msg.type === "event" && msg.event?.a) {
        reconSnapshotReceived = true;
        resolve();
      }
    });
    wsRecon.on("error", reject);
  });

  if (reconSnapshotReceived) {
    results.reconnect_resubscribe = true;
    console.log("  ✓ Test 12: Reconnect and resubscribe succeeded cleanly!");
  }
  wsRecon.close(1000, "Reconnect test complete");

  // -------------------------------------------------------------------------
  // 13 & 14. Multi-User & Cross-User Security Isolation
  // -------------------------------------------------------------------------
  console.log("\n[Test 13 & 14] Testing Multi-User Security and Cross-User Data Isolation...");
  const wsUserB = new WebSocket(WS_BASE_URL);
  const userBEvents: any[] = [];

  await new Promise<void>((resolve, reject) => {
    wsUserB.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "auth_required") {
        wsUserB.send(JSON.stringify({ type: "auth", access_token: tokenB }));
      } else if (msg.type === "auth_ok") {
        wsUserB.send(JSON.stringify({ id: 1, type: "subscribe_entities" }));
      } else if (msg.type === "event") {
        userBEvents.push(msg);
        if (msg.event?.a) resolve();
      }
    });
    wsUserB.on("error", reject);
  });

  const userBSnapshot = userBEvents.find((e) => e.event?.a)?.event.a;
  console.log("  User B Snapshot keys:", Object.keys(userBSnapshot || {}));

  // Assert User B DOES NOT see User A's entities
  if (userBSnapshot["device_tracker.bob_phone"] && !userBSnapshot["device_tracker.alice_phone"]) {
    console.log("  ✓ User B cannot see User A's initial entities in snapshot.");
  } else {
    throw new Error("Security Violation: User B received User A's entity in initial snapshot!");
  }

  // Clear events and trigger update for User A
  ws1Events.length = 0;
  userBEvents.length = 0;

  console.log("  Triggering live location update for User A via webhook...");
  const updateRes = await postJson(`/api/webhook/${webhookA}`, {
    type: "update_location",
    data: { latitude: 37.79, longitude: -122.39, speed: 15 }
  });
  console.log("  Webhook update response:", updateRes.status, updateRes.data);
  await delay(1500);

  console.log("  ws1Events received:", JSON.stringify(ws1Events));
  console.log("  userBEvents received:", JSON.stringify(userBEvents));

  // Assert User A received the update
  const userAHasUpdate = ws1Events.some((e) => e.event?.c?.["device_tracker.alice_phone"] || e.event?.data?.entity_id === "device_tracker.alice_phone");
  // Assert User B DID NOT receive User A's update
  const userBHasUpdate = userBEvents.some((e) => e.event?.c?.["device_tracker.alice_phone"] || e.event?.data?.entity_id === "device_tracker.alice_phone");

  if (userAHasUpdate && !userBHasUpdate) {
    results.multi_user_isolation = true;
    console.log("  ✓ Test 13 & 14: Cross-user isolation verified! User A received update; User B received ZERO leaked events.");
  } else {
    throw new Error(`Security Violation: User A received: ${userAHasUpdate}, User B leaked: ${userBHasUpdate}`);
  }

  wsUserB.close(1000, "User B test complete");

  // -------------------------------------------------------------------------
  // 15. Continuous 120-Second Lifetime Verification for WS1
  // -------------------------------------------------------------------------
  console.log("\n--- Phase 3: Continuous 120-Second Lifetime Verification (WS1) ---");
  const startTime = Date.now();
  console.log("  Starting 120s longevity monitor. Sending ping every 20 seconds...");

  const pingTimer = setInterval(() => {
    if (ws1.readyState === WebSocket.OPEN) {
      const pId = Math.floor(Math.random() * 50000) + 10000;
      ws1.send(JSON.stringify({ id: pId, type: "ping" }));
    }
  }, 20000);

  // Wait until full 120 seconds elapsed from connect
  await new Promise<void>((resolve, reject) => {
    const checkInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (ws1Closed) {
        clearInterval(checkInterval);
        clearInterval(pingTimer);
        reject(new Error(`WS1 closed unexpectedly at ${elapsed}s!`));
      } else if (elapsed >= 120) {
        clearInterval(checkInterval);
        clearInterval(pingTimer);
        results.continuous_120s_connection = true;
        console.log(`  ✓ WS1 REMAINED CONTINUOUSLY CONNECTED FOR ${elapsed} SECONDS WITH ZERO DISCONNECTS!`);
        resolve();
      } else {
        process.stdout.write(`  [Longevity monitor: ${elapsed}/120s alive, readyState=${ws1.readyState}]\r`);
      }
    }, 2000);
  });

  // Clean close of WS1
  ws1.close(1000, "Protocol suite complete");
  await delay(1000);

  console.log("\n================================================================================");
  console.log("FINAL PROTOCOL COMPATIBILITY VERIFICATION SUMMARY");
  console.log("================================================================================");
  let allPassed = true;
  for (const [testName, passed] of Object.entries(results)) {
    console.log(`  ${passed ? "✓ PASS" : "❌ FAIL"}: ${testName}`);
    if (!passed) allPassed = false;
  }
  console.log("================================================================================");

  if (!allPassed) {
    throw new Error("One or more protocol compatibility tests failed!");
  }
  console.log("ALL HOME ASSISTANT PROTOCOL COMPATIBILITY TESTS PASSED! 🎉\n");
}

runProtocolCompatibilityTest().catch((err) => {
  console.error("\n❌ Compatibility test suite failed with error:", err);
  process.exit(1);
});
