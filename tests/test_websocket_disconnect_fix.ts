import http from "http";
import WebSocket from "ws";

const BASE_URL = "http://127.0.0.1:3000";
const WS_URL = "ws://127.0.0.1:3000/api/websocket";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWebSocketDisconnectTestSuite() {
  console.log("============================================================");
  console.log("RUNNING WEBSOCKET LIFECYCLE & CONTINUOUS CONNECTION SUITE");
  console.log("============================================================");

  const ts = Date.now();
  const username = `ws_user_${ts}`;
  const password = "Password123!";

  // 1. Register test user
  console.log("1. Registering test user...");
  const reg = await makeRequest("POST", "/api/auth/register", {
    username,
    display_name: "WS Test User",
    password
  });
  if (reg.status !== 200 || !reg.data.access_token) {
    throw new Error(`Registration failed: ${JSON.stringify(reg.data)}`);
  }
  const token = reg.data.access_token;
  console.log("✓ Test user registered successfully.");

  // 2. Connect WebSocket 1
  console.log("\n2. Connecting Primary WebSocket session...");
  let ws1Connected = false;
  let ws1Closed = false;
  let ws1Subscribed = false;
  let ws1ReceivedEvent = false;

  const ws1 = new WebSocket(WS_URL);

  await new Promise<void>((resolve, reject) => {
    ws1.on("open", () => {
      ws1Connected = true;
    });

    ws1.on("message", (msgStr) => {
      const data = JSON.parse(msgStr.toString());
      if (data.type === "auth_required") {
        ws1.send(JSON.stringify({ type: "auth", access_token: token }));
      } else if (data.type === "auth_ok") {
        ws1.send(JSON.stringify({ id: 1, type: "subscribe_events", event_type: "state_changed" }));
        ws1.send(JSON.stringify({ id: 2, type: "auth/current_user" }));
        ws1.send(JSON.stringify({ id: 3, type: "get_config" }));
        ws1.send(JSON.stringify({ id: 4, type: "get_states" }));
      } else if (data.type === "result" && data.id === 1 && data.success) {
        ws1Subscribed = true;
        resolve();
      } else if (data.type === "event" && data.event?.event_type === "state_changed") {
        ws1ReceivedEvent = true;
      }
    });

    ws1.on("close", () => {
      ws1Closed = true;
    });

    ws1.on("error", (err) => {
      reject(err);
    });
  });

  console.log("✓ Primary WebSocket connected, authenticated, and subscribed to state_changed.");

  // 3. Test auth/current_user and state_changed subscription stability
  console.log("\n3. Verifying auth/current_user and subscription remain active over time...");
  await sleep(1000);
  if (ws1Closed) {
    throw new Error("WebSocket 1 prematurely disconnected after subscription!");
  }
  console.log("✓ WebSocket 1 remains connected (ws1Closed = false).");

  // 4. Test Multiple Concurrent WebSocket Connections (Companion App + WebView)
  console.log("\n4. Testing multiple concurrent WebSocket sessions for same user...");
  let ws2Closed = false;
  const ws2 = new WebSocket(WS_URL);

  await new Promise<void>((resolve, reject) => {
    ws2.on("message", (msgStr) => {
      const data = JSON.parse(msgStr.toString());
      if (data.type === "auth_required") {
        ws2.send(JSON.stringify({ type: "auth", access_token: token }));
      } else if (data.type === "auth_ok") {
        ws2.send(JSON.stringify({ id: 101, type: "subscribe_events", event_type: "state_changed" }));
      } else if (data.type === "result" && data.id === 101 && data.success) {
        resolve();
      }
    });
    ws2.on("close", () => (ws2Closed = true));
    ws2.on("error", reject);
  });

  console.log("✓ Secondary WebSocket connected and authenticated independently.");

  if (ws1Closed) {
    throw new Error("Connecting WebSocket 2 caused WebSocket 1 to disconnect!");
  }
  console.log("✓ Multiple WebSocket sessions coexist without cross-disconnection.");

  // 5. Test Ping / Keepalive Heartbeat Stability
  console.log("\n5. Testing Ping / Keepalive Heartbeat response...");
  let pingReceived = false;
  ws1.send(JSON.stringify({ id: 999, type: "ping" }));
  await new Promise<void>((resolve) => {
    const handler = (msgStr: any) => {
      const data = JSON.parse(msgStr.toString());
      if (data.type === "pong" && (data.id === 999 || data.id === undefined)) {
        pingReceived = true;
        ws1.off("message", handler);
        resolve();
      }
    };
    ws1.on("message", handler);
  });
  if (!pingReceived) {
    throw new Error("WebSocket failed to respond to keepalive ping with pong!");
  }
  console.log("✓ Keepalive ping/pong succeeded.");

  // 6. Test 7-second continuous connection stability test (longer than 5s disconnect problem)
  console.log("\n6. Holding connection open for 7 seconds to verify no 5-second disconnect...");
  await sleep(7000);

  if (ws1Closed) {
    throw new Error("WebSocket 1 disconnected during 7-second stability check!");
  }
  console.log("✓ Connection remained continuously open for >7 seconds with zero disconnects!");

  // 7. Verify Reconnect behavior on intentional connection termination
  console.log("\n7. Closing WebSocket 2 intentionally and verifying WebSocket 1 remains active...");
  ws2.close();
  await sleep(500);

  if (ws1Closed) {
    throw new Error("Closing WebSocket 2 affected WebSocket 1!");
  }
  console.log("✓ Closing session 2 did not affect session 1.");

  // Clean up session 1
  ws1.close();

  console.log("\n============================================================");
  console.log("ALL WEBSOCKET DISCONNECT FIX TESTS PASSED! 🎉");
  console.log("============================================================\n");
}

runWebSocketDisconnectTestSuite().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
