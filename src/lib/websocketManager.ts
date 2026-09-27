// Helper to dispatch messages to Android Companion App (V2 and V1) and iOS External Bus
export const notifyExternalBus = (type: string, payload?: any, id?: number) => {
  const msg: any = { type };
  if (payload !== undefined) msg.payload = payload;
  if (id !== undefined) msg.id = id;
  const msgStr = JSON.stringify(msg);

  try {
    const extAppV2 = (window as any).externalAppV2;
    if (extAppV2 && typeof extAppV2.postMessage === "function") {
      extAppV2.postMessage(msgStr);
    }
  } catch (err) {
    console.warn("[ExternalBus] externalAppV2 postMessage error:", err);
  }

  try {
    const extApp = (window as any).externalApp;
    if (extApp && typeof extApp.externalBus === "function") {
      extApp.externalBus(msgStr);
    } else if (extApp && typeof extApp.postMessage === "function") {
      extApp.postMessage(msgStr);
    }
  } catch (err) {
    console.warn("[ExternalBus] externalApp notify error:", err);
  }

  try {
    const webkit = (window as any).webkit;
    if (webkit?.messageHandlers?.externalBus?.postMessage) {
      webkit.messageHandlers.externalBus.postMessage(msgStr);
    }
  } catch (err) {
    console.warn("[ExternalBus] webkit externalBus postMessage error:", err);
  }
};

// Module-scoped WebSocket Manager singleton to guarantee exactly one active WebSocket per session
interface GlobalWsManager {
  ws: WebSocket | null;
  generation: number;
  isConnecting: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  onStateChangedCallbacks: Set<() => void>;
  token: string | null;
  authFailed: boolean;
  isExplicitDisconnect: boolean;
}

export const globalWsManager: GlobalWsManager = {
  ws: null,
  generation: 0,
  isConnecting: false,
  reconnectTimer: null,
  onStateChangedCallbacks: new Set(),
  token: null,
  authFailed: false,
  isExplicitDisconnect: false
};

const detachAndCloseSocket = (socket: WebSocket) => {
  try {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1000, "Normal closure");
    }
  } catch {}
};

export let reconnectDelayMs = 4000;
export const setReconnectDelayForTesting = (ms: number) => {
  reconnectDelayMs = ms;
};

