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

async function runIosSensorRegistrationTestSuite() {
  console.log("============================================================");
  console.log("RUNNING IOS & IDEMPOTENT SENSOR REGISTRATION REGRESSION SUITE");
  console.log("============================================================");

  const ts = Date.now();
  const username = `ios_user_${ts}`;
  const password = "Password123!";

  // 1. Register a test user
  console.log("1. Registering test user for iOS Companion App test...");
  const reg = await makeRequest("POST", "/api/auth/register", {
    username,
    display_name: "iOS Test User",
    password
  });
  if (reg.status !== 200 || !reg.data.access_token) {
    throw new Error(`Registration failed: ${JSON.stringify(reg.data)}`);
  }
  const token = reg.data.access_token;
  console.log("✓ User registered successfully.");

  // 2. Perform iOS Device Registration (POST /api/mobile_app/registrations)
  console.log("\n2. Testing fresh iOS Device Registration (POST /api/mobile_app/registrations)...");
  const iosDeviceId = `iOS_Device_${ts}_UUID`;
  const iosRegistrationPayload = {
    device_id: iosDeviceId,
    app_id: "io.robertharding.ha",
    app_name: "Home Assistant",
    app_version: "2024.1",
    device_name: "iPhone 15 Pro",
    manufacturer: "Apple",
    model: "iPhone15,2",
    os_name: "iOS",
    os_version: "17.4",
    supports_encryption: false,
    app_data: { push_token: "mock_ios_push_token_123" }
  };

  const deviceRegRes = await makeRequest("POST", "/api/mobile_app/registrations", iosRegistrationPayload, token);
  if (deviceRegRes.status !== 201 || !deviceRegRes.data.webhook_id) {
    throw new Error(`iOS device registration failed: ${JSON.stringify(deviceRegRes.data)}`);
  }
  const webhookId1 = deviceRegRes.data.webhook_id;
  console.log(`✓ iOS device registration succeeded. Webhook ID 1: ${webhookId1}`);

  // 3. Register initial batch of iOS sensors via Webhook
  console.log("\n3. Registering initial iOS sensors via Webhook...");
  const sensorBatteryLevel = {
    type: "register_sensor",
    data: {
      name: "Battery Level",
      unique_id: `ios_battery_level_${ts}`,
      type: "sensor",
      state: 88,
      unit_of_measurement: "%",
      icon: "mdi:battery-80",
      device_class: "battery",
      state_class: "measurement"
    }
  };

  const sensorBatteryState = {
    type: "register_sensor",
    data: {
      name: "Battery State",
      unique_id: `ios_battery_state_${ts}`,
      type: "sensor",
      state: "Charging",
      icon: "mdi:battery-charging",
      device_class: "battery"
    }
  };

  const resSens1 = await makeRequest("POST", `/api/webhook/${webhookId1}`, sensorBatteryLevel);
  if (resSens1.status !== 201 && resSens1.status !== 200) {
    throw new Error(`First sensor registration failed: status ${resSens1.status}, data: ${JSON.stringify(resSens1.data)}`);
  }
  console.log("✓ First sensor ('Battery Level') registration succeeded (HTTP 201/200).");

  const resSens2 = await makeRequest("POST", `/api/webhook/${webhookId1}`, sensorBatteryState);
  if (resSens2.status !== 201 && resSens2.status !== 200) {
    throw new Error(`Second sensor registration failed: status ${resSens2.status}, data: ${JSON.stringify(resSens2.data)}`);
  }
  console.log("✓ Second sensor ('Battery State') registration succeeded.");

  // 4. Test REPEATED registration of the exact same sensor (duplicate unique_id)
  console.log("\n4. Testing duplicate sensor registration with exact same unique_id...");
  const duplicateSensorPayload = {
    type: "register_sensor",
    data: {
      name: "Battery Level",
      unique_id: `ios_battery_level_${ts}`,
      type: "sensor",
      state: 85,
      unit_of_measurement: "%",
      icon: "mdi:battery-80",
      device_class: "battery",
      state_class: "measurement"
    }
  };

  const resDup = await makeRequest("POST", `/api/webhook/${webhookId1}`, duplicateSensorPayload);
  if (resDup.status !== 201 && resDup.status !== 200) {
    throw new Error(`Duplicate sensor registration returned error status ${resDup.status}: ${JSON.stringify(resDup.data)}`);
  }
  if (resDup.data.detail && resDup.data.detail.includes("UNIQUE constraint failed")) {
    throw new Error(`UNIQUE constraint error occurred on duplicate sensor registration!`);
  }
  console.log("✓ Duplicate sensor registration succeeded without HTTP 400 or UNIQUE constraint error.");

  // 5. Test UPDATING metadata on existing sensor unique_id
  console.log("\n5. Testing sensor metadata update on duplicate unique_id...");
  const updatedSensorPayload = {
    type: "register_sensor",
    data: {
      name: "iPhone Battery Level (Updated)",
      unique_id: `ios_battery_level_${ts}`,
      type: "sensor",
      state: 92,
      unit_of_measurement: "%",
      icon: "mdi:battery-90",
      device_class: "battery",
      state_class: "measurement"
    }
  };

  const resUpdate = await makeRequest("POST", `/api/webhook/${webhookId1}`, updatedSensorPayload);
  if (resUpdate.status !== 201 && resUpdate.status !== 200) {
    throw new Error(`Sensor metadata update returned status ${resUpdate.status}: ${JSON.stringify(resUpdate.data)}`);
  }
  console.log("✓ Sensor metadata update succeeded.");

  // 6. Test re-registration of the iOS app (e.g. app reinstall or re-login issuing new webhook_id)
  console.log("\n6. Testing iOS app re-registration and re-submitting sensors under updated registration...");
  const deviceReRegRes = await makeRequest("POST", "/api/mobile_app/registrations", iosRegistrationPayload, token);
  if (deviceReRegRes.status !== 201 || !deviceReRegRes.data.webhook_id) {
    throw new Error(`iOS device re-registration failed: ${JSON.stringify(deviceReRegRes.data)}`);
  }
  const webhookId2 = deviceReRegRes.data.webhook_id;
  console.log(`✓ iOS device re-registration succeeded. Webhook ID 2: ${webhookId2}`);

  const resReRegSensor = await makeRequest("POST", `/api/webhook/${webhookId2}`, updatedSensorPayload);
  if (resReRegSensor.status !== 201 && resReRegSensor.status !== 200) {
    throw new Error(`Sensor registration under new webhook ID failed: status ${resReRegSensor.status}, data: ${JSON.stringify(resReRegSensor.data)}`);
  }
  console.log("✓ Sensor registration under re-registered device succeeded cleanly.");

  // 7. Verify sensor state updates continue to work seamlessly
  console.log("\n7. Testing update_sensor_states after idempotent registration...");
  const sensorStateUpdate = {
    type: "update_sensor_states",
    data: [
      {
        unique_id: `ios_battery_level_${ts}`,
        state: 95,
        attributes: { battery_low: false }
      }
    ]
  };

  const resStateUpdate = await makeRequest("POST", `/api/webhook/${webhookId2}`, sensorStateUpdate);
  if (resStateUpdate.status !== 200 || !resStateUpdate.data[`ios_battery_level_${ts}`]?.success) {
    throw new Error(`update_sensor_states failed: status ${resStateUpdate.status}, data: ${JSON.stringify(resStateUpdate.data)}`);
  }
  console.log("✓ Sensor state update succeeded!");

  console.log("\n============================================================");
  console.log("ALL IOS SENSOR REGISTRATION REGRESSION TESTS PASSED! 🎉");
  console.log("============================================================\n");
}

runIosSensorRegistrationTestSuite().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
