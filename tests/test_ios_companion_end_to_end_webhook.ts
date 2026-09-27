import http from "http";

const BASE_URL = "http://127.0.0.1:3000";

function makeRequest(
  method: string,
  urlPath: string,
  body?: any,
  token?: string
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const postData = body ? JSON.stringify(body) : "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (postData) {
      headers["Content-Length"] = Buffer.byteLength(postData).toString();
    }

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 500, data: raw ? JSON.parse(raw) : {} });
          } catch {
            resolve({ status: res.statusCode || 500, data: raw });
          }
        });
      }
    );

    req.on("error", (err) => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

async function runIosCompanionEndToEndWebhookSuite() {
  console.log("============================================================");
  console.log("RUNNING OFFICIAL HOME ASSISTANT IOS COMPANION WEBHOOK SUITE");
  console.log("============================================================");

  const ts = Date.now();
  const username = `ios_ha_user_${ts}`;
  const password = "Password123!";

  // 1. Register test user
  console.log("1. Authenticating test user...");
  const authRes = await makeRequest("POST", "/api/auth/register", {
    username,
    display_name: "iOS Companion User",
    password
  });
  if (authRes.status !== 200 || !authRes.data.access_token) {
    throw new Error(`User registration failed: ${JSON.stringify(authRes.data)}`);
  }
  const token = authRes.data.access_token;
  console.log("✓ User registered and JWT token acquired.");

  // 2. Register mobile_app from iOS Companion App
  console.log("\n2. Registering iOS Companion device via POST /api/mobile_app/registrations...");
  const iosDeviceId = `iOS_UUID_${ts}`;
  const regPayload = {
    device_id: iosDeviceId,
    app_id: "io.robertharding.ha",
    app_name: "Home Assistant",
    app_version: "2024.1",
    device_name: "iPhone 15 Pro Max",
    manufacturer: "Apple",
    model: "iPhone16,2",
    os_name: "iOS",
    os_version: "17.5.1",
    supports_encryption: false,
    app_data: { push_token: `apns_token_${ts}` }
  };
  const regRes = await makeRequest("POST", "/api/mobile_app/registrations", regPayload, token);
  if (regRes.status !== 201 || !regRes.data.webhook_id) {
    throw new Error(`Device registration failed: ${JSON.stringify(regRes.data)}`);
  }
  const webhookId = regRes.data.webhook_id;
  console.log(`✓ iOS Companion device registered successfully. Webhook ID: ${webhookId}`);

  // 3. iOS Companion Startup: get_config webhook
  console.log("\n3. Testing iOS Startup Webhook: type='get_config'...");
  const configRes = await makeRequest("POST", `/api/webhook/${webhookId}`, { type: "get_config" });
  if (configRes.status !== 200) {
    throw new Error(`get_config failed with status ${configRes.status}: ${JSON.stringify(configRes.data)}`);
  }
  if (configRes.data.version !== "2026.9.1") {
    throw new Error(`Expected get_config version 2026.9.1, got ${configRes.data.version}`);
  }
  console.log(`✓ get_config returned 200 OK with version: ${configRes.data.version}, components: ${configRes.data.components.join(", ")}`);

  // 4. iOS Companion Startup: get_zones webhook
  console.log("\n4. Testing iOS Startup Webhook: type='get_zones'...");
  const zonesRes = await makeRequest("POST", `/api/webhook/${webhookId}`, { type: "get_zones" });
  if (zonesRes.status !== 200) {
    throw new Error(`get_zones failed with status ${zonesRes.status}`);
  }
  console.log("✓ get_zones returned 200 OK.");

  // 5. iOS Companion Startup: update_registration webhook
  console.log("\n5. Testing iOS Webhook: type='update_registration'...");
  const updateRegRes = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "update_registration",
    data: {
      app_version: "2024.1.2",
      os_version: "17.5.1",
      device_name: "iPhone 15 Pro Max"
    }
  });
  if (updateRegRes.status !== 200) {
    throw new Error(`update_registration failed with status ${updateRegRes.status}`);
  }
  console.log("✓ update_registration returned 200 OK.");

  // 6. iOS Sensor Registration: register_sensor
  console.log("\n6. Testing iOS Webhook: type='register_sensor'...");
  const sensors = [
    { name: "Battery Level", unique_id: "battery_level", type: "sensor", state: 88, unit_of_measurement: "%", device_class: "battery" },
    { name: "Battery State", unique_id: "battery_state", type: "sensor", state: "Charging", device_class: "battery" },
    { name: "Connection Type", unique_id: "connection_type", type: "sensor", state: "Wi-Fi" },
    { name: "BSSID", unique_id: "bssid", type: "sensor", state: "aa:bb:cc:dd:ee:ff" }
  ];
  for (const s of sensors) {
    const sRes = await makeRequest("POST", `/api/webhook/${webhookId}`, { type: "register_sensor", data: s });
    if (sRes.status !== 201 && sRes.status !== 200) {
      throw new Error(`register_sensor failed for ${s.name}: ${JSON.stringify(sRes.data)}`);
    }
  }
  console.log("✓ All iOS initial sensors registered cleanly (HTTP 201/200).");

  // 7. iOS Sensor Updates: update_sensor_states
  console.log("\n7. Testing iOS Webhook: type='update_sensor_states'...");
  const stateUpdateRes = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "update_sensor_states",
    data: [
      { unique_id: "battery_level", state: 87, attributes: { battery_health: "Good" } },
      { unique_id: "battery_state", state: "Unplugged" }
    ]
  });
  if (stateUpdateRes.status !== 200 || !stateUpdateRes.data.battery_level?.success) {
    throw new Error(`update_sensor_states failed: ${JSON.stringify(stateUpdateRes.data)}`);
  }
  console.log("✓ update_sensor_states returned 200 OK with success map.");

  // 8. iOS Location Update: Standard format with gps array
  console.log("\n8. Testing iOS Location Update: Standard HA 'gps' array format...");
  const locRes1 = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "update_location",
    data: {
      gps: [37.7749, -122.4194],
      gps_accuracy: 10.0,
      vertical_accuracy: 5.0,
      altitude: 35.0,
      course: 180.0,
      speed: 1.2,
      battery: 87
    }
  });
  if (locRes1.status !== 200) {
    throw new Error(`update_location (gps array) failed with status ${locRes1.status}: ${JSON.stringify(locRes1.data)}`);
  }
  console.log("✓ update_location (gps array) returned 200 OK.");

  // 9. iOS Location Update: Nested 'location' payload format
  console.log("\n9. Testing iOS Location Update: Nested 'location' payload format...");
  const locRes2 = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "update_location",
    data: {
      location: {
        latitude: 37.7833,
        longitude: -122.4167,
        accuracy: 8.0
      },
      battery: 86
    }
  });
  if (locRes2.status !== 200) {
    throw new Error(`update_location (nested location) failed with status ${locRes2.status}: ${JSON.stringify(locRes2.data)}`);
  }
  console.log("✓ update_location (nested location) returned 200 OK.");

  // 10. iOS Location Update: Zone enter/exit format (zone / location_name)
  console.log("\n10. Testing iOS Location Update: Zone event payload format...");
  const locRes3 = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "update_location",
    data: {
      zone: "Home",
      location_name: "Home"
    }
  });
  if (locRes3.status !== 200) {
    throw new Error(`update_location (zone event) failed with status ${locRes3.status}: ${JSON.stringify(locRes3.data)}`);
  }
  console.log("✓ update_location (zone event) returned 200 OK.");

  // 11. iOS Location Update: Empty keepalive ping
  console.log("\n11. Testing iOS Location Update: Empty keepalive payload...");
  const locRes4 = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "update_location",
    data: {}
  });
  if (locRes4.status !== 200) {
    throw new Error(`update_location (empty keepalive) failed with status ${locRes4.status}`);
  }
  console.log("✓ update_location (empty keepalive) returned 200 OK.");

  // 12. iOS Action & Template Webhooks (fire_event, render_template)
  console.log("\n12. Testing iOS Other Webhook types: fire_event and render_template...");
  const fireEventRes = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "fire_event",
    data: { event_type: "ios.action_fired", actionName: "Open Garage" }
  });
  const renderTplRes = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "render_template",
    data: { template: "{{ states('sensor.battery_level') }}" }
  });
  if (fireEventRes.status !== 200 || renderTplRes.status !== 200) {
    throw new Error(`fire_event/render_template failed: ${fireEventRes.status}, ${renderTplRes.status}`);
  }
  console.log("✓ fire_event and render_template returned 200 OK.");

  // 13. Verify stored entity state in Home Assistant backend
  console.log("\n13. Verifying stored device_tracker and sensor entities...");
  const statesRes = await makeRequest("GET", "/api/states", undefined, token);
  if (statesRes.status !== 200 || !Array.isArray(statesRes.data)) {
    throw new Error(`Failed to fetch states: ${JSON.stringify(statesRes.data)}`);
  }
  const tracker = statesRes.data.find((e: any) => e.domain === "device_tracker");
  const batterySensor = statesRes.data.find((e: any) => e.entity_id.includes("battery_level"));

  if (!tracker || tracker.latitude == null || tracker.longitude == null) {
    throw new Error(`device_tracker entity not found or missing coordinates: ${JSON.stringify(tracker)}`);
  }
  if (!batterySensor || batterySensor.state !== "87") {
    throw new Error(`battery sensor entity state mismatch. Expected 87, got ${batterySensor?.state}`);
  }
  console.log(`✓ Stored tracker verified: ${tracker.entity_id} (lat: ${tracker.latitude}, lon: ${tracker.longitude})`);
  console.log(`✓ Stored sensor verified: ${batterySensor.entity_id} (state: ${batterySensor.state}%)`);

  // 14. Verify security: non-existent webhook returns 410 Gone, malformed request returns 400 Bad Request
  console.log("\n14. Testing security responses for invalid webhooks...");
  const invalidWhRes = await makeRequest("POST", "/api/webhook/non_existent_webhook_xyz_123", { type: "get_config" });
  if (invalidWhRes.status !== 410) {
    throw new Error(`Expected HTTP 410 Gone for non-existent webhook, got ${invalidWhRes.status}`);
  }
  console.log("✓ Invalid webhook correctly rejected with HTTP 410 Gone.");

  const malformedRes = await makeRequest("POST", `/api/webhook/${webhookId}`, "not a json object");
  if (malformedRes.status !== 400) {
    throw new Error(`Expected HTTP 400 Bad Request for malformed body, got ${malformedRes.status}`);
  }
  console.log("✓ Malformed body correctly rejected with HTTP 400 Bad Request.");

  console.log("\n============================================================");
  console.log("ALL OFFICIAL IOS COMPANION WEBHOOK TESTS PASSED! 🎉");
  console.log("============================================================\n");
}

runIosCompanionEndToEndWebhookSuite().catch((err) => {
  console.error("iOS Companion Webhook Suite Error:", err);
  process.exit(1);
});
