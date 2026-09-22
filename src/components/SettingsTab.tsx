import React, { useEffect, useState, useRef } from "react";
import { UserInfo, Circle } from "../types";
import { PWAInstallButton } from "./PWAInstallButton";
import { CircleSelector } from "./CircleSelector";
import { MAP_STYLES } from "../lib/mapStyles";
import { NavIcon, NavIconPackId, NAV_ICON_PACKS } from "../lib/navIcons";
import {
  User,
  Users,
  Palette,
  Compass,
  Map as MapIcon,
  Clock,
  Bell,
  Shield,
  Smartphone,
  Info,
  ChevronDown,
  Check,
  Upload,
  Trash2,
  Camera,
  RefreshCw,
  AlertCircle,
  Maximize2,
  LogOut,
  HelpCircle,
  Radio,
  Sliders,
  Sparkles,
  Layers,
  Activity,
  Battery,
  ShieldCheck,
  MapPin
} from "lucide-react";

interface SettingsTabProps {
  user: UserInfo | null;
  onLogout: () => void;
  onUserUpdate?: (updated: UserInfo) => void;
  circles?: Circle[];
  selectedCircle?: Circle | null;
  onSelectCircle?: (circle: Circle) => void;
  onCreateCircle?: (name: string) => Promise<void>;
  onJoinCircle?: (code: string) => Promise<void>;
  onLeaveCircle?: (circleId: number) => Promise<void>;
  onDeleteCircle?: (circleId: number) => Promise<void>;
  circlesLoading?: boolean;
  navIconPack?: NavIconPackId;
  onSelectNavIconPack?: (pack: NavIconPackId) => void;
}

const PASTEL_PALETTE = [
  { name: "Soft Lavender", hex: "#E2D9F3" },
  { name: "Rose Quartz", hex: "#FAD2E1" },
  { name: "Peach Puff", hex: "#FDE2E4" },
  { name: "Pale Melon", hex: "#FFF1E6" },
  { name: "Pale Custard", hex: "#FFFCF2" },
  { name: "Mint Foam", hex: "#E2F0CB" },
  { name: "Pale Turquoise", hex: "#C7F9CC" },
  { name: "Powder Green", hex: "#D8F3DC" },
  { name: "Sky Mist", hex: "#D8E2DC" },
  { name: "Baby Blue", hex: "#BEE3DB" },
  { name: "Periwinkle", hex: "#E8ECFB" },
  { name: "Lilac Whisper", hex: "#E8DBFC" },
  { name: "Orchid Petal", hex: "#F3C6F1" },
  { name: "Cotton Candy", hex: "#FFC6FF" },
  { name: "Desert Sage", hex: "#ECE4DB" }
];

