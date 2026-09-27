import WebSocket from "ws";

const BASE_URL = "ws://127.0.0.1:3000/api/websocket";

async function testWebSocketConnection() {
  console.log("Connecting to WebSocket:", BASE_URL);
  
  // First register a test user to get a token
  const registerRes = await fetch("http://127.0.0.1:3000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `ws_test_${Date.now()}`,
      display_name: "WS Test User",
      password: "Password123!"
    })
  });
  const registerData = await registerRes.json();
  const token = registerData.access_token;
  console.log("Acquired token for test user:", registerData.user?.id);

  const ws = new WebSocket(BASE_URL);

  ws.on("open", () => {
    console.log("WebSocket connection opened at:", new Date().toISOString());
  });

  ws.on("message", (data) => {
    console.log(`[${new Date().toISOString()}] Received message:`, data.toString());
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_required") {
        console.log("Sending auth message...");
        ws.send(JSON.stringify({
          type: "auth",
          access_token: token
        }));
      } else if (msg.type === "auth_ok") {
        console.log("Authenticated! Sending subscribe_events...");
        ws.send(JSON.stringify({
          id: 1,
          type: "subscribe_events",
          event_type: "state_changed"
        }));
      }
    } catch (err) {
      console.error("Error parsing message:", err);
    }
  });

  ws.on("ping", (data) => {
    console.log(`[${new Date().toISOString()}] Received WS Ping frame from server`);
  });

  ws.on("pong", (data) => {
    console.log(`[${new Date().toISOString()}] Received WS Pong frame from server`);
  });

  ws.on("close", (code, reason) => {
    console.log(`[${new Date().toISOString()}] WebSocket CLOSED! Code: ${code}, Reason: ${reason.toString()}`);
  });

  ws.on("error", (err) => {
    console.error(`[${new Date().toISOString()}] WebSocket ERROR:`, err);
  });

  // Hold open for 35 seconds
  await new Promise((resolve) => setTimeout(resolve, 35000));
  console.log("Test finished waiting 35 seconds. Closing connection.");
  ws.close();
}

testWebSocketConnection().catch(console.error);
