import http from "http";

const BASE_URL = "http://127.0.0.1:3000";

async function makeRequest(
  method: string,
  pathStr: string,
  body?: any,
  token?: string,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const url = new URL(pathStr, BASE_URL);
    const headers: Record<string, string> = {
      ...extraHeaders
    };
    if (body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const req = http.request(
      url,
      {
        method,
        headers
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode || 500, data: parsed, headers: res.headers });
        });
      }
    );

    req.on("error", reject);
    if (body) {
      if (typeof body === "string") {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

async function runAndroidBatterySyncTestSuite() {
  console.log("Starting Focused Android Battery Sync and Charging Status Test Suite...\n");

  const testId = Date.now();
  const username = `battery_user_${testId}`;
  const password = "Password123!";

  // 1. Setup/Register a real Yimly User
  console.log("1. Registering real Yimly user...");
  const regRes = await makeRequest("POST", "/api/auth/register", {
    username,
    password,
    display_name: "Battery Test User"
  });
  if (regRes.status !== 200 && regRes.status !== 201) {
    throw new Error(`Failed to register user: ${JSON.stringify(regRes.data)}`);
  }
  console.log(`✓ User '${username}' registered.`);

  // 2. Authenticate user to obtain token
  console.log("\n2. Authenticating user to obtain token...");
  const loginRes = await makeRequest("POST", "/api/auth/login", {
    username,
    password
  });
  if (loginRes.status !== 200) {
    throw new Error(`Authentication failed: ${JSON.stringify(loginRes.data)}`);
  }
  const accessToken = loginRes.data.access_token;
  console.log("✓ Authenticated and obtained Bearer access token.");

  // 3. Register a Mobile Device
  console.log("\n3. Registering Android Companion device...");
  const registrationPayload = {
    device_id: `batt_dev_${testId}`,
    app_id: "io.homeassistant.companion.android",
    app_name: "Home Assistant",
    app_version: "2024.1.0",
    device_name: "Pixel 9 Pro XL",
    manufacturer: "Google",
    model: "Pixel 9 Pro XL",
    os_name: "Android",
    os_version: "14",
    supports_encryption: false,
    app_data: {}
  };
  const regAppRes = await makeRequest(
    "POST",
    "/api/mobile_app/registrations",
    registrationPayload,
    accessToken
  );
  if (regAppRes.status !== 200 && regAppRes.status !== 201) {
    throw new Error(`Registration failed: ${JSON.stringify(regAppRes.data)}`);
  }
  const webhookId = regAppRes.data.webhook_id;
  console.log(`✓ Android Companion device registered. Webhook ID: ${webhookId}`);

  // 4. Send initial location update to establish device_tracker state record in DB
  console.log("\n4. Sending location update to initialize device_tracker state...");
  const locPayload = {
    type: "update_location",
    data: {
      latitude: 37.7749,
      longitude: -122.4194,
      gps_accuracy: 10,
      battery: 100, // Starting at 100%
      trigger: "background"
    }
  };
  const locRes = await makeRequest("POST", `/api/webhook/${webhookId}`, locPayload);
  if (locRes.status !== 200) {
    throw new Error(`Location update failed: ${JSON.stringify(locRes.data)}`);
  }
  console.log("✓ Initial location update succeeded.");

  // Verify initial state attributes
  console.log("\n5. Verifying initial device_tracker attributes in database...");
  const stateRes = await makeRequest("GET", `/api/states/device_tracker.pixel_9_pro_xl`, undefined, accessToken);
  console.log("DEBUG stateRes status:", stateRes.status);
  console.log("DEBUG stateRes data:", JSON.stringify(stateRes.data));

  if (stateRes.status !== 200) {
    throw new Error(`Failed to retrieve state: ${JSON.stringify(stateRes.data)}`);
  }
  const initialTrackerState = stateRes.data;
  console.log(`✓ Stored tracker battery level: ${initialTrackerState.attributes.battery_level}%`);
  console.log(`✓ Stored tracker battery alias: ${initialTrackerState.attributes.battery}%`);
  if (initialTrackerState.attributes.battery !== 100 || initialTrackerState.attributes.battery_level !== 100) {
    throw new Error("Initial battery percentage is not 100%");
  }

  // 6. Register battery level & state sensors
  console.log("\n6. Registering battery_level and battery_state sensors...");
  const registerLevelRes = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "register_sensor",
    data: {
      unique_id: "battery_level",
      name: "Battery Level",
      type: "sensor",
      unit_of_measurement: "%",
      icon: "mdi:battery",
      device_class: "battery"
    }
  });
  if (registerLevelRes.status !== 200 && registerLevelRes.status !== 201) {
    throw new Error(`Failed to register battery_level sensor: ${JSON.stringify(registerLevelRes.data)}`);
  }

  const registerStateRes = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "register_sensor",
    data: {
      unique_id: "battery_state",
      name: "Battery State",
      type: "sensor",
      icon: "mdi:battery-charging",
      device_class: "battery_state"
    }
  });
  if (registerStateRes.status !== 200 && registerStateRes.status !== 201) {
    throw new Error(`Failed to register battery_state sensor: ${JSON.stringify(registerStateRes.data)}`);
  }
  console.log("✓ Battery sensors registered successfully.");

  // 7. Test pushing 50% battery level sensor update
  console.log("\n7. Simulating Android Companion 50% battery level sensor state update...");
  const sensorUpdateRes1 = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "update_sensor_states",
    data: [
      {
        unique_id: "battery_level",
        state: "50",
        attributes: {}
      }
    ]
  });
  if (sensorUpdateRes1.status !== 200) {
    throw new Error(`Sensor state update failed: ${JSON.stringify(sensorUpdateRes1.data)}`);
  }

  // Verify state synchronized down to the device_tracker entity state
  const trackerRes1 = await makeRequest("GET", `/api/states/device_tracker.pixel_9_pro_xl`, undefined, accessToken);
  if (trackerRes1.status !== 200) {
    throw new Error(`Failed to retrieve device tracker state: ${JSON.stringify(trackerRes1.data)}`);
  }
  console.log(`✓ Synchronized tracker battery level: ${trackerRes1.data.attributes.battery_level}%`);
  console.log(`✓ Synchronized tracker battery alias: ${trackerRes1.data.attributes.battery}%`);
  if (trackerRes1.data.attributes.battery !== 50 || trackerRes1.data.attributes.battery_level !== 50) {
    throw new Error("Device tracker battery attribute was not updated/synchronized to 50%!");
  }

  // 8. Test pushing charging state update
  console.log("\n8. Simulating Android Companion charging state sensor update...");
  const sensorUpdateRes2 = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "update_sensor_states",
    data: [
      {
        unique_id: "battery_state",
        state: "charging",
        attributes: {}
      }
    ]
  });
  if (sensorUpdateRes2.status !== 200) {
    throw new Error(`Sensor state update failed: ${JSON.stringify(sensorUpdateRes2.data)}`);
  }

  // Verify charging attributes on the device_tracker entity
  const trackerRes2 = await makeRequest("GET", `/api/states/device_tracker.pixel_9_pro_xl`, undefined, accessToken);
  if (trackerRes2.status !== 200) {
    throw new Error(`Failed to retrieve state: ${JSON.stringify(trackerRes2.data)}`);
  }
  console.log(`✓ Stored tracker battery_state: "${trackerRes2.data.attributes.battery_state}"`);
  console.log(`✓ Stored tracker battery_status: "${trackerRes2.data.attributes.battery_status}"`);
  console.log(`✓ Stored tracker charging status: ${trackerRes2.data.attributes.charging}`);
  if (
    trackerRes2.data.attributes.battery_state !== "charging" ||
    trackerRes2.data.attributes.battery_status !== "charging" ||
    trackerRes2.data.attributes.charging !== true
  ) {
    throw new Error("Device tracker charging attributes were not synchronized correctly!");
  }

  // 9. Test pushing discharging state update
  console.log("\n9. Simulating Android Companion discharging state sensor update...");
  const sensorUpdateRes3 = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "update_sensor_states",
    data: [
      {
        unique_id: "battery_state",
        state: "discharging",
        attributes: {}
      }
    ]
  });
  if (sensorUpdateRes3.status !== 200) {
    throw new Error(`Sensor state update failed: ${JSON.stringify(sensorUpdateRes3.data)}`);
  }

  // Verify discharging attributes on the device_tracker entity
  const trackerRes3 = await makeRequest("GET", `/api/states/device_tracker.pixel_9_pro_xl`, undefined, accessToken);
  if (trackerRes3.status !== 200) {
    throw new Error(`Failed to retrieve state: ${JSON.stringify(trackerRes3.data)}`);
  }
  console.log(`✓ Stored tracker charging status: ${trackerRes3.data.attributes.charging}`);
  if (trackerRes3.data.attributes.charging !== false) {
    throw new Error("Device tracker charging status did not transition to false!");
  }

  // 10. Test pushing low battery percentage alert trigger
  console.log("\n10. Simulating Android Companion low battery alert level (12%)...");
  const sensorUpdateRes4 = await makeRequest("POST", `/api/webhook/${webhookId}`, {
    type: "update_sensor_states",
    data: [
      {
        unique_id: "battery_level",
        state: "12",
        attributes: {}
      }
    ]
  });
  if (sensorUpdateRes4.status !== 200) {
    throw new Error(`Sensor state update failed: ${JSON.stringify(sensorUpdateRes4.data)}`);
  }

  // Verify low battery level is correctly saved
  const trackerRes4 = await makeRequest("GET", `/api/states/device_tracker.pixel_9_pro_xl`, undefined, accessToken);
  if (trackerRes4.status !== 200) {
    throw new Error(`Failed to retrieve state: ${JSON.stringify(trackerRes4.data)}`);
  }
  console.log(`✓ Stored tracker low battery level: ${trackerRes4.data.attributes.battery_level}%`);
  if (trackerRes4.data.attributes.battery !== 12 || trackerRes4.data.attributes.battery_level !== 12) {
    throw new Error("Device tracker battery level did not update to 12%!");
  }

  console.log("\n============================================================\n");
  console.log("ALL FOCUSED ANDROID BATTERY SYNC TESTS PASSED SUCCESSFULLY! 🎉");
  console.log("\n============================================================\n");
}

runAndroidBatterySyncTestSuite().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
