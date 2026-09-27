import assert from "assert";
import {
  globalWsManager,
  connectWebSocketManager,
  disconnectWebSocketManager,
  setReconnectDelayForTesting
} from "../src/lib/websocketManager";

// Mock global window & localStorage & WebSocket for Node environment testing
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((evt: any) => void) | null = null;
  onclose: ((evt: any) => void) | null = null;
  onerror: ((evt: any) => void) | null = null;
  sentMessages: string[] = [];
  closed = false;
  _generation?: number;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  static instances: MockWebSocket[] = [];

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code = 1000, reason = "") {
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  triggerMessage(data: any) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  }

  triggerClose(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code, reason });
  }
}

// Setup global mocks
(global as any).WebSocket = MockWebSocket;
(global as any).window = {
  location: { protocol: "http:", host: "127.0.0.1:3000" }
};
const storageMap = new Map<string, string>();
(global as any).localStorage = {
  getItem: (key: string) => storageMap.get(key) || null,
  setItem: (key: string, value: string) => storageMap.set(key, value),
  removeItem: (key: string) => storageMap.delete(key)
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSingletonGuardUnitTests() {
  console.log("============================================================");
  console.log("RUNNING WEBSOCKET SINGLETON GUARD UNIT TESTS");
  console.log("============================================================");

  // Use fast reconnect delay for testing
  setReconnectDelayForTesting(30);

  // Reset state
  disconnectWebSocketManager();
  MockWebSocket.instances = [];
  storageMap.set("access_token", "test_token_123");

  // TEST 1: Two simultaneous connection requests create exactly ONE physical WebSocket
  console.log("Test 1: Two simultaneous connection requests create exactly ONE physical WebSocket...");
  connectWebSocketManager("test_token_123");
  connectWebSocketManager("test_token_123");

  assert.strictEqual(MockWebSocket.instances.length, 1, "Expected exactly 1 physical WebSocket instance");
  const ws1 = MockWebSocket.instances[0];
  assert.strictEqual(globalWsManager.ws, ws1 as any, "globalWsManager.ws should reference the single created socket");
  console.log("✓ Test 1 Passed: Exactly 1 WebSocket created from simultaneous requests.");

  // TEST 2: Repeated connection requests while CONNECTING do NOT create another socket
  console.log("\nTest 2: Repeated connection requests while CONNECTING do not create another socket...");
  connectWebSocketManager("test_token_123");
  connectWebSocketManager("test_token_123");
  connectWebSocketManager("test_token_123");

  assert.strictEqual(MockWebSocket.instances.length, 1, "Duplicate calls while CONNECTING must not create sockets");
  console.log("✓ Test 2 Passed: Repeated calls while CONNECTING ignored.");

  // TEST 3: Repeated connection requests while OPEN do NOT create another socket
  console.log("\nTest 3: Repeated connection requests after socket is OPEN do not create another socket...");
  ws1.triggerOpen();
  assert.strictEqual(ws1.readyState, MockWebSocket.OPEN);
  connectWebSocketManager("test_token_123");
  connectWebSocketManager("test_token_123");

  assert.strictEqual(MockWebSocket.instances.length, 1, "Duplicate calls while OPEN must not create sockets");
  console.log("✓ Test 3 Passed: Repeated calls while OPEN ignored.");

  // TEST 4: Auth handshake and state_changed event propagation
  console.log("\nTest 4: Auth handshake and state_changed event propagation...");
  let callbackFired = false;
  const testCb = () => { callbackFired = true; };
  globalWsManager.onStateChangedCallbacks.add(testCb);

  // Receive auth_required challenge from server
  ws1.triggerMessage({ type: "auth_required" });
  assert.strictEqual(ws1.sentMessages.length, 1);
  assert.deepStrictEqual(JSON.parse(ws1.sentMessages[0]), { type: "auth", access_token: "test_token_123" });

  // Receive auth_ok confirmation from server
  ws1.triggerMessage({ type: "auth_ok" });
  assert.strictEqual(ws1.sentMessages.length, 4); // auth + 3 subscriptions (state_changed, get_states, get_config)

  // Receive state_changed event
  ws1.triggerMessage({ type: "event", event_type: "state_changed", event: { event_type: "state_changed" } });
  assert.strictEqual(callbackFired, true, "onStateChanged callback should have fired");
  globalWsManager.onStateChangedCallbacks.delete(testCb);
  console.log("✓ Test 4 Passed: Auth handshake & state_changed event propagation verified.");

  // TEST 5: A stale socket's onclose cannot reconnect over a newer active socket
  console.log("\nTest 5: Stale socket onclose cannot reconnect over a newer active socket...");
  const initialGen = globalWsManager.generation;

  // Simulate explicit re-connection / new session (Generation 2)
  disconnectWebSocketManager();
  assert.strictEqual(globalWsManager.generation, initialGen + 1, "Generation must increment on disconnect");
  assert.strictEqual(globalWsManager.ws, null, "globalWsManager.ws must be null after disconnect");

  connectWebSocketManager("test_token_123");
  assert.strictEqual(MockWebSocket.instances.length, 2, "New session should create socket instance #2");
  const ws2 = MockWebSocket.instances[1];
  assert.strictEqual(globalWsManager.ws, ws2 as any, "globalWsManager.ws should point to socket #2");

  // Trigger onclose on OLD socket #1 (ws1)
  ws1.triggerClose(1006, "Abnormal closure from old socket");

  // Assert that ws2 remains active and globalWsManager.ws is NOT cleared or disrupted by ws1's onclose
  assert.strictEqual(globalWsManager.ws, ws2 as any, "Stale ws1 onclose must NOT clear active ws2 reference!");
  assert.strictEqual(MockWebSocket.instances.length, 2, "Stale onclose must NOT create an unwanted replacement socket!");
  console.log("✓ Test 5 Passed: Stale socket onclose correctly ignored by generation guard.");

  // TEST 6: Reconnect after a genuine connection failure creates only one replacement socket
  console.log("\nTest 6: Reconnect after a genuine connection failure creates only one replacement socket...");
  ws2.triggerOpen();
  ws2.triggerMessage({ type: "auth_required" });
  ws2.triggerMessage({ type: "auth_ok" });

  // Simulate unexpected connection drop (e.g. server restart / wifi drop)
  ws2.triggerClose(1006, "Connection lost unexpectedly");
  assert.strictEqual(globalWsManager.ws, null, "ws reference cleared after drop");
  assert.notStrictEqual(globalWsManager.reconnectTimer, null, "Reconnect timer must be scheduled");

  // Racing calls during reconnect timer delay should NOT create additional sockets
  connectWebSocketManager("test_token_123");
  // The call replaces or uses the connection
  assert.strictEqual(MockWebSocket.instances.length, 3, "Exactly 1 replacement socket created");
  const ws3 = MockWebSocket.instances[2];
  assert.strictEqual(globalWsManager.ws, ws3 as any, "ws3 is now the active socket");

  // Wait past reconnect delay to ensure timer doesn't fire duplicate
  await sleep(50);
  assert.strictEqual(MockWebSocket.instances.length, 3, "No duplicate socket created by expired timer");
  console.log("✓ Test 6 Passed: Genuine connection failure creates exactly ONE replacement socket.");

  // TEST 7: Intentional cleanup/unmount prevents unwanted reconnect
  console.log("\nTest 7: Intentional cleanup/unmount prevents unwanted reconnect...");
  ws3.triggerOpen();
  disconnectWebSocketManager();
  assert.strictEqual(globalWsManager.ws, null, "Socket cleared after disconnect");
  assert.strictEqual(globalWsManager.reconnectTimer, null, "Reconnect timer cleared after disconnect");

  // Wait to verify no reconnect occurs
  await sleep(50);
  assert.strictEqual(MockWebSocket.instances.length, 3, "No unwanted reconnect occurred after intentional cleanup");
  console.log("✓ Test 7 Passed: Intentional cleanup prevents unwanted reconnect.");

  // TEST 8: Failed handshake (auth_invalid) halts reconnection and does NOT trigger reconnect loops
  console.log("\nTest 8: Failed handshake (auth_invalid) halts reconnection without loop...");
  connectWebSocketManager("invalid_token_xyz");
  assert.strictEqual(MockWebSocket.instances.length, 4, "Created socket #4 for auth test");
  const ws4 = MockWebSocket.instances[3];
  ws4.triggerOpen();
  ws4.triggerMessage({ type: "auth_required" });
  // Server sends auth_invalid
  ws4.triggerMessage({ type: "auth_invalid", message: "Invalid access token" });

  assert.strictEqual(globalWsManager.authFailed, true, "authFailed flag set to true");
  assert.strictEqual(globalWsManager.reconnectTimer, null, "No reconnect timer on auth failure");
  assert.strictEqual(globalWsManager.ws, null, "ws cleared on auth failure");

  // Wait to verify no reconnect loop
  await sleep(50);
  assert.strictEqual(MockWebSocket.instances.length, 4, "No reconnect loop initiated on auth failure");
  console.log("✓ Test 8 Passed: Failed handshake cleanly halts reconnection without loops.");

  // TEST 9: Singleton safety across repeated React component lifecycle events (StrictMode simulation)
  console.log("\nTest 9: Singleton safety across repeated React 18 StrictMode mount/cleanup/remount...");
  disconnectWebSocketManager();
  storageMap.set("access_token", "valid_lifecycle_token");

  // Component Mount 1
  const cb1 = () => {};
  globalWsManager.onStateChangedCallbacks.add(cb1);
  connectWebSocketManager("valid_lifecycle_token");
  const baselineCount = MockWebSocket.instances.length;

  // StrictMode Cleanup 1 (removes callback but preserves authenticated singleton)
  globalWsManager.onStateChangedCallbacks.delete(cb1);

  // StrictMode Remount 2 (adds callback and connects again)
  const cb2 = () => {};
  globalWsManager.onStateChangedCallbacks.add(cb2);
  connectWebSocketManager("valid_lifecycle_token");

  // Additional re-render / effect execution
  connectWebSocketManager("valid_lifecycle_token");

  assert.strictEqual(MockWebSocket.instances.length, baselineCount, "Repeated React mount/remount must NOT create duplicate sockets");
  console.log("✓ Test 9 Passed: Singleton completely safe across repeated React lifecycle events.");

  // Clean up
  disconnectWebSocketManager();
  setReconnectDelayForTesting(4000);

  console.log("\n============================================================");
  console.log("ALL WEBSOCKET SINGLETON GUARD UNIT TESTS PASSED! 🎉");
  console.log("============================================================\n");
}

runSingletonGuardUnitTests().catch((err) => {
  console.error("Unit Test Failed:", err);
  process.exit(1);
});
