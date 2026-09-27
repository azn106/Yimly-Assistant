// Helpers to dispatch messages to Android Companion App (V2 and V1) and iOS External Bus

export const notifyExternalBus = (type: string, payload?: any, id?: number) => {
  if (typeof window === "undefined") return;

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

// Helper to notify native app when revoking external auth
export const revokeExternalAuth = () => {
  if (typeof window === "undefined") return;

  try {
    (window as any).externalAuthRevokeToken = (success: boolean) => {
      console.log("[ExternalAuth] Token revoked on native app:", success);
    };

    const extAppV2 = (window as any).externalAppV2;
    if (extAppV2 && typeof extAppV2.postMessage === "function") {
      extAppV2.postMessage(
        JSON.stringify({
          type: "revokeExternalAuth",
          payload: { callback: "externalAuthRevokeToken" }
        })
      );
    }

    const extApp = (window as any).externalApp;
    if (extApp && typeof extApp.revokeExternalAuth === "function") {
      try {
        extApp.revokeExternalAuth(JSON.stringify({ callback: "externalAuthRevokeToken" }));
      } catch {
        extApp.revokeExternalAuth({ callback: "externalAuthRevokeToken" });
      }
    }
  } catch (e) {
    console.warn("[ExternalAuth] Error revoking external auth:", e);
  }
};

// Helper to request External Auth token from official Home Assistant Companion App
export const requestExternalAuthToken = (): Promise<string | null> => {
  if (typeof window === "undefined") return Promise.resolve(null);

  return new Promise<string | null>((resolve) => {
    let resolved = false;
    let pollTimer: any = null;

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer);
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        console.warn("[ExternalAuth] Timeout waiting for native externalApp response.");
        resolve(null);
      }
    }, 4500);

    // Official Home Assistant callback name expected and validated by Android Companion App
    (window as any).externalAuthSetToken = (success: boolean, data?: { access_token?: string; expires_in?: number }) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();
      if (success && data?.access_token) {
        console.log("[ExternalAuth] Token received from Companion App externalApp bridge.");
        resolve(data.access_token);
      } else {
        console.warn("[ExternalAuth] externalApp returned failure or no access_token:", data);
        resolve(null);
      }
    };

    const attemptSendRequest = (): boolean => {
      // 1. Android V2 (WebMessageListener) - postMessage with getExternalAuth payload
      const extAppV2 = (window as any).externalAppV2;
      if (extAppV2 && typeof extAppV2.postMessage === "function") {
        try {
          console.log("[ExternalAuth] Requesting token via window.externalAppV2.postMessage");
          extAppV2.postMessage(
            JSON.stringify({
              type: "getExternalAuth",
              payload: {
                callback: "externalAuthSetToken",
                force: false
              }
            })
          );
          return true;
        } catch (e) {
          console.warn("[ExternalAuth] Error calling externalAppV2.postMessage:", e);
        }
      }

      // 2. Android V1 / JavascriptInterface - getExternalAuth method
      const extApp = (window as any).externalApp;
      if (extApp) {
        if (typeof extApp.getExternalAuth === "function") {
          try {
            console.log("[ExternalAuth] Requesting token via window.externalApp.getExternalAuth");
            try {
              extApp.getExternalAuth(
                JSON.stringify({
                  callback: "externalAuthSetToken",
                  force: false
                })
              );
            } catch {
              extApp.getExternalAuth({
                callback: "externalAuthSetToken",
                force: false
              });
            }
            return true;
          } catch (e) {
            console.warn("[ExternalAuth] Error calling externalApp.getExternalAuth:", e);
          }
        } else if (typeof extApp.postMessage === "function") {
          try {
            extApp.postMessage(
              JSON.stringify({
                type: "getExternalAuth",
                payload: {
                  callback: "externalAuthSetToken",
                  force: false
                }
              })
            );
            return true;
          } catch (e) {
            console.warn("[ExternalAuth] Error calling extApp.postMessage:", e);
          }
        }
      }

      // 3. iOS WebKit message handlers
      const webkit = (window as any).webkit;
      if (webkit?.messageHandlers?.getExternalAuth?.postMessage) {
        try {
          console.log("[ExternalAuth] Requesting token via webkit.messageHandlers.getExternalAuth");
          webkit.messageHandlers.getExternalAuth.postMessage({
            callback: "externalAuthSetToken",
            force: false
          });
          return true;
        } catch (e) {
          console.warn("[ExternalAuth] Error calling webkit messageHandler:", e);
        }
      }

      return false;
    };

    // Try immediately
    if (attemptSendRequest()) {
      return;
    }

    // If not immediately available (e.g. injected shortly after DOM eval), poll briefly
    let pollCount = 0;
    pollTimer = setInterval(() => {
      pollCount++;
      if (resolved) {
        cleanup();
        return;
      }
      if (attemptSendRequest() || pollCount > 30) {
        cleanup();
      }
    }, 80);
  });
};
