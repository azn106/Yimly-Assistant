import { notifyExternalBus } from "./externalBus";

export interface WebSocketSubscriber {
  id: string;
  onStateChanged?: () => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export interface HAWebSocketManagerOptions {
  wsUrl?: string;
  webSocketClass?: any;
  reconnectIntervalMs?: number;
  unmountDebounceMs?: number;
}

export class HAWebSocketManager {
  private activeSocket: WebSocket | null = null;
  private currentGeneration: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isManuallyClosed: boolean = false;
  private currentToken: string | null = null;
  private subscribers: Map<string, WebSocketSubscriber> = new Map();
  private isConnected: boolean = false;

  // Configurable options for testing and environment adaptation
  private customWsUrl: string | null = null;
  private customWebSocketClass: any = null;
  private reconnectIntervalMs: number = 4000;
  private unmountDebounceMs: number = 100;

  constructor(options?: HAWebSocketManagerOptions) {
    if (options?.wsUrl) this.customWsUrl = options.wsUrl;
    if (options?.webSocketClass) this.customWebSocketClass = options.webSocketClass;
    if (options?.reconnectIntervalMs) this.reconnectIntervalMs = options.reconnectIntervalMs;
    if (options?.unmountDebounceMs !== undefined) this.unmountDebounceMs = options.unmountDebounceMs;
  }

  public setOptions(options: HAWebSocketManagerOptions) {
    if (options.wsUrl !== undefined) this.customWsUrl = options.wsUrl;
    if (options.webSocketClass !== undefined) this.customWebSocketClass = options.webSocketClass;
    if (options.reconnectIntervalMs !== undefined) this.reconnectIntervalMs = options.reconnectIntervalMs;
    if (options.unmountDebounceMs !== undefined) this.unmountDebounceMs = options.unmountDebounceMs;
  }

  private getWebSocketUrl(): string {
    if (this.customWsUrl) return this.customWsUrl;
    if (typeof window !== "undefined") {
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${wsProtocol}//${window.location.host}/api/websocket`;
    }
    return "ws://127.0.0.1:3000/api/websocket";
  }

  private getWebSocketClass(): any {
    if (this.customWebSocketClass) return this.customWebSocketClass;
    if (typeof WebSocket !== "undefined") return WebSocket;
    if (typeof globalThis !== "undefined" && (globalThis as any).WebSocket) return (globalThis as any).WebSocket;
    throw new Error("No WebSocket implementation found in current environment");
  }

