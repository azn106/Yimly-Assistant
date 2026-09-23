import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Lock,
  User,
  RefreshCw,
  AlertCircle,
  Home,
  UserCheck,
  Settings as SettingsIcon,
  X
} from "lucide-react";

import { Circle, CircleMember, UserInfo } from "./types";
import { NavIcon, NavIconPackId } from "./lib/navIcons";
import { MapComponent, MapComponentHandle } from "./components/MapComponent";
import { PeopleTab } from "./components/PeopleTab";
import { PlacesTab } from "./components/PlacesTab";
import { AlertsTab } from "./components/AlertsTab";
import { SettingsTab } from "./components/SettingsTab";
import { PreviewTestState, processPreviewTestMembers } from "./lib/previewTestMode";
import { PreviewTestModeControls } from "./components/PreviewTestModeControls";

export default function App() {
  const [status, setStatus] = useState<"checking" | "setup" | "login" | "authenticated" | "register">("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserInfo | null>(() => {
    try {
      const saved = localStorage.getItem("user_info");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Preview Test Mode State (Development & AI Studio Preview Only)
  const [testState, setTestState] = useState<PreviewTestState>({
    enabled: true,
    viewingRole: "owner",
    defaultDeviceId: "device_tracker.sim_iphone"
  });

  // Circles States
  const [circles, setCircles] = useState<Circle[]>([]);
  const [selectedCircle, setSelectedCircle] = useState<Circle | null>(null);
  const [circleMembers, setCircleMembers] = useState<CircleMember[]>([]);
  const [circlesLoading, setCirclesLoading] = useState(false);

  // Tab State: "map" | "people" | "places" | "alerts" | "settings"
  const [activeTab, setActiveTab] = useState<"map" | "people" | "places" | "alerts" | "settings">("map");

  // Selected Member State (Synced with MapComponent selection)
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const mapComponentRef = useRef<MapComponentHandle | null>(null);

  // Process members and effective user for Preview Test Mode
  const { members: displayMembers, effectiveUser: displayUser } = processPreviewTestMembers(
    circleMembers,
    user,
    testState
  );

  // Navigation Icon Pack State: "classic" | "minimal" | "rounded" | "bold" | "modern"
  const [navIconPack, setNavIconPack] = useState<NavIconPackId>(() => {
    const saved = localStorage.getItem("nav_icon_pack");
    if (saved && ["classic", "minimal", "rounded", "bold", "modern"].includes(saved)) {
      return saved as NavIconPackId;
    }
    return "classic";
  });

  // Run on mount to check existing session, setup status, and register SW
  useEffect(() => {
    checkSessionAndSetup();
    registerServiceWorker();
  }, []);

  // Periodic location polling for active members
  useEffect(() => {
    if (status !== "authenticated" || !selectedCircle) return;

    fetchCircleMembers(selectedCircle.id); // Load immediately on circle switch

    const interval = setInterval(() => {
      fetchCircleMembers(selectedCircle.id, true); // Silent background reload
    }, 15000); // 15 seconds real-time update loop

    return () => clearInterval(interval);
  }, [status, selectedCircle]);

  const registerServiceWorker = () => {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .then((reg) => {
            console.log("Service Worker registered successfully with scope:", reg.scope);
          })
          .catch((err) => {
            console.error("Service Worker registration failed:", err);
          });
      });
    }
  };

  const checkSessionAndSetup = async () => {
    setStatus("checking");
    setError(null);
    const token = localStorage.getItem("access_token");

    if (token) {
      try {
        const res = await fetch("/api/auth/me", {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (res.ok) {
          const fetchedUser = await res.json();
          localStorage.setItem("user_info", JSON.stringify(fetchedUser));
          setUser(fetchedUser);
          setStatus("authenticated");
          await fetchCircles(token);
          return;
        } else {
          localStorage.removeItem("access_token");
          localStorage.removeItem("user_info");
        }
      } catch (err) {
        console.error("Error validating session:", err);
      }
    }

    try {
      const setupRes = await fetch("/api/setup/status");
      if (setupRes.ok) {
        const setupData = await setupRes.json();
        if (setupData.needs_setup) {
          setStatus("setup");
        } else {
          setStatus("login");
        }
      } else {
        setError("Unable to retrieve server status. Please verify the backend is running.");
        setStatus("login");
      }
    } catch (err) {
      setError("Network error: Server is unreachable. Check your connection.");
      setStatus("login");
    }
  };

  // FETCH CIRCLES
  const fetchCircles = async (tokenVal?: string) => {
    const token = tokenVal || localStorage.getItem("access_token");
    if (!token) return;

    setCirclesLoading(true);
    try {
      const res = await fetch("/api/circles", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setCircles(data);
        if (data.length > 0) {
          if (!selectedCircle || !data.some((c: Circle) => c.id === selectedCircle.id)) {
            setSelectedCircle(data[0]);
          }
        } else {
          setSelectedCircle(null);
          setCircleMembers([]);
        }
      }
    } catch (err) {
      console.warn("Unable to reach family circles API:", err);
    } finally {
      setCirclesLoading(false);
    }
  };

  // FETCH CIRCLE MEMBERS
  const fetchCircleMembers = async (circleId: number, silent = false) => {
    if (!circleId) return;
    const token = localStorage.getItem("access_token");
    if (!token) return;

    if (!silent) setCirclesLoading(true);
    try {
      const res = await fetch(`/api/circles/${circleId}/members`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setCircleMembers(data);
      } else if (res.status === 401) {
        handleLogout();
      } else if (res.status === 403 || res.status === 404) {
        setCircleMembers([]);
      }
    } catch (err) {
      console.warn("Unable to update circle members (transient network state):", err);
    } finally {
      if (!silent) setCirclesLoading(false);
    }
  };

  // CREATE CIRCLE
  const handleCreateCircle = async (name: string) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    const res = await fetch("/api/circles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ name })
    });

    if (res.ok) {
      const newCircle = await res.json();
      await fetchCircles(token);
      setSelectedCircle(newCircle);
    } else {
      const data = await res.json();
      throw new Error(data.detail || "Failed to create Circle");
    }
  };

  // JOIN CIRCLE
  const handleJoinCircle = async (code: string) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    const res = await fetch("/api/circles/join", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ invite_code: code.trim().toUpperCase() })
    });

    if (res.ok) {
      const joinedCircle = await res.json();
      await fetchCircles(token);
      setSelectedCircle(joinedCircle);
    } else {
      const data = await res.json();
      throw new Error(data.detail || "Invalid invite code or already a member");
    }
  };

  // LEAVE CIRCLE
  const handleLeaveCircle = async (circleId: number) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    const res = await fetch(`/api/circles/${circleId}/leave`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    if (res.ok) {
      const remainingRes = await fetch("/api/circles", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (remainingRes.ok) {
        const remaining: Circle[] = await remainingRes.json();
        setCircles(remaining);
        if (selectedCircle?.id === circleId) {
          if (remaining.length > 0) {
            setSelectedCircle(remaining[0]);
          } else {
            setSelectedCircle(null);
            setCircleMembers([]);
          }
        }
      }
    } else {
      const data = await res.json();
      throw new Error(data.detail || "Failed to leave circle");
    }
  };

  // DELETE CIRCLE (Admin/Owner only)
  const handleDeleteCircle = async (circleId: number) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    const res = await fetch(`/api/circles/${circleId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    if (res.ok) {
      const remainingRes = await fetch("/api/circles", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (remainingRes.ok) {
        const remaining: Circle[] = await remainingRes.json();
        setCircles(remaining);
        if (selectedCircle?.id === circleId) {
          if (remaining.length > 0) {
            setSelectedCircle(remaining[0]);
          } else {
            setSelectedCircle(null);
            setCircleMembers([]);
          }
        }
      }
    } else {
      const data = await res.json();
      throw new Error(data.detail || "Failed to delete Family Circle");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !displayName.trim() || !password || !confirmPassword) {
      setError("All fields are required.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const endpoint = status === "setup" ? "/api/setup/register" : "/api/auth/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
          display_name: displayName.trim()
        })
      });

      if (res.ok) {
        await performLogin(username.trim(), password);
      } else {
        const data = await res.json();
        setError(data.detail || "Account creation failed.");
        setLoading(false);
      }
    } catch (err) {
      setError("Connection to server failed during account creation.");
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setLoading(true);
    await performLogin(username.trim(), password);
  };

  const performLogin = async (userVal: string, passVal: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username: userVal,
          password: passVal
        })
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem("access_token", data.access_token);
        localStorage.setItem("user_info", JSON.stringify(data.user));
        setUser(data.user);
        setStatus("authenticated");
        await fetchCircles(data.access_token);

        setPassword("");
        setConfirmPassword("");
        setUsername("");
        setDisplayName("");
      } else {
        setError(data.detail || "Invalid username or password.");
      }
    } catch (err) {
      setError("Failed to connect to the authentication server.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("user_info");
    setUser(null);
    setCircles([]);
    setSelectedCircle(null);
    setCircleMembers([]);
    setStatus("login");
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-slate-900 text-slate-900 font-sans relative select-none">
      
      {/* AUTHENTICATED SYSTEM FLOW */}
      {status === "authenticated" ? (
        <div className="relative w-full h-full overflow-hidden">
          {/* PREVIEW TEST MODE CONTROLS (Dev / AI Studio Preview Only) */}
          <PreviewTestModeControls testState={testState} onChangeTestState={setTestState} />
          
          {/* 1. FULL-SCREEN DOMINANT MAP BACKGROUND */}
          <div className="absolute inset-0 z-0 w-full h-full">
            <MapComponent
              ref={mapComponentRef}
              members={displayMembers}
              currentUser={displayUser}
              onRefresh={() => selectedCircle && fetchCircleMembers(selectedCircle.id)}
              loading={circlesLoading}
              mapStyle={user?.map_style}
              mapPinType={user?.map_pin_type}
              selectedIconSize={user?.map_selected_icon_size}
              unselectedIconSize={user?.map_unselected_icon_size}
              selectedMemberId={selectedMemberId}
              onSelectMemberId={setSelectedMemberId}
              onSetDefaultDevice={(memberId, entityId) => {
                if (testState.enabled) {
                  setTestState((prev) => ({
                    ...prev,
                    defaultDeviceId: entityId
                  }));
                }
              }}
            />
          </div>

          {/* 2. FLOATING NAVIGATION DOCK (DESKTOP) */}
          <nav className="hidden md:flex fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white/85 backdrop-blur-2xl p-2 rounded-full border border-white/80 shadow-[0_16px_48px_rgba(0,0,0,0.12)] items-center gap-1.5 pointer-events-auto">
            <button
              onClick={() => setActiveTab("map")}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black transition-all duration-150 cursor-pointer active:scale-95 ${
                activeTab === "map"
                  ? "bg-slate-900 text-white shadow-md"
                  : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
              }`}
            >
              <NavIcon tab="map" pack={navIconPack} isSelected={activeTab === "map"} className="w-4 h-4" />
              <span>Map</span>
            </button>

            <button
              onClick={() => setActiveTab("people")}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black transition-all duration-150 cursor-pointer active:scale-95 ${
                activeTab === "people"
                  ? "bg-slate-900 text-white shadow-md"
                  : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
              }`}
            >
              <NavIcon tab="people" pack={navIconPack} isSelected={activeTab === "people"} className="w-4 h-4" />
              <span>People</span>
            </button>

            <button
              onClick={() => setActiveTab("places")}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black transition-all duration-150 cursor-pointer active:scale-95 ${
                activeTab === "places"
                  ? "bg-slate-900 text-white shadow-md"
                  : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
              }`}
            >
              <NavIcon tab="places" pack={navIconPack} isSelected={activeTab === "places"} className="w-4 h-4" />
              <span>Places</span>
            </button>

            <button
              onClick={() => setActiveTab("alerts")}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-black transition-all duration-150 cursor-pointer active:scale-95 ${
                activeTab === "alerts"
                  ? "bg-slate-900 text-white shadow-md"
                  : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
              }`}
            >
              <NavIcon tab="alerts" pack={navIconPack} isSelected={activeTab === "alerts"} className="w-4 h-4" />
              <span>Alerts</span>
            </button>

            <div className="w-px h-6 bg-slate-200/80 my-auto mx-1" />

            {/* Profile Avatar Pill (Settings & Account) */}
            <div 
              onClick={() => setActiveTab("settings")}
              className={`w-8 h-8 text-white font-extrabold text-xs flex items-center justify-center cursor-pointer transition-all duration-150 hover:scale-105 active:scale-95 overflow-hidden shrink-0 ${
                activeTab === "settings"
                  ? "ring-2 ring-slate-900 ring-offset-2 scale-105"
                  : ""
              }`}
              style={{
                backgroundColor: user?.avatar_color || "#4f46e5",
                clipPath: "url(#squircle-clip-app)",
                filter: `drop-shadow(0 2px 4px ${user?.avatar_color || '#4f46e5'}60)`
              }}
              title={`${user?.display_name} (Settings)`}
            >
              {user?.profile_picture_url ? (
                <img
                  src={user.profile_picture_url}
                  alt={user.display_name}
                  className="w-full h-full object-cover"
                  style={{ clipPath: "url(#squircle-clip-app)" }}
                />
              ) : (
                user?.display_name?.charAt(0).toUpperCase()
              )}
            </div>
          </nav>

          {/* Top-Left Family Circle Title Pill (Mobile) */}
          {activeTab === "map" && (
            <div className="md:hidden fixed top-[max(0.75rem,env(safe-area-inset-top))] left-0 z-30 pointer-events-auto">
              <button
                onClick={() => {
                  if (!selectedCircle) {
                    setActiveTab("settings");
                  }
                }}
                disabled={!!selectedCircle}
                className={`h-10 px-5 pl-4.5 bg-white/85 backdrop-blur-2xl border-y border-r border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.08)] flex items-center rounded-r-full select-none text-left focus:outline-none ${
                  !selectedCircle 
                    ? "cursor-pointer hover:bg-white active:scale-95 transition-all text-indigo-600 hover:text-indigo-700" 
                    : "text-slate-800"
                }`}
              >
                <span className="text-sm font-black tracking-wide">
                  {selectedCircle ? selectedCircle.name : "Create or Join"}
                </span>
              </button>
            </div>
          )}

          {/* Top-Right Settings Button (Mobile) */}
          {activeTab === "map" && (
            <div className="md:hidden fixed top-[max(0.75rem,env(safe-area-inset-top))] right-4 z-30 pointer-events-auto">
              <button
                onClick={() => setActiveTab("settings")}
                className="w-10 h-10 bg-white/85 backdrop-blur-2xl rounded-full border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.08)] flex items-center justify-center text-slate-700 hover:text-indigo-600 active:scale-95 transition-all duration-150 cursor-pointer"
                title="Settings"
              >
                <SettingsIcon className="w-4.5 h-4.5" />
              </button>
            </div>
          )}

          {/* FLOATING NAVIGATION DOCK (MOBILE) */}
          <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 pointer-events-none">
            {/* White/Frosted background card: straight square top edge, rising ~1/4 up the 48px member icons */}
            <div className="absolute inset-x-0 bottom-0 top-[44px] bg-white/85 backdrop-blur-2xl rounded-none border-t border-white/80 shadow-[0_-8px_30px_rgb(0,0,0,0.08)] pointer-events-auto" />

            <div 
              className="relative z-10 flex items-center gap-4 overflow-x-auto scrollbar-none pt-2 pb-[calc(8px+env(safe-area-inset-bottom,4px))] px-4 justify-start md:justify-center touch-pan-x pointer-events-auto w-full"
              onTouchMove={(e) => {
                // Completely isolate vertical drag gestures so they cannot bubble and trigger vertical overscroll on the main page/body
                e.stopPropagation();
              }}
            >
              <div className="flex items-center gap-4 mx-auto">
                {displayMembers.map((member) => {
                  const isSelected = selectedMemberId === member.id;
                  const memberColor = member.avatar_color || "#4f46e5";

                  return (
                    <button
                      key={member.id}
                      onClick={() => {
                        setActiveTab("map");
                        if (mapComponentRef.current) {
                          mapComponentRef.current.focusMember(member);
                        } else {
                          setSelectedMemberId(member.id);
                        }
                      }}
                      className="flex flex-col items-center gap-1 shrink-0 cursor-pointer w-12 focus:outline-none"
                    >
                      {/* Ring Indicator & Avatar */}
                      <div
                        className={`relative w-12 h-12 transition duration-200 ${
                          isSelected ? "scale-110" : "hover:scale-105"
                        }`}
                        style={{
                          backgroundColor: isSelected ? memberColor : `${memberColor}25`,
                          clipPath: "url(#squircle-clip-app)",
                          boxShadow: isSelected ? `0 0 12px ${memberColor}40` : "none",
                        }}
                      >
                        {/* White Border Spacer */}
                        <div 
                          className="absolute inset-[1.5px] bg-white flex items-center justify-center"
                          style={{ clipPath: "url(#squircle-clip-app)" }}
                        >
                          {/* Profile Image & Background */}
                          <div
                            className="absolute inset-[1.5px] text-white font-black text-sm flex items-center justify-center overflow-hidden"
                            style={{ 
                              backgroundColor: memberColor,
                              clipPath: "url(#squircle-clip-app)"
                            }}
                          >
                            {member.profile_picture_url ? (
                              <img
                                src={member.profile_picture_url}
                                alt={member.display_name}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                                style={{ clipPath: "url(#squircle-clip-app)" }}
                              />
                            ) : (
                              member.display_name.charAt(0).toUpperCase()
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Display Name */}
                      <span
                        className={`text-[10px] font-extrabold tracking-wide uppercase transition duration-200 truncate w-15 max-w-[60px] text-center ${
                          isSelected ? "text-indigo-600 font-black scale-105" : "text-slate-500"
                        }`}
                      >
                        {member.display_name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* SVG Definitions for true mathematical squircle clips */}
            <svg className="absolute w-0 h-0 pointer-events-none" width="0" height="0">
              <defs>
                <clipPath id="squircle-clip-app" clipPathUnits="objectBoundingBox">
                  <path d="M 0.5,0 C 0.86,0 1,0.14 1,0.5 C 1,0.86 0.86,1 0.5,1 C 0.14,1 0,0.86 0,0.5 C 0,0.14 0.14,0 0.5,0 Z" />
                </clipPath>
              </defs>
            </svg>
          </nav>

          {/* 4. SECONDARY TABS FLOATING MODAL OVERLAY */}
          <AnimatePresence>
            {activeTab !== "map" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-4 md:inset-12 bottom-20 md:bottom-20 z-30 bg-white/95 backdrop-blur-3xl rounded-3xl p-6 md:p-8 shadow-2xl border border-white/80 overflow-y-auto max-w-4xl mx-auto pointer-events-auto"
              >
                {/* Modal Header Bar (Only for secondary tabs that don't render their own custom header) */}
                {activeTab !== "settings" && (
                  <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-100">
                    <span className="text-xs font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
                      {activeTab} view
                    </span>

                    <button
                      onClick={() => setActiveTab("map")}
                      className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer flex items-center gap-1 text-xs font-bold"
                    >
                      <span>Back to Map</span>
                      <X className="w-4.5 h-4.5" />
                    </button>
                  </div>
                )}

                {/* Secondary Tab Content */}
                {activeTab === "people" && (
                  <PeopleTab
                    members={displayMembers}
                    loading={circlesLoading}
                    onSelectMember={(member) => {
                      setActiveTab("map");
                      if (mapComponentRef.current) {
                        mapComponentRef.current.focusMember(member);
                      } else {
                        setSelectedMemberId(member.id);
                      }
                    }}
                  />
                )}

                {activeTab === "places" && (
                  <PlacesTab />
                )}

                {activeTab === "alerts" && (
                  <AlertsTab />
                )}

                {activeTab === "settings" && (
                  <SettingsTab
                    user={user}
                    onLogout={handleLogout}
                    onClose={() => setActiveTab("map")}
                    onUserUpdate={(updated) => {
                      setUser(updated);
                      localStorage.setItem("user_info", JSON.stringify(updated));
                      if (selectedCircle) {
                        fetchCircleMembers(selectedCircle.id, true);
                      }
                    }}
                    circles={circles}
                    selectedCircle={selectedCircle}
                    onSelectCircle={(c) => setSelectedCircle(c)}
                    onCreateCircle={handleCreateCircle}
                    onJoinCircle={handleJoinCircle}
                    onLeaveCircle={handleLeaveCircle}
                    onDeleteCircle={handleDeleteCircle}
                    circlesLoading={circlesLoading}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      ) : (
        /* FIRST-RUN SETUP / LOGIN FLOW */
        <div className="min-h-screen bg-slate-50 flex flex-col justify-between py-12 px-4 sm:px-6 lg:px-8">
          <header className="flex flex-col items-center space-y-3 select-none" id="app-header">
            <div className="h-12 w-12 rounded-2xl bg-indigo-50/80 text-indigo-600 flex items-center justify-center shadow-sm border border-indigo-100/30">
              <Home className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-black tracking-widest text-slate-800" id="brand-title">
              YIMLY HOME
            </h1>
            <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">
              Secure Companion Bridge & Family Hub
            </p>
          </header>

          <main className="my-auto py-8 flex flex-col items-center">
            <AnimatePresence mode="wait">
              {status === "checking" && (
                <motion.div
                  key="checking"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col items-center space-y-3"
                >
                  <RefreshCw className="h-7 w-7 text-indigo-600 animate-spin" />
                  <p className="text-sm font-semibold text-slate-500">Checking server initialization state...</p>
                </motion.div>
              )}

              {(status === "setup" || status === "register") && (
                <motion.div
                  key={status}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.25 }}
                  className="w-full max-w-md bg-white rounded-3xl shadow-[0_16px_48px_rgba(148,163,184,0.08)] border border-slate-100 p-8 space-y-6"
                >
                  <div className="text-center">
                    <h2 className="text-lg font-bold text-slate-800">Create your account</h2>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      {status === "setup"
                        ? "First-run installation detected. Set up administrator credentials."
                        : "Create your user account to join a Family Circle."}
                    </p>
                  </div>

                  {error && (
                    <div className="bg-rose-50 border border-rose-100 text-rose-700 p-3 rounded-2xl flex items-start gap-2 text-xs">
                      <AlertCircle className="h-4.5 w-4.5 shrink-0 mt-0.5 text-rose-500" />
                      <span>{error}</span>
                    </div>
                  )}

                  <form onSubmit={handleRegister} className="space-y-4">
                    <div>
                      <label htmlFor="setup-username" className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                        Username / Email
                      </label>
                      <div className="relative">
                        <User className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-400" />
                        <input
                          id="setup-username"
                          name="username"
                          type="text"
                          required
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="e.g. admin or admin@example.com"
                          disabled={loading}
                          className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="setup-display-name" className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                        Display Name
                      </label>
                      <div className="relative">
                        <UserCheck className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-400" />
                        <input
                          id="setup-display-name"
                          name="displayName"
                          type="text"
                          required
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="e.g. Administrator"
                          disabled={loading}
                          className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="setup-password" className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                        Password
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-400" />
                        <input
                          id="setup-password"
                          name="password"
                          type={showPassword ? "text" : "password"}
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          disabled={loading}
                          className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="setup-confirm-password" className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                        Confirm Password
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-400" />
                        <input
                          id="setup-confirm-password"
                          name="confirmPassword"
                          type={showPassword ? "text" : "password"}
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••"
                          disabled={loading}
                          className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-2xl text-xs uppercase tracking-wider transition shadow-sm"
                    >
                      {loading ? "Creating account..." : "Complete Setup"}
                    </button>
                  </form>
                </motion.div>
              )}

              {status === "login" && (
                <motion.div
                  key="login"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.25 }}
                  className="w-full max-w-md bg-white rounded-3xl shadow-[0_16px_48px_rgba(148,163,184,0.08)] border border-slate-100 p-8 space-y-6"
                >
                  <div className="text-center">
                    <h2 className="text-lg font-bold text-slate-800">Sign in to Yimly Home</h2>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      Enter your account credentials to access your family map.
                    </p>
                  </div>

                  {error && (
                    <div className="bg-rose-50 border border-rose-100 text-rose-700 p-3 rounded-2xl flex items-start gap-2 text-xs">
                      <AlertCircle className="h-4.5 w-4.5 shrink-0 mt-0.5 text-rose-500" />
                      <span>{error}</span>
                    </div>
                  )}

                  <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                      <label htmlFor="login-username" className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                        Username / Email
                      </label>
                      <div className="relative">
                        <User className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-400" />
                        <input
                          id="login-username"
                          name="username"
                          type="text"
                          required
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="e.g. admin"
                          disabled={loading}
                          className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="login-password" className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                        Password
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-400" />
                        <input
                          id="login-password"
                          name="password"
                          type={showPassword ? "text" : "password"}
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          disabled={loading}
                          className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-2xl text-xs uppercase tracking-wider transition shadow-sm"
                    >
                      {loading ? "Signing in..." : "Sign In"}
                    </button>

                    <div className="pt-2 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setStatus("register");
                        }}
                        className="text-xs text-indigo-600 font-bold hover:underline cursor-pointer"
                      >
                        Need an account? Register
                      </button>
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </main>

          <footer className="text-center text-[11px] text-slate-400 font-medium">
            &copy; {new Date().getFullYear()} Yimly Home Core Bridge. All rights reserved.
          </footer>
        </div>
      )}

    </div>
  );
}
