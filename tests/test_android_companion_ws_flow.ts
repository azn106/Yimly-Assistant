import WebSocket from "ws";

const BASE_URL = "ws://127.0.0.1:3000/api/websocket";

async function testAndroidCompanionWsFlow() {
  console.log("Starting Android Companion WS Flow Test...");

  const registerRes = await fetch("http://127.0.0.1:3000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `android_ws_${Date.now()}`,
      display_name: "Android WS User",
      password: "Password123!"
    })
  });
  const registerData = await registerRes.json();
  const token = registerData.access_token;

  const ws = new WebSocket(BASE_URL);

  ws.on("open", () => {
    console.log("WebSocket opened.");
  });

  ws.on("message", (data) => {
    console.log("Received:", data.toString());
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: token }));
      } else if (msg.type === "auth_ok") {
        console.log("Auth OK. Sending Android Companion startup commands sequence...");
        
        // Command 1: subscribe_events
        ws.send(JSON.stringify({ id: 1, type: "subscribe_events", event_type: "state_changed" }));
        
        // Command 2: auth/current_user
        ws.send(JSON.stringify({ id: 2, type: "auth/current_user" }));

        // Command 3: get_config
        ws.send(JSON.stringify({ id: 3, type: "get_config" }));

        // Command 4: get_states
        ws.send(JSON.stringify({ id: 4, type: "get_states" }));

        // Command 5: get_services
        ws.send(JSON.stringify({ id: 5, type: "get_services" }));

        // Command 6: subscribe_trigger
        ws.send(JSON.stringify({
          id: 6,
          type: "subscribe_trigger",
          trigger: { platform: "state", entity_id: "device_tracker.mobile_app" }
        }));

        // Command 7: config/device_registry/list
        ws.send(JSON.stringify({ id: 7, type: "config/device_registry/list" }));

        // Command 8: config/entity_registry/list
        ws.send(JSON.stringify({ id: 8, type: "config/entity_registry/list" }));

        // Command 9: config/area_registry/list
        ws.send(JSON.stringify({ id: 9, type: "config/area_registry/list" }));

        // Command 10: persistent_notification/get
        ws.send(JSON.stringify({ id: 10, type: "persistent_notification/get" }));

        // Command 11: frontend/get_user_data
        ws.send(JSON.stringify({ id: 11, type: "frontend/get_user_data" }));

        // Command 12: mobile_app/push_notification_channel or unrecognized
        ws.send(JSON.stringify({ id: 12, type: "mobile_app/push_notification_channel" }));
      }
    } catch (err) {
      console.error("Error in message handler:", err);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`WebSocket closed with code ${code}, reason: ${reason.toString()}`);
  });

  await new Promise((resolve) => setTimeout(resolve, 5000));
  ws.close();
}

testAndroidCompanionWsFlow().catch(console.error);