  /**
   * Connects to Home Assistant WebSocket backend.
   * Guarantees that concurrent/racing calls resolve to the EXACT SAME physical WebSocket.
   */
  public connect(token: string): WebSocket {
    if (!token) {
      throw new Error("Cannot connect WebSocket: access token is required");
    }

    this.isManuallyClosed = false;

    // 1. Cancel any pending reconnect timer so it can never race with this connection
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 2. Cancel any pending unmount debounce disconnect (e.g. from React StrictMode remount)
    if (this.pendingDisconnectTimer) {
      clearTimeout(this.pendingDisconnectTimer);
      this.pendingDisconnectTimer = null;
    }

    // 3. Concurrency check: If an active socket is currently CONNECTING or OPEN with the SAME token,
    // reuse the existing physical socket. DO NOT create duplicate sockets.
    const WSClass = this.getWebSocketClass();
    const CONNECTING = WSClass.CONNECTING !== undefined ? WSClass.CONNECTING : 0;
    const OPEN = WSClass.OPEN !== undefined ? WSClass.OPEN : 1;

    if (
      this.activeSocket &&
      (this.activeSocket.readyState === CONNECTING || this.activeSocket.readyState === OPEN) &&
      this.currentToken === token
    ) {
      return this.activeSocket;
    }

    // 4. If an active socket exists with a different token or in closing state, cleanly discard it
    if (this.activeSocket) {
      this.teardownSocket(this.activeSocket, false);
    }

    this.currentToken = token;
    const myGeneration = ++this.currentGeneration;
    const url = this.getWebSocketUrl();

    let ws: WebSocket;
    try {
      ws = new WSClass(url);
    } catch (err) {
      console.error("[HA WebSocket] Failed to instantiate WebSocket:", err);
      this.scheduleReconnect();
      throw err;
    }

    this.activeSocket = ws;

    ws.onopen = () => {
      // Guard against stale socket
      if (this.currentGeneration !== myGeneration || this.activeSocket !== ws) {
        return;
      }
      console.log("[HA WebSocket] Connected to /api/websocket");
    };

    ws.onmessage = (event: MessageEvent) => {
      // Guard against stale socket: never process or send messages on obsolete sockets
      if (this.currentGeneration !== myGeneration || this.activeSocket !== ws) {
        return;
      }

      try {
        const raw = typeof event.data === "string" ? event.data : event.data?.toString?.();
        const data = JSON.parse(raw);

        if (data.type === "auth_required") {
          // Handshake challenge: send auth token
          ws.send(JSON.stringify({ type: "auth", access_token: token }));
        } else if (data.type === "auth_ok") {
          console.log("[HA WebSocket] Auth successful (auth_ok). Notifying Companion App.");
          this.isConnected = true;

          // Notify native companion app bridge
          notifyExternalBus("connection-status", { event: "connected" });

          // Subscribe to state changes and load initial state
          ws.send(JSON.stringify({ id: 1, type: "subscribe_events", event_type: "state_changed" }));
          ws.send(JSON.stringify({ id: 2, type: "get_states" }));
          ws.send(JSON.stringify({ id: 3, type: "get_config" }));

          for (const sub of this.subscribers.values()) {
            try {
              sub.onConnected?.();
            } catch (e) {
              console.warn("[HA WebSocket] Subscriber onConnected error:", e);
            }
          }
        } else if (data.type === "auth_invalid") {
          console.warn("[HA WebSocket] Auth invalid.");
          notifyExternalBus("connection-status", { event: "auth-invalid" });
        } else if (data.type === "event" && data.event?.event_type === "state_changed") {
          for (const sub of this.subscribers.values()) {
            try {
              sub.onStateChanged?.();
            } catch (e) {
              console.warn("[HA WebSocket] Subscriber onStateChanged error:", e);
            }
          }
        }
      } catch (err) {
        console.warn("[HA WebSocket] Error parsing message:", err);
      }
    };

    ws.onclose = () => {
      // Stale socket guard: a stale socket must NEVER replace or clear activeSocket,
      // notify external bus, or schedule reconnect!
      if (this.currentGeneration !== myGeneration || this.activeSocket !== ws) {
        return;
      }

      console.log("[HA WebSocket] Connection closed.");
      this.isConnected = false;
      this.activeSocket = null;
      notifyExternalBus("connection-status", { event: "disconnected" });

      for (const sub of this.subscribers.values()) {
        try {
          sub.onDisconnected?.();
        } catch (e) {
          console.warn("[HA WebSocket] Subscriber onDisconnected error:", e);
        }
      }

      // Schedule reconnect ONLY if not manually closed and token is still active
      if (!this.isManuallyClosed && this.currentToken) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = (err) => {
      // Stale socket guard
      if (this.currentGeneration !== myGeneration || this.activeSocket !== ws) {
        return;
      }
      console.warn("[HA WebSocket] Connection error:", err);
      try {
        ws.close();
      } catch {}
    };

    return ws;
  }

  /**
   * Schedules a single reconnect attempt, ensuring no duplicates or racing timers.
   */
  private scheduleReconnect(): void {
    if (this.isManuallyClosed || !this.currentToken) return;

    // Clear any existing reconnect timer to guarantee only one timer is pending
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const WSClass = this.getWebSocketClass();
    const CONNECTING = WSClass.CONNECTING !== undefined ? WSClass.CONNECTING : 0;
    const OPEN = WSClass.OPEN !== undefined ? WSClass.OPEN : 1;

    // If a connection is already connecting or active, do NOT schedule reconnect
    if (
      this.activeSocket &&
      (this.activeSocket.readyState === CONNECTING || this.activeSocket.readyState === OPEN)
    ) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isManuallyClosed || !this.currentToken) return;

      if (
        this.activeSocket &&
        (this.activeSocket.readyState === CONNECTING || this.activeSocket.readyState === OPEN)
      ) {
        return;
      }

      console.log("[HA WebSocket] Reconnecting...");
      try {
        this.connect(this.currentToken);
      } catch (err) {
        console.error("[HA WebSocket] Reconnect connection attempt failed:", err);
        this.scheduleReconnect();
      }
    }, this.reconnectIntervalMs);
  }

  /**
   * Gracefully tears down a socket, detaching all listeners so late events cannot fire.
   */
  private teardownSocket(socket: WebSocket, notifyDisconnect: boolean = false): void {
    // Invalidate generation
    this.currentGeneration++;

    // Detach all listeners immediately
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
    } catch {}

    try {
      const WSClass = this.getWebSocketClass();
      const CLOSED = WSClass.CLOSED !== undefined ? WSClass.CLOSED : 3;
      if (socket.readyState !== CLOSED) {
        socket.close();
      }
    } catch {}

    if (this.activeSocket === socket) {
      this.activeSocket = null;
      this.isConnected = false;
    }

    if (notifyDisconnect) {
      notifyExternalBus("connection-status", { event: "disconnected" });
    }
  }

  /**
   * Disconnects the active WebSocket session.
   * If isManualLogout is true, marks session as manually closed and clears credentials.
   */
  public disconnect(isManualLogout: boolean = true): void {
    if (isManualLogout) {
      this.isManuallyClosed = true;
      this.currentToken = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pendingDisconnectTimer) {
      clearTimeout(this.pendingDisconnectTimer);
      this.pendingDisconnectTimer = null;
    }

    if (this.activeSocket) {
      this.teardownSocket(this.activeSocket, isManualLogout);
    }
  }

  /**
   * Subscribes a listener component.
   * Handles React StrictMode mount -> cleanup -> remount smoothly via debounce.
   */
  public subscribe(subscriber: WebSocketSubscriber): () => void {
    this.subscribers.set(subscriber.id, subscriber);

    // Cancel pending disconnect if a new subscriber attaches
    if (this.pendingDisconnectTimer) {
      clearTimeout(this.pendingDisconnectTimer);
      this.pendingDisconnectTimer = null;
    }

    return () => {
      this.subscribers.delete(subscriber.id);

      if (this.subscribers.size === 0) {
        if (this.pendingDisconnectTimer) {
          clearTimeout(this.pendingDisconnectTimer);
        }
        // Debounce unmount disconnect so React StrictMode or quick route transitions
        // do not thrash or recreate WebSocket connections.
        this.pendingDisconnectTimer = setTimeout(() => {
          this.pendingDisconnectTimer = null;
          if (this.subscribers.size === 0) {
            this.disconnect(false);
          }
        }, this.unmountDebounceMs);
      }
    };
  }

  // Diagnostic / Introspection methods for unit testing & debugging
  public getActiveSocket(): WebSocket | null {
    return this.activeSocket;
  }

  public getSubscriberCount(): number {
    return this.subscribers.size;
  }

  public hasPendingReconnectTimer(): boolean {
    return this.reconnectTimer !== null;
  }

  public hasPendingDisconnectTimer(): boolean {
    return this.pendingDisconnectTimer !== null;
  }

  public getGeneration(): number {
    return this.currentGeneration;
  }

  public isSocketConnected(): boolean {
    return this.isConnected;
  }

  public resetForTesting(): void {
    this.disconnect(true);
    this.subscribers.clear();
    this.currentGeneration = 0;
  }
}

// Global Singleton Instance
export const haWebSocketManager = new HAWebSocketManager();
