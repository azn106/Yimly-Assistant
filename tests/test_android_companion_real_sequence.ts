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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAndroidCompanionRealSequenceTest() {
  console.log("================================================================================");
  console.log("REAL ANDROID HOME ASSISTANT COMPANION APP WEBSOCKET END-TO-END SUITE");
  console.log("================================================================================");

  // Clear preview db for clean slate
  try {
    const fs = await import("fs");
    const path = await import("path");
    const dbPath = path.join(process.cwd(), "yimly_store_preview.json");
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  } catch {}

  const runId = Date.now();

  // 1. Register Android User & Device
  console.log("\n[1] Registering Android User & Mobile Companion Device...");
  const userRes = await postJson("/api/auth/register", {
    username: `android_user_${runId}`,
    display_name: "Android Companion User",
    password: "Password123!"
  });
  if (!userRes.data.access_token) {
    throw new Error(`Android User registration failed: ${JSON.stringify(userRes.data)}`);
  }
  const token = userRes.data.access_token;
  const userId = userRes.data.user.id;
  console.log(`  ✓ Android User registered (id=${userId})`);

  const regRes = await postJson("/api/mobile_app/registrations", {
    device_id: "android_pixel_8",
    device_name: "Pixel 8 Pro",
    app_id: "io.homeassistant.companion.android",
    app_name: "Home Assistant",
    app_version: "2026.9.1-full",
    manufacturer: "Google",
    model: "Pixel 8 Pro",
    os_name: "Android",
    os_version: "14",
    supports_encryption: false
  }, token);
  const webhookId = regRes.data.webhook_id;
  console.log(`  ✓ Companion registration complete (webhook_id=${webhookId})`);

  // 2. Open WebSocket Connection
  console.log("\n[2] Opening Android Companion WebSocket connection...");
  const ws = new WebSocket(WS_BASE_URL);
  const rxMessages: any[] = [];
  const pendingRequests = new Map<number, (res: any) => void>();

  let closedCode: number | null = null;
  let closedReason: string | null = null;

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      rxMessages.push(msg);
      if (typeof msg.id === "number" && pendingRequests.has(msg.id)) {
        const resolve = pendingRequests.get(msg.id)!;
        pendingRequests.delete(msg.id);
        resolve(msg);
      }
    } catch {}
  });

  ws.on("close", (code, reason) => {
    closedCode = code;
    closedReason = reason.toString();
  });

  // Wait for auth_required
  await delay(300);
  const authReq = rxMessages.find((m) => m.type === "auth_required");
  if (!authReq) throw new Error("Expected auth_required message");
  console.log("  ✓ Received auth_required");

  // Send auth token
  ws.send(JSON.stringify({ type: "auth", access_token: token }));
  await delay(300);
  const authOk = rxMessages.find((m) => m.type === "auth_ok");
  if (!authOk) throw new Error("Expected auth_ok message");
  console.log("  ✓ Authenticated with auth_ok!");

  // Command Helper
  let cmdSeq = 1;
  const sendCommand = (type: string, payload: any = {}): Promise<any> => {
    const id = cmdSeq++;
    return new Promise((resolve) => {
      pendingRequests.set(id, resolve);
      ws.send(JSON.stringify({ id, type, ...payload }));
    });
  };

  // 3. Execute Full Android Startup Command Lifecycle
  console.log("\n[3] Executing Official Android Companion App Startup Sequence...");

  // Command: user/current
  const currentUserRes = await sendCommand("user/current");
  if (!currentUserRes.success || !currentUserRes.result?.id) {
    throw new Error(`user/current failed: ${JSON.stringify(currentUserRes)}`);
  }
  console.log("  ✓ user/current command succeeded:", currentUserRes.result.name);

  // Command: get_config
  const getConfigRes = await sendCommand("get_config");
  if (!getConfigRes.success) throw new Error("get_config failed");
  console.log("  ✓ get_config command succeeded");

  // Command: config/device_registry/list
  const devRegRes = await sendCommand("config/device_registry/list");
  if (!devRegRes.success) throw new Error("config/device_registry/list failed");
  console.log("  ✓ config/device_registry/list command succeeded");

  // Command: config/entity_registry/list_for_display
  const entDispRes = await sendCommand("config/entity_registry/list_for_display");
  if (!entDispRes.success) throw new Error("config/entity_registry/list_for_display failed");
  console.log("  ✓ config/entity_registry/list_for_display command succeeded");

  // Command: config/area_registry/list
  const areaRes = await sendCommand("config/area_registry/list");
  if (!areaRes.success) throw new Error("config/area_registry/list failed");
  console.log("  ✓ config/area_registry/list command succeeded");

  // Command: config/floor_registry/list
  const floorRes = await sendCommand("config/floor_registry/list");
  if (!floorRes.success) throw new Error("config/floor_registry/list failed");
  console.log("  ✓ config/floor_registry/list command succeeded");

  // Command: config/zone_registry/list
  const zoneRes = await sendCommand("config/zone_registry/list");
  if (!zoneRes.success) throw new Error("config/zone_registry/list failed");
  console.log("  ✓ config/zone_registry/list command succeeded");

  // Command: subscribe_entities
  const subEntRes = await sendCommand("subscribe_entities");
  if (!subEntRes.success) throw new Error("subscribe_entities failed");
  console.log("  ✓ subscribe_entities command succeeded");

  // Command: mobile_app/push_notification_channel
  const pushChanRes = await sendCommand("mobile_app/push_notification_channel");
  if (!pushChanRes.success) throw new Error("push_notification_channel failed");
  console.log("  ✓ mobile_app/push_notification_channel command succeeded");

  // Command: persistent_notification/subscribe
  const notifSubRes = await sendCommand("persistent_notification/subscribe");
  if (!notifSubRes.success) throw new Error("persistent_notification/subscribe failed");
  console.log("  ✓ persistent_notification/subscribe command succeeded");

  console.log("\n[4] Simulating background HTTP location telemetry updates...");
  await postJson(`/api/webhook/${webhookId}`, {
    type: "update_location",
    data: { latitude: 37.7749, longitude: -122.4194, gps_accuracy: 5, battery: 92 }
  });
  await delay(1000);
  console.log("  ✓ Telemetry update sent successfully");

  // 5. Longevity Monitor (120 seconds)
  console.log("\n[5] Monitoring continuous WebSocket connection stability for 120 seconds...");
  const startTime = Date.now();
  for (let i = 1; i <= 12; i++) {
    await delay(10000);
    if (closedCode !== null) {
      throw new Error(`WebSocket unexpectedly closed during longevity monitor at ${Math.round((Date.now() - startTime) / 1000)}s with code ${closedCode}: ${closedReason}`);
    }
    // Ping/pong heartbeat check
    const pingRes = await sendCommand("ping");
    if (pingRes.type !== "pong") {
      throw new Error("Ping command did not receive pong");
    }
    console.log(`  ✓ Longevity check ${i * 10}/120s: Connection healthy & responsive!`);
  }

  console.log("\n================================================================================");
  console.log("REAL ANDROID COMPANION APP WEBSOCKET TEST PASSED SUCCESSFULLY! 🎉");
  console.log("================================================================================");

  ws.close();
}

runAndroidCompanionRealSequenceTest().catch((err) => {
  console.error("\n❌ Real Android Companion test failed:", err);
  process.exit(1);
});