export const connectWebSocketManager = (token: string) => {
  if (!token) return;

  // 1. Check if an active connection already exists (OPEN or CONNECTING)
  if (globalWsManager.ws) {
    const readyState = globalWsManager.ws.readyState;
    if (readyState === WebSocket.CONNECTING || readyState === WebSocket.OPEN) {
      if (globalWsManager.token === token && !globalWsManager.authFailed) {
        // Already active for this session token
        return;
      }
      // Token changed or previous auth failed, replace cleanly
      disconnectWebSocketManager();
    } else if (readyState === WebSocket.CLOSING) {
      detachAndCloseSocket(globalWsManager.ws);
      globalWsManager.ws = null;
    }
  }

  // 2. Check synchronous connection lock to prevent racing calls before ws assignment
  if (globalWsManager.isConnecting) {
    return;
  }

  // Acquire lock, reset flags & clear reconnect timers
  globalWsManager.isConnecting = true;
  globalWsManager.isExplicitDisconnect = false;
  globalWsManager.authFailed = false;
  globalWsManager.token = token;

  if (globalWsManager.reconnectTimer) {
    clearTimeout(globalWsManager.reconnectTimer);
    globalWsManager.reconnectTimer = null;
  }

  const currentGen = ++globalWsManager.generation;
  const wsProtocol = typeof window !== "undefined" && window.location?.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof window !== "undefined" && window.location?.host ? window.location.host : "127.0.0.1:3000";
  const wsUrl = `${wsProtocol}//${host}/api/websocket`;

  let ws: WebSocket | null = null;
  try {
    const socket = new WebSocket(wsUrl);
    ws = socket;
    (socket as any)._generation = currentGen;
    globalWsManager.ws = socket;

    socket.onopen = () => {
      if ((socket as any)._generation !== globalWsManager.generation) return;
      globalWsManager.isConnecting = false;
      console.log("[HA WebSocket] Connected to /api/websocket (gen:", currentGen, ")");
    };

    socket.onmessage = (event: any) => {
      if ((socket as any)._generation !== globalWsManager.generation) return;

      try {
        const data = JSON.parse(event.data);

        if (data.type === "ping") {
          const pongPayload: any = { type: "pong" };
          if (data.id !== undefined) pongPayload.id = data.id;
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(pongPayload));
          }
        } else if (data.type === "auth_required") {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "auth", access_token: token }));
          }
        } else if (data.type === "auth_ok") {
          console.log("[HA WebSocket] Auth successful (auth_ok). Notifying Companion App.");
          globalWsManager.authFailed = false;
          notifyExternalBus("connection-status", { event: "connected" });

          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ id: 1, type: "subscribe_events", event_type: "state_changed" }));
            socket.send(JSON.stringify({ id: 2, type: "get_states" }));
            socket.send(JSON.stringify({ id: 3, type: "get_config" }));
          }
        } else if (data.type === "auth_invalid") {
          console.warn("[HA WebSocket] Auth invalid.");
          globalWsManager.authFailed = true;
          globalWsManager.isConnecting = false;
          notifyExternalBus("connection-status", { event: "auth-invalid" });

          if (globalWsManager.reconnectTimer) {
            clearTimeout(globalWsManager.reconnectTimer);
            globalWsManager.reconnectTimer = null;
          }
          if (globalWsManager.ws === socket) {
            globalWsManager.ws = null;
          }
          detachAndCloseSocket(socket);
        } else if (data.type === "event" && data.event?.event_type === "state_changed") {
          globalWsManager.onStateChangedCallbacks.forEach((cb) => cb());
        }
      } catch (err) {
        console.warn("[HA WebSocket] Error parsing message:", err);
      }
    };

    socket.onclose = (evt: any) => {
      // Stale socket guard: ignore close events from superseded/stale socket generations
      if ((socket as any)._generation !== globalWsManager.generation) {
        console.log("[HA WebSocket] Stale socket onclose ignored (gen:", (socket as any)._generation, "vs current:", globalWsManager.generation, ")");
        return;
      }

      if (globalWsManager.ws === socket) {
        globalWsManager.ws = null;
      }
      globalWsManager.isConnecting = false;

      console.log("[HA WebSocket] Connection closed.", evt.code, evt.reason);

      // If intentionally disconnected or auth failed, do NOT reconnect
      if (globalWsManager.isExplicitDisconnect || globalWsManager.authFailed) {
        return;
      }

      const activeToken = typeof localStorage !== "undefined" ? localStorage.getItem("access_token") : null;
      if (activeToken) {
        notifyExternalBus("connection-status", { event: "disconnected" });
        if (!globalWsManager.reconnectTimer) {
          const reconnectGen = globalWsManager.generation;
          globalWsManager.reconnectTimer = setTimeout(() => {
            globalWsManager.reconnectTimer = null;
            if (
              reconnectGen === globalWsManager.generation &&
              !globalWsManager.isExplicitDisconnect &&
              !globalWsManager.authFailed
            ) {
              connectWebSocketManager(activeToken);
            }
          }, reconnectDelayMs);
        }
      }
    };

    socket.onerror = (err: any) => {
      if ((socket as any)._generation !== globalWsManager.generation) return;
      globalWsManager.isConnecting = false;
      console.warn("[HA WebSocket] Connection error:", err);
      try {
        socket.close();
      } catch {}
    };
  } catch (e) {
    if (currentGen === globalWsManager.generation) {
      globalWsManager.isConnecting = false;
      if (globalWsManager.ws === ws) globalWsManager.ws = null;
    }
    console.error("[HA WebSocket] Failed to create WebSocket:", e);
  }
};

export const disconnectWebSocketManager = () => {
  globalWsManager.generation++; // Invalidates all pending callbacks for previous generations
  globalWsManager.isConnecting = false;
  globalWsManager.isExplicitDisconnect = true;
  globalWsManager.token = null;
  if (globalWsManager.reconnectTimer) {
    clearTimeout(globalWsManager.reconnectTimer);
    globalWsManager.reconnectTimer = null;
  }
  if (globalWsManager.ws) {
    const socketToClose = globalWsManager.ws;
    globalWsManager.ws = null;
    detachAndCloseSocket(socketToClose);
  }
};