interface ConnectedDevice {
  entityId: string;
  name: string;
  battery: string | number;
  lastUpdated: string;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  user,
  onLogout,
  onUserUpdate,
  circles = [],
  selectedCircle = null,
  onSelectCircle,
  onCreateCircle,
  onJoinCircle,
  onLeaveCircle,
  onDeleteCircle,
  circlesLoading = false,
  navIconPack = "classic",
  onSelectNavIconPack
}) => {
  const [devices, setDevices] = useState<ConnectedDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string | null>(user?.avatar_color || null);
  const [savingColor, setSavingColor] = useState(false);
  const [selectedMapStyle, setSelectedMapStyle] = useState<string>(user?.map_style || "osm");
  const [savingMapStyle, setSavingMapStyle] = useState(false);
  const [selectedIconSize, setSelectedIconSize] = useState<number>(user?.map_selected_icon_size || 48);
  const [unselectedIconSize, setUnselectedIconSize] = useState<number>(user?.map_unselected_icon_size || 36);
  const [savingIconSizes, setSavingIconSizes] = useState(false);

  // Profile Picture Upload States
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [deletingPicture, setDeletingPicture] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [pictureSuccess, setPictureSuccess] = useState<string | null>(null);

  // Collapsible Sections State
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    account: true,
    family: true,
    appearance: false,
    navigation: true,
    map: true,
    location: false,
    notifications: false,
    privacy: false,
    devices: false,
    about: false
  });

  // Local Appearance & Notification Preferences
  const [themeMode, setThemeMode] = useState<string>(() => localStorage.getItem("pref_theme") || "light");
  const [density, setDensity] = useState<string>(() => localStorage.getItem("pref_density") || "comfortable");
  const [notifyArrival, setNotifyArrival] = useState<boolean>(() => localStorage.getItem("pref_notify_arrival") !== "false");
  const [notifyBattery, setNotifyBattery] = useState<boolean>(() => localStorage.getItem("pref_notify_battery") !== "false");
  const [notifySound, setNotifySound] = useState<boolean>(() => localStorage.getItem("pref_notify_sound") !== "false");
  const [shareLocation, setShareLocation] = useState<boolean>(() => localStorage.getItem("pref_share_location") !== "false");
  const [historyRangePref, setHistoryRangePref] = useState<string>(() => localStorage.getItem("pref_history_range") || "24h");

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleExpandAll = () => {
    setOpenSections({
      account: true,
      family: true,
      appearance: true,
      navigation: true,
      map: true,
      location: true,
      notifications: true,
      privacy: true,
      devices: true,
      about: true
    });
  };

  const handleCollapseAll = () => {
    setOpenSections({
      account: false,
      family: false,
      appearance: false,
      navigation: false,
      map: false,
      location: false,
      notifications: false,
      privacy: false,
      devices: false,
      about: false
    });
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  useEffect(() => {
    if (user?.avatar_color) {
      setSelectedColor(user.avatar_color);
    }
    if (user?.map_style) {
      setSelectedMapStyle(user.map_style);
    }
    if (user?.map_selected_icon_size) {
      setSelectedIconSize(user.map_selected_icon_size);
    }
    if (user?.map_unselected_icon_size) {
      setUnselectedIconSize(user.map_unselected_icon_size);
    }
  }, [user]);

  const handleUpdateIconSizes = async (newSelected: number, newUnselected: number) => {
    setSelectedIconSize(newSelected);
    setUnselectedIconSize(newUnselected);
    setSavingIconSizes(true);
    const token = localStorage.getItem("access_token");
    if (!token) return;

    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          map_selected_icon_size: newSelected,
          map_unselected_icon_size: newUnselected
        })
      });
      if (res.ok) {
        const updatedUser = await res.json();
        if (onUserUpdate) {
          onUserUpdate(updatedUser);
        }
      }
    } catch (err) {
      console.error("Failed to persist map icon size preferences:", err);
    } finally {
      setSavingIconSizes(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPictureError(null);
    setPictureSuccess(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type.toLowerCase())) {
      setPictureError("Unsupported file format. Please select a JPEG, PNG, or WebP photo.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setPictureError("Image file size exceeds maximum limit of 5MB.");
      return;
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
  };

  const handleCancelPreview = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setPictureError(null);
  };

  const handleUploadPicture = async () => {
    if (!selectedFile) return;

    setUploadingPicture(true);
    setPictureError(null);
    setPictureSuccess(null);

    const token = localStorage.getItem("access_token");
    if (!token) {
      setPictureError("Authentication required.");
      setUploadingPicture(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/auth/profile/picture", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });

      if (res.ok) {
        const updatedUser = await res.json();
        setPictureSuccess("Profile picture updated successfully!");
        handleCancelPreview();
        if (onUserUpdate) {
          onUserUpdate(updatedUser);
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        setPictureError(errorData.detail || "Failed to upload profile picture.");
      }
    } catch (err) {
      setPictureError("Network error uploading profile picture.");
    } finally {
      setUploadingPicture(false);
    }
  };

  const handleRemovePicture = async () => {
    setDeletingPicture(true);
    setPictureError(null);
    setPictureSuccess(null);

    const token = localStorage.getItem("access_token");
    if (!token) {
      setPictureError("Authentication required.");
      setDeletingPicture(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/profile/picture", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (res.ok) {
        const updatedUser = await res.json();
        setPictureSuccess("Profile picture removed. Restored avatar initial.");
        handleCancelPreview();
        if (onUserUpdate) {
          onUserUpdate(updatedUser);
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        setPictureError(errorData.detail || "Failed to remove profile picture.");
      }
    } catch (err) {
      setPictureError("Network error removing profile picture.");
    } finally {
      setDeletingPicture(false);
    }
  };

  const handleSelectMapStyle = async (styleId: string) => {
    setSelectedMapStyle(styleId);
    setSavingMapStyle(true);
    const token = localStorage.getItem("access_token");
    if (!token) return;

    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ map_style: styleId })
      });
      if (res.ok) {
        const updatedUser = await res.json();
        if (onUserUpdate) {
          onUserUpdate(updatedUser);
        }
      }
    } catch (err) {
      console.error("Failed to persist map style preference:", err);
    } finally {
      setSavingMapStyle(false);
    }
  };

  const handleSelectColor = async (colorHex: string) => {
    setSelectedColor(colorHex);
    setSavingColor(true);
    const token = localStorage.getItem("access_token");
    if (!token) return;

    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ avatar_color: colorHex })
      });
      if (res.ok) {
        const updatedUser = await res.json();
        if (onUserUpdate) {
          onUserUpdate(updatedUser);
        }
      }
    } catch (err) {
      console.error("Failed to persist avatar color:", err);
    } finally {
      setSavingColor(false);
    }
  };

  const fetchDevices = async () => {
    setLoading(true);
    const token = localStorage.getItem("access_token");
    if (!token) return;

    try {
      const res = await fetch("/api/states", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        const trackerDevices = data
          .filter((entity: any) => entity.entity_id.startsWith("device_tracker."))
          .map((entity: any) => ({
            entityId: entity.entity_id,
            name: entity.attributes?.friendly_name || entity.entity_id.replace("device_tracker.", ""),
            battery: entity.attributes?.battery_level || "100",
            lastUpdated: new Date(entity.last_updated).toLocaleString()
          }));
        setDevices(trackerDevices);
      }
    } catch (err) {
      console.error("Error retrieving device states:", err);
    } finally {
      setLoading(false);
    }
  };

  const serverOrigin = window.location.origin;

  return (
    <div className="max-w-4xl mx-auto space-y-4 pb-12">
      {/* Top Header & Expand / Collapse Controls */}
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">System Settings</h1>
          <p className="text-xs text-slate-400 font-semibold mt-0.5">
            Manage your account, Family Circles, navigation icon packs, map preferences, and telemetry.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExpandAll}
            className="text-[11px] font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-full shadow-xs transition cursor-pointer"
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={handleCollapseAll}
            className="text-[11px] font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-full shadow-xs transition cursor-pointer"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. ACCOUNT SECTION */}
      {/* ========================================================================= */}
      <div className="bg-white/95 backdrop-blur-2xl rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] overflow-hidden transition-all duration-200">
        <button
          type="button"
          onClick={() => toggleSection("account")}
          className="w-full p-6 sm:p-7 flex items-center justify-between text-left hover:bg-slate-50/50 transition cursor-pointer select-none"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-600 shrink-0 shadow-xs">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-800">Account</h2>
                <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100/60">
                  {user?.display_name || "Profile"}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">
                Profile details, avatar photo, and pastel ring accents
              </p>
            </div>
          </div>
          <div
            className={`w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 transition-transform duration-200 shrink-0 ${
              openSections.account ? "rotate-180 bg-slate-200/80 text-slate-800" : ""
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </button>

        {openSections.account && (
          <div className="px-6 pb-7 sm:px-8 sm:pb-8 pt-1 border-t border-slate-100/60 space-y-6">
            {/* Profile Info Summary Header */}
            <div className="p-5 rounded-2xl bg-slate-50/50 border border-slate-100/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-2">
              <div className="flex items-center gap-4">
                <div
                  className="h-16 w-16 text-white font-extrabold text-xl rounded-full flex items-center justify-center select-none shadow-sm transition-all duration-300 relative overflow-hidden shrink-0"
                  style={{
                    backgroundColor: selectedColor || "#4f46e5",
                    border: "3px solid white",
                    boxShadow: `0 0 0 3px ${selectedColor || "#4f46e5"}`
                  }}
                >
                  {previewUrl || user?.profile_picture_url ? (
                    <img
                      src={previewUrl || user?.profile_picture_url || ""}
                      alt={user?.display_name || "Profile"}
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : user?.display_name ? (
                    user.display_name.charAt(0).toUpperCase()
                  ) : (
                    "U"
                  )}
                </div>
                <div>
                  <p className="text-base font-bold text-slate-800">{user?.display_name}</p>
                  <p className="text-xs text-slate-400 font-bold mt-0.5">Username: {user?.username}</p>
                  {user?.profile_picture_url && !previewUrl && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-bold mt-1">
                      <Check className="w-3 h-3" /> Photo Saved
                    </span>
                  )}
                </div>
              </div>
              <div>
                <span className="inline-flex items-center rounded-lg bg-indigo-50 px-3 py-1 text-[10px] font-extrabold text-indigo-700 ring-1 ring-inset ring-indigo-700/10 uppercase tracking-wider">
                  Administrator
                </span>
              </div>
            </div>

            {/* Profile Picture Upload Section */}
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-indigo-600" />
                  Profile Photo
                </h3>
                <p className="text-[11px] text-slate-400 font-semibold mt-0.5 leading-relaxed">
                  Upload a photo to represent yourself on the live map and Family Circles. Photos are securely stored on the server.
                </p>
              </div>

              {pictureError && (
                <div className="p-3 rounded-2xl bg-rose-50 border border-rose-100 flex items-center gap-2 text-rose-700 text-xs font-bold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{pictureError}</span>
                </div>
              )}

              {pictureSuccess && (
                <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center gap-2 text-emerald-700 text-xs font-bold">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>{pictureSuccess}</span>
                </div>
              )}

              <input
                type="file"
                ref={fileInputRef}
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
              />

              <div className="flex flex-wrap items-center gap-3">
                {!previewUrl ? (
                  <>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {user?.profile_picture_url ? "Replace Photo" : "Upload Photo"}
                    </button>

                    {user?.profile_picture_url && (
                      <button
                        type="button"
                        onClick={handleRemovePicture}
                        disabled={deletingPicture}
                        className="flex items-center gap-2 px-4 py-2 bg-rose-50 hover:bg-rose-100/80 active:bg-rose-200 text-rose-700 border border-rose-100 rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50"
                      >
                        {deletingPicture ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                        )}
                        Remove Photo
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleUploadPicture}
                      disabled={uploadingPicture}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer disabled:opacity-50"
                    >
                      {uploadingPicture ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      Save New Photo
                    </button>

                    <button
                      type="button"
                      onClick={handleCancelPreview}
                      disabled={uploadingPicture}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      Cancel
                    </button>
                  </>
                )}

                <span className="text-[10px] text-slate-400 font-bold">
                  Supported: JPEG, PNG, WebP (Max 5MB)
                </span>
              </div>
            </div>

            {/* Avatar Ring Color Picker */}
            <div className="border-t border-slate-100/80 pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-700">Customize Avatar Ring Accent</h3>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                    Select a pastel theme to border your photo or avatar initial across all devices.
                  </p>
                </div>
                {savingColor && (
                  <span className="text-[10px] font-bold text-indigo-600 animate-pulse">
                    Saving accent...
                  </span>
                )}
              </div>

              <div className="grid grid-cols-5 gap-2.5 sm:grid-cols-8 md:grid-cols-15 pt-1">
                {PASTEL_PALETTE.map((item) => {
                  const isSelected = selectedColor === item.hex;
                  return (
                    <button
                      key={item.hex}
                      type="button"
                      title={item.name}
                      onClick={() => handleSelectColor(item.hex)}
                      className="relative h-8 w-8 rounded-full border cursor-pointer transition-all duration-200 hover:scale-110 active:scale-95 flex items-center justify-center shadow-sm"
                      style={{
                        backgroundColor: item.hex,
                        borderColor: isSelected ? "#4f46e5" : "rgba(0,0,0,0.06)",
                        borderWidth: isSelected ? "2px" : "1px",
                        boxShadow: isSelected ? `0 0 8px ${item.hex}` : "none"
                      }}
                    >
                      {isSelected && (
                        <div className="w-1.5 h-1.5 bg-slate-700 rounded-full" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 2. FAMILY / CIRCLE SECTION */}
      {/* ========================================================================= */}
      <div className="bg-white/95 backdrop-blur-2xl rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] overflow-hidden transition-all duration-200">
        <button
          type="button"
          onClick={() => toggleSection("family")}
          className="w-full p-6 sm:p-7 flex items-center justify-between text-left hover:bg-slate-50/50 transition cursor-pointer select-none"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-600 shrink-0 shadow-xs">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-800">Family / Circle</h2>
                {selectedCircle && (
                  <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100/60">
                    {selectedCircle.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">
                Switch active circles, share invite codes, create and manage family groups
              </p>
            </div>
          </div>
          <div
            className={`w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 transition-transform duration-200 shrink-0 ${
              openSections.family ? "rotate-180 bg-slate-200/80 text-slate-800" : ""
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </button>

        {openSections.family && (
          <div className="px-6 pb-7 sm:px-8 sm:pb-8 pt-1 border-t border-slate-100/60 space-y-4">
            <p className="text-xs text-slate-400 font-semibold leading-relaxed pt-2">
              Family Circles allow your loved ones to securely share live location telemetry, place alerts, and status.
            </p>

            {onSelectCircle && onCreateCircle && onJoinCircle ? (
              <div className="pt-1">
                <CircleSelector
                  user={user}
                  circles={circles}
                  selectedCircle={selectedCircle}
                  onSelectCircle={onSelectCircle}
                  onCreateCircle={onCreateCircle}
                  onJoinCircle={onJoinCircle}
                  onLeaveCircle={onLeaveCircle}
                  onDeleteCircle={onDeleteCircle}
                  loading={circlesLoading}
                />
              </div>
            ) : (
              <p className="text-xs text-slate-400">Circle management available when signed in.</p>
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 3. APPEARANCE SECTION */}
      {/* ========================================================================= */}
      <div className="bg-white/95 backdrop-blur-2xl rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] overflow-hidden transition-all duration-200">
        <button
          type="button"
          onClick={() => toggleSection("appearance")}
          className="w-full p-6 sm:p-7 flex items-center justify-between text-left hover:bg-slate-50/50 transition cursor-pointer select-none"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-600 shrink-0 shadow-xs">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-800">Appearance</h2>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full capitalize">
                  {themeMode}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">
                Application theme, density, and frosted glass visual styling
              </p>
            </div>
          </div>
          <div
            className={`w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 transition-transform duration-200 shrink-0 ${
              openSections.appearance ? "rotate-180 bg-slate-200/80 text-slate-800" : ""
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </button>

        {openSections.appearance && (
          <div className="px-6 pb-7 sm:px-8 sm:pb-8 pt-1 border-t border-slate-100/60 space-y-6">
            {/* Color Theme Selector */}
            <div className="space-y-3 pt-2">
              <div>
                <h3 className="text-xs font-bold text-slate-800">Color Theme</h3>
                <p className="text-[11px] text-slate-400 font-semibold mt-0.5">
                  Choose your preferred contrast and aesthetic mode.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { id: "light", name: "Clean Light", desc: "Crisp white canvas with soft frosted glass" },
                  { id: "system", name: "System Dynamic", desc: "Adapts automatically to device settings" },
                  { id: "tinted", name: "Subtle Twilight", desc: "Soft low-contrast ambient dark preview" }
                ].map((t) => {
                  const isSelected = themeMode === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setThemeMode(t.id);
                        localStorage.setItem("pref_theme", t.id);
                      }}
                      className={`p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? "border-indigo-500 bg-indigo-50/30 ring-2 ring-indigo-500/20 shadow-sm"
                          : "border-slate-100 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-200"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-800">{t.name}</span>
                        {isSelected ? (
                          <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border border-slate-200 bg-white" />
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 font-semibold">{t.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Layout Density */}
            <div className="border-t border-slate-100/80 pt-5 space-y-3">
              <div>
                <h3 className="text-xs font-bold text-slate-800">Layout Density</h3>
                <p className="text-[11px] text-slate-400 font-semibold mt-0.5">
                  Controls spacing of member list cards and popups.
                </p>
              </div>

              <div className="flex items-center gap-3">
                {[
                  { id: "comfortable", label: "Comfortable (Default)" },
                  { id: "compact", label: "High Density Compact" }
                ].map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      setDensity(d.id);
                      localStorage.setItem("pref_density", d.id);
                    }}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer border ${
                      density === d.id
                        ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                        : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 4. NAVIGATION SECTION (ICON PACKS WITH LIVE PREVIEW) */}
      {/* ========================================================================= */}
      <div className="bg-white/95 backdrop-blur-2xl rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] overflow-hidden transition-all duration-200">
        <button
          type="button"
          onClick={() => toggleSection("navigation")}
          className="w-full p-6 sm:p-7 flex items-center justify-between text-left hover:bg-slate-50/50 transition cursor-pointer select-none"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-600 shrink-0 shadow-xs">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-800">Navigation</h2>
                <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100/60 uppercase tracking-wide">
                  Pack: {NAV_ICON_PACKS.find((p) => p.id === navIconPack)?.name || "Classic"}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">
                5 distinct navigation icon styles with instant dock preview and live application
              </p>
            </div>
          </div>
          <div
            className={`w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 transition-transform duration-200 shrink-0 ${
              openSections.navigation ? "rotate-180 bg-slate-200/80 text-slate-800" : ""
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </button>

        {openSections.navigation && (
          <div className="px-6 pb-7 sm:px-8 sm:pb-8 pt-1 border-t border-slate-100/60 space-y-4">
            <div className="pt-2">
              <h3 className="text-xs font-bold text-slate-800">Select Navigation Icon Pack</h3>
              <p className="text-xs text-slate-400 font-semibold mt-0.5 leading-relaxed">
                Choose between 5 bespoke navigation styles. Your selection updates the bottom mobile navigation dock and desktop bar immediately.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 pt-1">
              {NAV_ICON_PACKS.map((pack) => {
                const isSelected = navIconPack === pack.id;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => onSelectNavIconPack && onSelectNavIconPack(pack.id)}
                    className={`p-4 sm:p-5 rounded-2xl border text-left transition-all duration-200 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-50/25 ring-2 ring-indigo-500/20 shadow-sm"
                        : "border-slate-100 bg-slate-50/40 hover:bg-slate-50 hover:border-slate-200"
                    }`}
                  >
                    {/* Left: Pack Name & Description */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded-full flex items-center justify-center border transition ${
                            isSelected
                              ? "border-indigo-600 bg-indigo-600 text-white"
                              : "border-slate-300 bg-white"
                          }`}
                        >
                          {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                        <span className="text-sm font-bold text-slate-800">{pack.name}</span>
                        {isSelected && (
                          <span className="text-[10px] font-extrabold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-full">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 font-semibold pl-6">{pack.description}</p>
                    </div>

                    {/* Right: Live Preview Dock */}
                    <div className="flex items-center gap-2 sm:gap-3 bg-white/90 backdrop-blur-md px-3.5 py-2 rounded-full border border-slate-200/70 shadow-xs self-start md:self-auto shrink-0">
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mr-1">
                        Preview
                      </span>
                      {(["map", "people", "places", "alerts", "settings"] as const).map((tab) => (
                        <div
                          key={tab}
                          className={`p-1.5 rounded-full transition flex items-center justify-center ${
                            tab === "map"
                              ? isSelected
                                ? "bg-slate-900 text-white shadow-xs"
                                : "bg-slate-100 text-slate-800"
                              : "text-slate-500 hover:text-slate-800"
                          }`}
                          title={`${pack.name} - ${tab}`}
                        >
                          <NavIcon tab={tab} pack={pack.id} isSelected={tab === "map"} className="w-4 h-4" />
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 5. MAP SECTION (TILES & ICON SIZING) */}
      {/* ========================================================================= */}
      <div className="bg-white/95 backdrop-blur-2xl rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] overflow-hidden transition-all duration-200">
        <button
          type="button"
          onClick={() => toggleSection("map")}
          className="w-full p-6 sm:p-7 flex items-center justify-between text-left hover:bg-slate-50/50 transition cursor-pointer select-none"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-600 shrink-0 shadow-xs">
              <MapIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-800">Map</h2>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full uppercase">
                  {selectedMapStyle}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">
                Map tile providers, icon sizing sliders, and live marker preview
              </p>
            </div>
          </div>
          <div
            className={`w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 transition-transform duration-200 shrink-0 ${
              openSections.map ? "rotate-180 bg-slate-200/80 text-slate-800" : ""
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </button>

        {openSections.map && (
          <div className="px-6 pb-7 sm:px-8 sm:pb-8 pt-1 border-t border-slate-100/60 space-y-6">
            {/* Map Tile Style Selector */}
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-800">Map Tile Style</h3>
                  <p className="text-xs text-slate-400 font-semibold mt-0.5 leading-relaxed">
                    Select your preferred tile map style. This preference is stored directly in your Yimly Home Core account data on the server.
                  </p>
                </div>
                {savingMapStyle && (
                  <span className="text-[10px] font-bold text-indigo-600 animate-pulse">
                    Saving preference...
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {MAP_STYLES.map((style) => {
                  const isSelected = selectedMapStyle === style.id;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => handleSelectMapStyle(style.id)}
                      className={`p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer relative flex flex-col justify-between ${
                        isSelected
                          ? "border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20 shadow-sm"
                          : "border-slate-100 bg-slate-50/40 hover:bg-slate-50 hover:border-slate-200"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${style.previewBg}`}>
                          {style.name}
                        </span>
                        {isSelected ? (
                          <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-sm">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border border-slate-200 bg-white" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800">{style.name}</p>
                        <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{style.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Map Location Icons Sizing */}
            <div className="border-t border-slate-100/80 pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Maximize2 className="w-4 h-4 text-indigo-600" />
                    Map Location Icons Size
                  </h3>
                  <p className="text-xs text-slate-400 font-semibold mt-0.5 leading-relaxed">
                    Independently customize the pixel size of selected and unselected member location icons on the map. Changes are saved server-side and update the map immediately.
                  </p>
                </div>
                {savingIconSizes && (
                  <span className="text-[10px] font-bold text-indigo-600 animate-pulse">
                    Saving sizes...
                  </span>
                )}
              </div>

              {/* Sliders Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-1">
                {/* Selected Member Icon Slider */}
                <div className="p-5 rounded-2xl bg-slate-50/60 border border-slate-100/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <label htmlFor="selected-icon-slider" className="text-xs font-bold text-slate-700">
                      Selected Member Icon
                    </label>
                    <span className="text-xs font-extrabold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-100/50">
                      {selectedIconSize} px
                    </span>
                  </div>

                  <input
                    id="selected-icon-slider"
                    type="range"
                    min="24"
                    max="72"
                    step="1"
                    value={selectedIconSize}
                    onChange={(e) => handleUpdateIconSizes(Number(e.target.value), unselectedIconSize)}
                    className="w-full accent-indigo-600 h-2 bg-slate-200/80 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 font-bold">
                    <span>Small (24px)</span>
                    <span>Default (48px)</span>
                    <span>Large (72px)</span>
                  </div>
                </div>

                {/* Unselected Member Icon Slider */}
                <div className="p-5 rounded-2xl bg-slate-50/60 border border-slate-100/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <label htmlFor="unselected-icon-slider" className="text-xs font-bold text-slate-700">
                      Unselected Member Icon
                    </label>
                    <span className="text-xs font-extrabold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200/60">
                      {unselectedIconSize} px
                    </span>
                  </div>

                  <input
                    id="unselected-icon-slider"
                    type="range"
                    min="24"
                    max="72"
                    step="1"
                    value={unselectedIconSize}
                    onChange={(e) => handleUpdateIconSizes(selectedIconSize, Number(e.target.value))}
                    className="w-full accent-slate-700 h-2 bg-slate-200/80 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 font-bold">
                    <span>Small (24px)</span>
                    <span>Default (36px)</span>
                    <span>Large (72px)</span>
                  </div>
                </div>
              </div>

              {/* Live Visual Marker Preview */}
              <div className="border-t border-slate-100 pt-4 space-y-2">
                <span className="text-xs font-bold text-slate-700 block">Live Map Icon Preview</span>
                <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100/70 border border-slate-200/60 flex flex-wrap items-center justify-around gap-6">
                  {/* Selected Marker Preview */}
                  <div className="flex flex-col items-center gap-2">
                    <div
                      className="relative flex items-center justify-center transition-all duration-200"
                      style={{
                        width: `${Math.round(selectedIconSize * 1.25)}px`,
                        height: `${Math.round(selectedIconSize * 1.25)}px`
                      }}
                    >
                      <div
                        className="absolute rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.round(selectedIconSize * 1.25)}px`,
                          height: `${Math.round(selectedIconSize * 1.25)}px`,
                          backgroundColor: selectedColor || "#4f46e5",
                          opacity: 0.35,
                          transform: "scale(1.2)"
                        }}
                      />
                      <div
                        className="relative rounded-full border-2 sm:border-[3px] border-white shadow-lg flex items-center justify-center font-extrabold text-white overflow-hidden transition-all duration-200"
                        style={{
                          width: `${selectedIconSize}px`,
                          height: `${selectedIconSize}px`,
                          backgroundColor: selectedColor || "#4f46e5",
                          fontSize: `${Math.max(10, Math.floor(selectedIconSize * 0.38))}px`
                        }}
                      >
                        {user?.profile_picture_url ? (
                          <img
                            src={user.profile_picture_url}
                            alt={user.display_name}
                            className="w-full h-full object-cover rounded-full"
                          />
                        ) : (
                          (user?.display_name || "U").charAt(0).toUpperCase()
                        )}
                      </div>
                      <div
                        className="absolute bottom-[-2px] w-0 h-0 border-solid"
                        style={{
                          borderLeftWidth: `${Math.max(4, Math.round(selectedIconSize * 0.15))}px`,
                          borderLeftColor: "transparent",
                          borderRightWidth: `${Math.max(4, Math.round(selectedIconSize * 0.15))}px`,
                          borderRightColor: "transparent",
                          borderTopWidth: `${Math.max(4, Math.round(selectedIconSize * 0.15))}px`,
                          borderTopColor: "white",
                          filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.15))"
                        }}
                      />
                    </div>
                    <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                      Selected ({selectedIconSize}px)
                    </span>
                  </div>

                  {/* Unselected Marker Preview */}
                  <div className="flex flex-col items-center gap-2">
                    <div
                      className="relative flex items-center justify-center transition-all duration-200"
                      style={{
                        width: `${Math.round(unselectedIconSize * 1.25)}px`,
                        height: `${Math.round(unselectedIconSize * 1.25)}px`
                      }}
                    >
                      <div
                        className="absolute rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.round(unselectedIconSize * 1.25)}px`,
                          height: `${Math.round(unselectedIconSize * 1.25)}px`,
                          backgroundColor: selectedColor || "#4f46e5",
                          opacity: 0.2,
                          transform: "scale(1.0)"
                        }}
                      />
                      <div
                        className="relative rounded-full border-2 sm:border-[3px] border-white shadow-md flex items-center justify-center font-extrabold text-white overflow-hidden transition-all duration-200"
                        style={{
                          width: `${unselectedIconSize}px`,
                          height: `${unselectedIconSize}px`,
                          backgroundColor: selectedColor || "#4f46e5",
                          fontSize: `${Math.max(10, Math.floor(unselectedIconSize * 0.38))}px`
                        }}
                      >
                        {user?.profile_picture_url ? (
                          <img
                            src={user.profile_picture_url}
                            alt={user.display_name}
                            className="w-full h-full object-cover rounded-full"
                          />
                        ) : (
                          (user?.display_name || "U").charAt(0).toUpperCase()
                        )}
                      </div>
                      <div
                        className="absolute bottom-[-2px] w-0 h-0 border-solid"
                        style={{
                          borderLeftWidth: `${Math.max(4, Math.round(unselectedIconSize * 0.15))}px`,
                          borderLeftColor: "transparent",
                          borderRightWidth: `${Math.max(4, Math.round(unselectedIconSize * 0.15))}px`,
                          borderRightColor: "transparent",
                          borderTopWidth: `${Math.max(4, Math.round(unselectedIconSize * 0.15))}px`,
                          borderTopColor: "white",
                          filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.15))"
                        }}
                      />
                    </div>
                    <span className="text-[11px] font-bold text-slate-600 bg-white px-2 py-0.5 rounded-full border border-slate-200">
                      Unselected ({unselectedIconSize}px)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 6. LOCATION & HISTORY SECTION */}
      {/* ========================================================================= */}
      <div className="bg-white/95 backdrop-blur-2xl rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] overflow-hidden transition-all duration-200">
        <button
          type="button"
          onClick={() => toggleSection("location")}
          className="w-full p-6 sm:p-7 flex items-center justify-between text-left hover:bg-slate-50/50 transition cursor-pointer select-none"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-600 shrink-0 shadow-xs">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Location & History</h2>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">
                Telemetry polling frequency, historical path breadcrumbs, and retention
              </p>
            </div>
          </div>
          <div
            className={`w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 transition-transform duration-200 shrink-0 ${
              openSections.location ? "rotate-180 bg-slate-200/80 text-slate-800" : ""
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </button>

        {openSections.location && (
          <div className="px-6 pb-7 sm:px-8 sm:pb-8 pt-1 border-t border-slate-100/60 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-2xl bg-slate-50/60 border border-slate-100 space-y-1">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-emerald-600" />
                  Live Sync Rate
                </span>
                <p className="text-xs text-slate-500 font-semibold">15 seconds automatic loop</p>
                <p className="text-[10px] text-slate-400">
                  Background polling synchronizes member positions with minimal battery impact.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50/60 border border-slate-100 space-y-1">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-indigo-600" />
                  History Retention
                </span>
                <p className="text-xs text-slate-500 font-semibold">7 Days of Path Telemetry</p>
                <p className="text-[10px] text-slate-400">
                  Historical routes are saved with GPS timestamps and motion indicators.
                </p>
              </div>
            </div>

            {/* Default History Timespan Preference */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">Default History Quick Range</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "today", label: "Today" },
                  { id: "24h", label: "Last 24 Hours" },
                  { id: "7d", label: "Past 7 Days" },
                  { id: "custom", label: "Custom Date Range" }
                ].map((range) => (
                  <button
                    key={range.id}
                    type="button"
                    onClick={() => {
                      setHistoryRangePref(range.id);
                      localStorage.setItem("pref_history_range", range.id);
                    }}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
                      historyRangePref === range.id
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                        : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 7. NOTIFICATIONS SECTION */}
      {/* ========================================================================= */}
      <div className="bg-white/95 backdrop-blur-2xl rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] overflow-hidden transition-all duration-200">
        <button
          type="button"
          onClick={() => toggleSection("notifications")}
          className="w-full p-6 sm:p-7 flex items-center justify-between text-left hover:bg-slate-50/50 transition cursor-pointer select-none"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-600 shrink-0 shadow-xs">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Notifications</h2>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">
                Geofence zone alerts, arrival/departure chimes, and battery warnings
              </p>
            </div>
          </div>
          <div
            className={`w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 transition-transform duration-200 shrink-0 ${
              openSections.notifications ? "rotate-180 bg-slate-200/80 text-slate-800" : ""
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </button>

        {openSections.notifications && (
          <div className="px-6 pb-7 sm:px-8 sm:pb-8 pt-1 border-t border-slate-100/60 space-y-4">
            <div className="space-y-3 pt-2">
              {/* Arrival / Departure */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50/60 border border-slate-100">
                <div>
                  <p className="text-xs font-bold text-slate-800">Place Arrival & Departure Alerts</p>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                    Notify when circle members enter or leave registered zones (Home, School, Work).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newVal = !notifyArrival;
                    setNotifyArrival(newVal);
                    localStorage.setItem("pref_notify_arrival", String(newVal));
                  }}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    notifyArrival ? "bg-indigo-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`block w-4 h-4 bg-white rounded-full shadow-xs transition-transform transform ${
                      notifyArrival ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Low Battery Warning */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50/60 border border-slate-100">
                <div>
                  <p className="text-xs font-bold text-slate-800">Low Battery Warnings</p>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                    Alert family members when your device battery dips below 20%.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newVal = !notifyBattery;
                    setNotifyBattery(newVal);
                    localStorage.setItem("pref_notify_battery", String(newVal));
                  }}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    notifyBattery ? "bg-indigo-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`block w-4 h-4 bg-white rounded-full shadow-xs transition-transform transform ${
                      notifyBattery ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* In-App Chime Sound */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50/60 border border-slate-100">
                <div>
                  <p className="text-xs font-bold text-slate-800">In-App Notification Sounds</p>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                    Play a gentle audio ping when new alerts arrive in your feed.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newVal = !notifySound;
                    setNotifySound(newVal);
                    localStorage.setItem("pref_notify_sound", String(newVal));
                  }}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    notifySound ? "bg-indigo-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`block w-4 h-4 bg-white rounded-full shadow-xs transition-transform transform ${
                      notifySound ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 8. PRIVACY SECTION */}
      {/* ========================================================================= */}
      <div className="bg-white/95 backdrop-blur-2xl rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] overflow-hidden transition-all duration-200">
        <button
          type="button"
          onClick={() => toggleSection("privacy")}
          className="w-full p-6 sm:p-7 flex items-center justify-between text-left hover:bg-slate-50/50 transition cursor-pointer select-none"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-600 shrink-0 shadow-xs">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Privacy & Security</h2>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">
                Location sharing status, end-to-end local bridge, and data isolation
              </p>
            </div>
          </div>
          <div
            className={`w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 transition-transform duration-200 shrink-0 ${
              openSections.privacy ? "rotate-180 bg-slate-200/80 text-slate-800" : ""
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </button>

        {openSections.privacy && (
          <div className="px-6 pb-7 sm:px-8 sm:pb-8 pt-1 border-t border-slate-100/60 space-y-4">
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50/60 border border-slate-100">
                <div>
                  <p className="text-xs font-bold text-slate-800">Share Live Location with Circle</p>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                    Toggle to temporarily pause broadcasting your GPS position to circle members.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newVal = !shareLocation;
                    setShareLocation(newVal);
                    localStorage.setItem("pref_share_location", String(newVal));
                  }}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    shareLocation ? "bg-emerald-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`block w-4 h-4 bg-white rounded-full shadow-xs transition-transform transform ${
                      shareLocation ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-100/80 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-emerald-900">Direct Home Assistant Local Bridge</p>
                  <p className="text-[11px] text-emerald-700 mt-0.5 leading-relaxed font-semibold">
                    Your location telemetry communicates strictly with your local Yimly Home Core server. Your coordinates are never sent to third-party ad brokers or external cloud tracking networks.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 9. DEVICES SECTION (COMPANION APP GUIDE & CONNECTED DEVICES) */}
      {/* ========================================================================= */}
      <div className="bg-white/95 backdrop-blur-2xl rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] overflow-hidden transition-all duration-200">
        <button
          type="button"
          onClick={() => toggleSection("devices")}
          className="w-full p-6 sm:p-7 flex items-center justify-between text-left hover:bg-slate-50/50 transition cursor-pointer select-none"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-600 shrink-0 shadow-xs">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-800">Devices</h2>
                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                  {devices.length} Paired
                </span>
              </div>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">
                Connected companion telemetry units and Home Assistant pairing guide
              </p>
            </div>
          </div>
          <div
            className={`w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 transition-transform duration-200 shrink-0 ${
              openSections.devices ? "rotate-180 bg-slate-200/80 text-slate-800" : ""
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </button>

        {openSections.devices && (
          <div className="px-6 pb-7 sm:px-8 sm:pb-8 pt-1 border-t border-slate-100/60 space-y-6">
            {/* Connected Telemetry Units List */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800">
                  Your Connected Devices ({devices.length})
                </h3>
                <button
                  type="button"
                  onClick={fetchDevices}
                  disabled={loading}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

              {loading ? (
                <p className="text-xs text-slate-400 font-semibold">Loading companion telemetry units...</p>
              ) : devices.length === 0 ? (
                <div className="p-5 rounded-2xl bg-slate-50/50 border border-slate-100/60 text-center">
                  <p className="text-xs font-bold text-slate-600">No active tracking units paired yet</p>
                  <p className="text-[10px] text-slate-400 font-semibold mt-1">
                    Follow the companion guide below to sync device telemetry.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {devices.map((device) => (
                    <div
                      key={device.entityId}
                      className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100/60 flex items-center justify-between"
                    >
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-slate-800">{device.name}</p>
                        <p className="text-[9px] text-slate-400 font-mono font-semibold">{device.entityId}</p>
                      </div>
                      <div className="text-right space-y-0.5">
                        <span className="text-xs text-slate-700 font-bold flex items-center justify-end gap-1">
                          <Battery className="w-3.5 h-3.5 text-emerald-600" />
                          {device.battery}%
                        </span>
                        <p className="text-[9px] text-slate-400 font-semibold">Updated: {device.lastUpdated}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Companion App Registration Guide */}
            <div className="border-t border-slate-100/80 pt-5 space-y-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold text-slate-800">
                  Home Assistant Companion App Setup
                </h3>
              </div>

              <p className="text-xs text-slate-400 font-semibold leading-relaxed">
                Yimly Home uses standard, production-hardened Home Assistant companion app protocols. You can connect the official Companion App directly to this bridge.
              </p>

              <div className="p-4 rounded-2xl bg-slate-50/60 border border-slate-100 space-y-3">
                <div>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">
                    1. Server Address
                  </span>
                  <input
                    type="text"
                    readOnly
                    value={serverOrigin}
                    className="w-full px-4 py-2 bg-white border border-slate-200/70 rounded-xl text-xs font-mono text-indigo-600 select-all shadow-xs focus:outline-none"
                  />
                </div>
                <div>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">
                    2. Credentials
                  </span>
                  <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                    Use your Yimly account credentials (<strong className="text-slate-700 font-bold">{user?.username}</strong>) and password directly. No extra token setup required!
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 10. ABOUT SECTION (VERSION, PWA INSTALL & SIGN OUT) */}
      {/* ========================================================================= */}
      <div className="bg-white/95 backdrop-blur-2xl rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] overflow-hidden transition-all duration-200">
        <button
          type="button"
          onClick={() => toggleSection("about")}
          className="w-full p-6 sm:p-7 flex items-center justify-between text-left hover:bg-slate-50/50 transition cursor-pointer select-none"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100/50 flex items-center justify-center text-indigo-600 shrink-0 shadow-xs">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-800">About</h2>
                <span className="text-[10px] font-extrabold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                  v1.4.0
                </span>
              </div>
              <p className="text-xs text-slate-400 font-semibold mt-0.5">
                Application version, PWA offline installation, and account session controls
              </p>
            </div>
          </div>
          <div
            className={`w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 transition-transform duration-200 shrink-0 ${
              openSections.about ? "rotate-180 bg-slate-200/80 text-slate-800" : ""
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </button>

        {openSections.about && (
          <div className="px-6 pb-7 sm:px-8 sm:pb-8 pt-1 border-t border-slate-100/60 space-y-5">
            <div className="p-4 rounded-2xl bg-slate-50/60 border border-slate-100 space-y-1.5 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">Yimly Home Core</span>
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100">
                  Direct Bridge Active
                </span>
              </div>
              <p className="text-xs text-slate-400 font-semibold">
                High-performance private location sharing and family safety telemetry platform.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-1">
              <PWAInstallButton />

              <button
                type="button"
                onClick={onLogout}
                className="flex items-center justify-center gap-2 rounded-2xl bg-rose-50 hover:bg-rose-100/80 active:bg-rose-200 text-rose-700 font-bold px-4 py-2.5 text-xs transition border border-rose-100/40 shadow-xs cursor-pointer"
              >
                <LogOut className="w-4 h-4 text-rose-500" />
                Sign Out of Account
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
