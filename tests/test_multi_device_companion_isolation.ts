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

async function runMultiDeviceCompanionIsolationTests() {
  console.log("============================================================");
  console.log("RUNNING MULTI-DEVICE COMPANION SENSOR & ENTITY ISOLATION TEST");
  console.log("============================================================");

  const ts = Date.now();

  // 1. Create User 1 and User 2
  console.log("\n1. Registering User 1 and User 2...");
  const u1Res = await makeRequest("POST", "/api/auth/register", {
    username: `user_alpha_${ts}`,
    display_name: "User Alpha",
    password: "Password123!"
  });
  if (u1Res.status !== 200 || !u1Res.data.access_token) {
    throw new Error(`Failed to create User 1: ${JSON.stringify(u1Res.data)}`);
  }
  const token1 = u1Res.data.access_token;

  const u2Res = await makeRequest("POST", "/api/auth/register", {
    username: `user_beta_${ts}`,
    display_name: "User Beta",
    password: "Password123!"
  });
  if (u2Res.status !== 200 || !u2Res.data.access_token) {
    throw new Error(`Failed to create User 2: ${JSON.stringify(u2Res.data)}`);
  }
  const token2 = u2Res.data.access_token;
  console.log("✓ User 1 and User 2 registered successfully.");

  // 2. Register Device 1 (User 1 - iPhone), Device 2 (User 1 - Android), Device 3 (User 2 - iPhone with identical name!)
  console.log("\n2. Registering multiple Companion devices across users and platforms...");
  
  // Device 1: User 1's iPhone
  const d1Res = await makeRequest("POST", "/api/mobile_app/registrations", {
    device_id: `dev_iphone_${ts}`,
    app_id: "io.robertharding.ha",
    app_name: "Home Assistant",
    app_version: "2024.1",
    device_name: "iPhone 15 Pro",
    manufacturer: "Apple",
    model: "iPhone15,2",
    os_name: "iOS",
    os_version: "17.4",
    supports_encryption: false
  }, token1);
  if (d1Res.status !== 201 || !d1Res.data.webhook_id) {
    throw new Error(`Failed to register Device 1: ${JSON.stringify(d1Res.data)}`);
  }
  const wh1 = d1Res.data.webhook_id;

  // Device 2: User 1's Android
  const d2Res = await makeRequest("POST", "/api/mobile_app/registrations", {
    device_id: `dev_galaxy_${ts}`,
    app_id: "io.homeassistant.companion.android",
    app_name: "Home Assistant",
    app_version: "2024.1",
    device_name: "Galaxy S24 Ultra",
    manufacturer: "Samsung",
    model: "SM-S928B",
    os_name: "Android",
    os_version: "14",
    supports_encryption: false
  }, token1);
  if (d2Res.status !== 201 || !d2Res.data.webhook_id) {
    throw new Error(`Failed to register Device 2: ${JSON.stringify(d2Res.data)}`);
  }
  const wh2 = d2Res.data.webhook_id;

  // Device 3: User 2's iPhone (Identically named "iPhone 15 Pro")
  const d3Res = await makeRequest("POST", "/api/mobile_app/registrations", {
    device_id: `dev_user2_iphone_${ts}`,
    app_id: "io.robertharding.ha",
    app_name: "Home Assistant",
    app_version: "2024.1",
    device_name: "iPhone 15 Pro",
    manufacturer: "Apple",
    model: "iPhone15,2",
    os_name: "iOS",
    os_version: "17.4",
    supports_encryption: false
  }, token2);
  if (d3Res.status !== 201 || !d3Res.data.webhook_id) {
    throw new Error(`Failed to register Device 3: ${JSON.stringify(d3Res.data)}`);
  }
  const wh3 = d3Res.data.webhook_id;

  console.log(`✓ Devices registered:\n  Device 1 (U1 iOS) Webhook: ${wh1}\n  Device 2 (U1 Android) Webhook: ${wh2}\n  Device 3 (U2 iOS Identical Name) Webhook: ${wh3}`);

  // 3. Register static sensor 'battery_level' on all three devices simultaneously
  console.log("\n3. Registering STATIC sensor 'battery_level' (exact same unique_id string) across all 3 devices...");
  
  // D1 sends battery_level = 95
  const s1 = await makeRequest("POST", `/api/webhook/${wh1}`, {
    type: "register_sensor",
    data: {
      name: "Battery Level",
      unique_id: "battery_level",
      type: "sensor",
      state: 95,
      unit_of_measurement: "%",
      device_class: "battery",
      state_class: "measurement"
    }
  });
  if (s1.status !== 201 && s1.status !== 200) {
    throw new Error(`Device 1 register_sensor failed: ${JSON.stringify(s1.data)}`);
  }

  // D2 sends battery_level = 42
  const s2 = await makeRequest("POST", `/api/webhook/${wh2}`, {
    type: "register_sensor",
    data: {
      name: "Battery Level",
      unique_id: "battery_level",
      type: "sensor",
      state: 42,
      unit_of_measurement: "%",
      device_class: "battery",
      state_class: "measurement"
    }
  });
  if (s2.status !== 201 && s2.status !== 200) {
    throw new Error(`Device 2 register_sensor failed: ${JSON.stringify(s2.data)}`);
  }

  // D3 sends battery_level = 78
  const s3 = await makeRequest("POST", `/api/webhook/${wh3}`, {
    type: "register_sensor",
    data: {
      name: "Battery Level",
      unique_id: "battery_level",
      type: "sensor",
      state: 78,
      unit_of_measurement: "%",
      device_class: "battery",
      state_class: "measurement"
    }
  });
  if (s3.status !== 201 && s3.status !== 200) {
    throw new Error(`Device 3 register_sensor failed: ${JSON.stringify(s3.data)}`);
  }

  console.log("✓ All 3 devices successfully registered static sensor 'battery_level' without collision or HTTP 400!");

  // 4. Verify states in User 1 and User 2 state registry
  console.log("\n4. Verifying state engine entity isolation...");
  const u1States = await makeRequest("GET", "/api/states", undefined, token1);
  const u2States = await makeRequest("GET", "/api/states", undefined, token2);

  const u1BatteryEntities = u1States.data.filter((e: any) => e.entity_id.includes("battery_level"));
  const u2BatteryEntities = u2States.data.filter((e: any) => e.entity_id.includes("battery_level"));

  console.log("User 1 battery entities:", u1BatteryEntities.map((e: any) => ({ entity_id: e.entity_id, state: e.state })));
  console.log("User 2 battery entities:", u2BatteryEntities.map((e: any) => ({ entity_id: e.entity_id, state: e.state })));

  if (u1BatteryEntities.length !== 2) {
    throw new Error(`Expected User 1 to have 2 distinct battery entities, got ${u1BatteryEntities.length}`);
  }
  if (u2BatteryEntities.length !== 1) {
    throw new Error(`Expected User 2 to have 1 battery entity, got ${u2BatteryEntities.length}`);
  }

  // Check state values
  const d1Entity = u1BatteryEntities.find((e: any) => e.state === "95");
  const d2Entity = u1BatteryEntities.find((e: any) => e.state === "42");
  const d3Entity = u2BatteryEntities.find((e: any) => e.state === "78");

  if (!d1Entity) {
    throw new Error(`Device 1 state mismatch. Could not find entity with state 95`);
  }
  if (!d2Entity) {
    throw new Error(`Device 2 state mismatch. Could not find entity with state 42`);
  }
  if (!d3Entity) {
    throw new Error(`Device 3 state mismatch. Could not find entity with state 78`);
  }
  if (d1Entity.entity_id === d2Entity.entity_id || d1Entity.entity_id === d3Entity.entity_id || d2Entity.entity_id === d3Entity.entity_id) {
    throw new Error(`Entity IDs collided across devices! D1: ${d1Entity.entity_id}, D2: ${d2Entity.entity_id}, D3: ${d3Entity.entity_id}`);
  }
  console.log(`✓ Entity IDs and states are perfectly isolated across devices and users!\n  D1 Entity: ${d1Entity.entity_id} (${d1Entity.state}%)\n  D2 Entity: ${d2Entity.entity_id} (${d2Entity.state}%)\n  D3 Entity: ${d3Entity.entity_id} (${d3Entity.state}%)`);

  // 5. Test update_sensor_states targeting the same unique_id on different devices
  console.log("\n5. Testing update_sensor_states with static unique_id 'battery_level' on each device...");
  
  // Update D1 to 94%
  const uRes1 = await makeRequest("POST", `/api/webhook/${wh1}`, {
    type: "update_sensor_states",
    data: [{ unique_id: "battery_level", state: 94 }]
  });
  if (uRes1.status !== 200 || !uRes1.data.battery_level?.success) {
    throw new Error(`D1 update_sensor_states failed: ${JSON.stringify(uRes1.data)}`);
  }

  // Update D2 to 41%
  const uRes2 = await makeRequest("POST", `/api/webhook/${wh2}`, {
    type: "update_sensor_states",
    data: [{ unique_id: "battery_level", state: 41 }]
  });
  if (uRes2.status !== 200 || !uRes2.data.battery_level?.success) {
    throw new Error(`D2 update_sensor_states failed: ${JSON.stringify(uRes2.data)}`);
  }

  // Update D3 to 77%
  const uRes3 = await makeRequest("POST", `/api/webhook/${wh3}`, {
    type: "update_sensor_states",
    data: [{ unique_id: "battery_level", state: 77 }]
  });
  if (uRes3.status !== 200 || !uRes3.data.battery_level?.success) {
    throw new Error(`D3 update_sensor_states failed: ${JSON.stringify(uRes3.data)}`);
  }

  // Verify all 3 entities updated independently
  const checkStates1 = await makeRequest("GET", "/api/states", undefined, token1);
  const checkStates2 = await makeRequest("GET", "/api/states", undefined, token2);

  const d1Updated = checkStates1.data.find((e: any) => e.entity_id === d1Entity.entity_id);
  const d2Updated = checkStates1.data.find((e: any) => e.entity_id === d2Entity.entity_id);
  const d3Updated = checkStates2.data.find((e: any) => e.entity_id === d3Entity.entity_id);

  if (d1Updated?.state !== "94" || d2Updated?.state !== "41" || d3Updated?.state !== "77") {
    throw new Error(`State update cross-talk detected! D1: ${d1Updated?.state}, D2: ${d2Updated?.state}, D3: ${d3Updated?.state}`);
  }
  console.log("✓ State updates cleanly routed to respective device entities without cross-talk!");

  // 6. Test all production failure sensor names concurrently across multiple devices
  console.log("\n6. Testing all exact production failure sensor names across multiple devices...");
  const prodSensors = [
    { name: "Proximity sensor", unique_id: "proximity_sensor", type: "sensor", state: 5.0 },
    { name: "Steps sensor", unique_id: "steps_sensor", type: "sensor", state: 6420 },
    { name: "Internal storage", unique_id: "internal_storage", type: "sensor", state: "128 GB" },
    { name: "External storage", unique_id: "external_storage", type: "sensor", state: "unavailable" },
    { name: "Current time zone", unique_id: "current_time_zone", type: "sensor", state: "America/New_York" },
    { name: "Mobile RX GB", unique_id: "mobile_rx_gb", type: "sensor", state: 1.45 },
    { name: "Mobile TX GB", unique_id: "mobile_tx_gb", type: "sensor", state: 0.82 },
    { name: "Total RX GB", unique_id: "total_rx_gb", type: "sensor", state: 12.3 },
    { name: "Total TX GB", unique_id: "total_tx_gb", type: "sensor", state: 4.5 }
  ];

  for (const s of prodSensors) {
    const rD1 = await makeRequest("POST", `/api/webhook/${wh1}`, { type: "register_sensor", data: s });
    const rD2 = await makeRequest("POST", `/api/webhook/${wh2}`, { type: "register_sensor", data: s });
    const rD3 = await makeRequest("POST", `/api/webhook/${wh3}`, { type: "register_sensor", data: s });

    if ((rD1.status !== 201 && rD1.status !== 200) || (rD2.status !== 201 && rD2.status !== 200) || (rD3.status !== 201 && rD3.status !== 200)) {
      throw new Error(`Production sensor registration failed for ${s.name}: D1=${rD1.status}, D2=${rD2.status}, D3=${rD3.status}`);
    }
  }
  console.log("✓ All 9 production sensors registered simultaneously across all devices with 100% success!");

  // 7. Test location reporting and device_tracker entity disambiguation
  console.log("\n7. Testing location updates and device_tracker entity disambiguation...");
  await makeRequest("POST", `/api/webhook/${wh1}`, {
    type: "update_location",
    data: { gps: [37.7749, -122.4194], gps_accuracy: 5.0, battery: 90 }
  });
  await makeRequest("POST", `/api/webhook/${wh2}`, {
    type: "update_location",
    data: { gps: [40.7128, -74.0060], gps_accuracy: 10.0, battery: 40 }
  });
  await makeRequest("POST", `/api/webhook/${wh3}`, {
    type: "update_location",
    data: { gps: [51.5074, -0.1278], gps_accuracy: 8.0, battery: 75 }
  });

  const finalStates1 = await makeRequest("GET", "/api/states", undefined, token1);
  const finalStates2 = await makeRequest("GET", "/api/states", undefined, token2);

  const u1Trackers = finalStates1.data.filter((e: any) => e.domain === "device_tracker");
  const u2Trackers = finalStates2.data.filter((e: any) => e.domain === "device_tracker");

  console.log("User 1 trackers:", u1Trackers.map((t: any) => ({ entity_id: t.entity_id, lat: t.latitude, lon: t.longitude })));
  console.log("User 2 trackers:", u2Trackers.map((t: any) => ({ entity_id: t.entity_id, lat: t.latitude, lon: t.longitude })));

  if (u1Trackers.length !== 2 || u2Trackers.length !== 1) {
    throw new Error(`Unexpected number of device_trackers: U1=${u1Trackers.length}, U2=${u2Trackers.length}`);
  }
  const u1IphoneTracker = u1Trackers.find((t: any) => t.entity_id.startsWith("device_tracker.iphone_15_pro"));
  const u2IphoneTracker = u2Trackers[0];
  if (!u1IphoneTracker || !u2IphoneTracker || u1IphoneTracker.entity_id === u2IphoneTracker.entity_id) {
    throw new Error(`Trackers between identical device names collided! U1: ${u1IphoneTracker?.entity_id}, U2: ${u2IphoneTracker?.entity_id}`);
  }
  console.log(`✓ Location tracking and device_tracker entities successfully disambiguated:\n  U1 Tracker: ${u1IphoneTracker.entity_id}\n  U2 Tracker: ${u2IphoneTracker.entity_id}`);

  console.log("\n============================================================");
  console.log("ALL MULTI-DEVICE COMPANION ISOLATION TESTS PASSED! 🎉");
  console.log("============================================================\n");
}

runMultiDeviceCompanionIsolationTests().catch((err) => {
  console.error("Multi-Device Companion Isolation Test Error:", err);
  process.exit(1);
});
