import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion } from "motion/react";
import * as maplibregl from "maplibre-gl";
import { CircleMember, LocationHistoryItem } from "../types";
import { getMapStyle } from "../lib/mapStyles";
import { 
  MapPin, 
  RefreshCw, 
  Plus, 
  Minus, 
  Navigation, 
  History, 
  Smartphone, 
  Battery, 
  Clock, 
  X,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Check,
  AlertCircle,
  Eye,
  EyeOff
} from "lucide-react";

interface MapComponentProps {
  members: CircleMember[];
  onRefresh: () => void;
  loading: boolean;
  mapStyle?: string | null;
  selectedIconSize?: number | null;
  unselectedIconSize?: number | null;
  selectedMemberId?: number | null;
  onSelectMemberId?: (id: number | null) => void;
}

export type RangePresetId = 'today' | 'week' | 'month';

export interface ActiveRangeConfig {
  type: 'preset' | 'custom';
  presetId?: string; // 'today' | 'week' | 'month'
  hours?: number | null;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  label: string; // e.g. "Today", "Week", "Month", "Custom: 18 Sep – 21 Sep"
}

export interface RangePreset {
  id: RangePresetId;
  label: string;
  hours: number;
}

export const PRESET_RANGES: RangePreset[] = [
  { id: "today", label: "Today", hours: 24 },
  { id: "week", label: "Week", hours: 168 },
  { id: "month", label: "Month", hours: 720 },
];

function toDateInputValue(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCustomRangeLabel(startStr: string, endStr: string): string {
  const parts1 = startStr.split("-");
  const parts2 = endStr.split("-");
  if (parts1.length === 3 && parts2.length === 3) {
    const d1 = new Date(Number(parts1[0]), Number(parts1[1]) - 1, Number(parts1[2]));
    const d2 = new Date(Number(parts2[0]), Number(parts2[1]) - 1, Number(parts2[2]));
    const s1 = d1.toLocaleDateString("en-US", { day: "numeric", month: "short" });
    const s2 = d2.toLocaleDateString("en-US", { day: "numeric", month: "short" });
    if (startStr === endStr) {
      return `Custom: ${s1}`;
    }
    return `Custom: ${s1} – ${s2}`;
  }
  return `Custom: ${startStr} – ${endStr}`;
}

/**
 * Calculates a smooth color gradient along the member's journey based on their saved pastel avatar color.
 * 
 * EARLIEST HISTORY (progress = 0.0):
 * -> softer / lighter version of the member's pastel colour
 * 
 * MIDDLE OF JOURNEY (progress = 0.5):
 * -> progressively deeper version
 * 
 * LATEST / NEWEST HISTORY (progress = 1.0):
 * -> darker matching version of the member's pastel colour
 * 
 * Strictly preserves the exact same color family (hue) throughout the entire journey.
 */
function getRouteGradientColor(hexColor?: string | null, progress: number = 1.0): string {
  if (!hexColor || !hexColor.startsWith("#")) return "#3730a3";
  let hex = hexColor.replace("#", "");
  if (hex.length === 3) {
    hex = hex.split("").map((c) => c + c).join("");
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / d + 2;
        break;
      case bNorm:
        h = (rNorm - gNorm) / d + 4;
        break;
    }
    h /= 6;
  }

  // Clamped progress between 0 (oldest/earliest) and 1 (latest/newest)
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Earliest / oldest history endpoint: soft, subtle light pastel in the same hue
  const lightL = Math.min(0.85, Math.max(0.76, l * 1.15));
  const lightS = Math.min(0.55, Math.max(0.35, s * 0.85));

  // Latest / newest history endpoint: slightly deeper matching pastel (NOT dark or harsh)
  const darkL = Math.min(0.52, Math.max(0.42, l * 0.72));
  const darkS = Math.min(0.70, Math.max(0.48, s * 1.10));

  // Smooth low-contrast interpolation along the journey timeline
  const targetL = lightL + (darkL - lightL) * clampedProgress;
  const targetS = lightS + (darkS - lightS) * clampedProgress;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = targetL < 0.5 ? targetL * (1 + targetS) : targetL + targetS - targetL * targetS;
  const p = 2 * targetL - q;
  const resR = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const resG = Math.round(hue2rgb(p, q, h) * 255);
  const resB = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

  return `#${resR.toString(16).padStart(2, "0")}${resG.toString(16).padStart(2, "0")}${resB.toString(16).padStart(2, "0")}`;
}

function getDarkerRouteColor(hexColor?: string | null): string {
  return getRouteGradientColor(hexColor, 1.0);
}

function getSubtleTintStyle(hexColor?: string | null): string {
  if (!hexColor) return "rgba(255, 255, 255, 0.9)";
  let hex = hexColor.replace("#", "");
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  const r = parseInt(hex.substring(0, 2), 16) || 79;
  const g = parseInt(hex.substring(2, 4), 16) || 70;
  const b = parseInt(hex.substring(4, 6), 16) || 229;
  
  // Mix 95% white and 5% member color for an extremely soft pastel tint
  const mixedR = Math.round(255 * 0.95 + r * 0.05);
  const mixedG = Math.round(255 * 0.95 + g * 0.05);
  const mixedB = Math.round(255 * 0.95 + b * 0.05);
  
  return `rgba(${mixedR}, ${mixedG}, ${mixedB}, 0.92)`;
}

// Calculate distance in km between two coordinates using Haversine formula
function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export const MapComponent: React.FC<MapComponentProps> = ({ 
  members, 
  onRefresh, 
  loading, 
  mapStyle,
  selectedIconSize,
  unselectedIconSize,
  selectedMemberId: propSelectedMemberId,
  onSelectMemberId
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<{ [key: string]: maplibregl.Marker }>({});
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const currentTargetCoordRef = useRef<[number, number] | null>(null);

  const [internalSelectedMemberId, setInternalSelectedMemberId] = useState<number | null>(null);
  const isControlled = propSelectedMemberId !== undefined;
  const selectedMemberId = isControlled ? propSelectedMemberId : internalSelectedMemberId;

  const setSelectedMemberId = useCallback((id: number | null) => {
    if (!isControlled) {
      setInternalSelectedMemberId(id);
    }
    if (onSelectMemberId) {
      onSelectMemberId(id);
    }
  }, [isControlled, onSelectMemberId]);

  // Card View and History Navigation States
  const [isCardHidden, setIsCardHidden] = useState<boolean>(false);
  const [sheetState, setSheetState] = useState<"expanded" | "compact">("expanded");
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [mobilePage, setMobilePage] = useState<number>(0);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // Match tailwind's md breakpoint
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Reset sheet state to expanded when selected member changes
  useEffect(() => {
    if (selectedMemberId !== null && selectedMemberId !== undefined) {
      setSheetState("expanded");
      setMobilePage(0);
    }
  }, [selectedMemberId]);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isCustomRangeActive, setIsCustomRangeActive] = useState<boolean>(false);
  const [activeRange, setActiveRange] = useState<ActiveRangeConfig>({
    type: 'preset',
    presetId: 'today',
    hours: 24,
    label: 'Today'
  });
  const navMemberHistoryRef = useRef<number[]>([]);

  // Mobile touch gesture states and refs
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const axisLockRef = useRef<"x" | "y" | null>(null);
  const startTimeRef = useRef<number>(0);

  const [dragOffsetY, setDragOffsetY] = useState<number>(0);
  const [dragOffsetX, setDragOffsetX] = useState<number>(0);

  // Native TouchEvent handlers to completely own mobile gestures
  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    touchCurrentRef.current = { x: touch.clientX, y: touch.clientY };
    axisLockRef.current = null;
    startTimeRef.current = Date.now();
    
    setDragOffsetY(0);
    setDragOffsetX(0);
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current || e.touches.length !== 1) return;
    
    const touch = e.touches[0];
    const start = touchStartRef.current;
    
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    
    touchCurrentRef.current = { x: touch.clientX, y: touch.clientY };
    
    const distanceX = Math.abs(deltaX);
    const distanceY = Math.abs(deltaY);
    
    // Determine and lock the dominant axis
    if (axisLockRef.current === null) {
      if (distanceX > 6 || distanceY > 6) {
        if (distanceX > distanceY) {
          axisLockRef.current = "x";
        } else {
          axisLockRef.current = "y";
        }
      }
      return;
    }
    
    // Once the axis is locked, completely own the gesture and prevent browser scrolling / secondary touch issues
    if (e.cancelable) {
      e.preventDefault();
    }
    e.stopPropagation();
    
    if (axisLockRef.current === "y") {
      // Dragging vertical bottom-sheet
      if (sheetState === "expanded") {
        setDragOffsetY(Math.max(-20, deltaY)); // subtle resist when pulling past expanded
      } else {
        setDragOffsetY(Math.min(20, deltaY)); // subtle resist when pulling past compact
      }
    } else if (axisLockRef.current === "x") {
      // Dragging horizontal pages container
      if (mobilePage === 0) {
        setDragOffsetX(Math.min(20, deltaX));
      } else {
        setDragOffsetX(Math.max(-20, deltaX));
      }
    }
  }, [sheetState, mobilePage]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current) return;
    
    const start = touchStartRef.current;
    let current = touchCurrentRef.current;
    if (!current && e.changedTouches && e.changedTouches.length > 0) {
      current = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    
    if (!current) {
      setDragOffsetY(0);
      setDragOffsetX(0);
      touchStartRef.current = null;
      touchCurrentRef.current = null;
      axisLockRef.current = null;
      return;
    }
    
    const deltaX = current.x - start.x;
    const deltaY = current.y - start.y;
    const duration = Date.now() - startTimeRef.current;
    
    const distanceX = Math.abs(deltaX);
    const distanceY = Math.abs(deltaY);
    
    const velocityX = distanceX / (duration || 1); // px per ms
    const velocityY = distanceY / (duration || 1);
    
    const currentAxis = axisLockRef.current;
    
    if (currentAxis === "y") {
      const thresholdY = 60; // snap threshold
      const isFastY = velocityY > 0.3;
      
      if (sheetState === "expanded") {
        if (deltaY > thresholdY || (isFastY && deltaY > 0)) {
          setSheetState("compact");
        }
      } else {
        if (deltaY < -thresholdY || (isFastY && deltaY < 0)) {
          setSheetState("expanded");
        }
      }
    } else if (currentAxis === "x") {
      const thresholdX = 60; // snap threshold
      const isFastX = velocityX > 0.3;
      
      if (mobilePage === 0) {
        if (deltaX < -thresholdX || (isFastX && deltaX < 0)) {
          setMobilePage(1);
        }
      } else {
        if (deltaX > thresholdX || (isFastX && deltaX < 0)) {
          setMobilePage(0);
        }
      }
    }
    
    // Reset drag offsets
    setDragOffsetY(0);
    setDragOffsetX(0);
    touchStartRef.current = null;
    touchCurrentRef.current = null;
    axisLockRef.current = null;
  }, [sheetState, mobilePage]);

  // Bind non-passive Touch listeners directly to own gestures, ignoring child interference
  useEffect(() => {
    const el = cardContainerRef.current;
    if (!el || !isMobile) return;
    
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [isMobile, selectedMemberId, isCardHidden, handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Custom Range Draft Values
  const todayStr = useMemo(() => toDateInputValue(new Date()), []);
  const threeDaysAgoStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    return toDateInputValue(d);
  }, []);
  const [draftStartDate, setDraftStartDate] = useState<string>(threeDaysAgoStr);
  const [draftEndDate, setDraftEndDate] = useState<string>(todayStr);
  const [customDateError, setCustomDateError] = useState<string | null>(null);

  const [historyData, setHistoryData] = useState<LocationHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const currentStyleIdRef = useRef<string | null>(null);

  // Filter members that actually have valid, non-null real device locations
  const membersWithLocation = members.filter(m => 
    m.devices && m.devices.some(d => d.latitude !== null && d.longitude !== null)
  );
  const membersWithLocRef = useRef(membersWithLocation);
  membersWithLocRef.current = membersWithLocation;

  const selectedMember = membersWithLocation.find(m => m.id === selectedMemberId) || null;
  const primaryDevice = selectedMember?.devices?.[0];

  // Solid darker route color automatically derived from member's pastel color
  const darkerRouteColor = useMemo(() => {
    return getDarkerRouteColor(selectedMember?.avatar_color);
  }, [selectedMember?.avatar_color]);

  // Retrieve selected member's real location history from Yimly Home Core
  const fetchMemberHistory = useCallback(async (
    memberId: number, 
    range: ActiveRangeConfig
  ) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const token = localStorage.getItem("access_token");
      const queryParams = new URLSearchParams();
      queryParams.set("user_id", String(memberId));
      if (range.type === 'preset') {
        if (range.hours !== undefined && range.hours !== null) {
          queryParams.set("hours", String(range.hours));
        }
      } else if (range.type === 'custom' && range.startDate && range.endDate) {
        queryParams.set("start_date", `${range.startDate}T00:00:00.000Z`);
        queryParams.set("end_date", `${range.endDate}T23:59:59.999Z`);
      }

      const res = await fetch(`/api/history/period?${queryParams.toString()}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (res.ok) {
        const data: LocationHistoryItem[] = await res.json();
        setHistoryData(data);
      } else {
        const err = await res.json().catch(() => ({ detail: "Failed to load location history" }));
        setHistoryError(err.detail || "Unable to retrieve location history for this member.");
      }
    } catch (err) {
      console.error("Error fetching location history:", err);
      setHistoryError("Network error while communicating with Yimly Core.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Initialize MapLibre GL map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const initialStyleOption = getMapStyle(mapStyle);
    currentStyleIdRef.current = initialStyleOption.id;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: initialStyleOption.style,
      center: [0, 20],
      zoom: 2,
      trackResize: true,
      attributionControl: { compact: false }
    });

    map.on("error", (e: maplibregl.ErrorEvent) => {
      console.error("[MapLibre GL Error]", e);
    });

    mapRef.current = map;

    // Set up ResizeObserver to observe the container element
    const resizeObserver = new ResizeObserver(() => {
      if (mapRef.current) {
        mapRef.current.resize();
      }
    });

    resizeObserver.observe(mapContainerRef.current);

    // Initial resize trigger after DOM layout settlement
    const animFrame = requestAnimationFrame(() => {
      map.resize();
    });

    return () => {
      cancelAnimationFrame(animFrame);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, []);

  // Update Map Style dynamically when mapStyle changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentStyleOption = getMapStyle(mapStyle);
    if (currentStyleIdRef.current === currentStyleOption.id) return;

    currentStyleIdRef.current = currentStyleOption.id;
    map.setStyle(currentStyleOption.style, { diff: false });
    map.once("styledata", () => {
      map.resize();
    });
  }, [mapStyle]);

  // Sync Smooth Gradient History Route on the Map Canvas with Gap Preservation
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const removeHistoryLayers = () => {
      if (map.getLayer("history-route-points")) map.removeLayer("history-route-points");
      if (map.getLayer("history-route-line")) map.removeLayer("history-route-line");
      if (map.getSource("history-route-source")) map.removeSource("history-route-source");
    };

    // Route is displayed when History is open or historyData is loaded
    const isHistoryActive = isHistoryOpen || historyData.length > 0;

    if (!isHistoryActive || !selectedMemberId || historyData.length === 0) {
      removeHistoryLayers();
      return;
    }

    // Sort chronological ascending (oldest first to draw route progression)
    const validPoints = historyData
      .filter(d => d.longitude != null && d.latitude != null)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (validPoints.length === 0) {
      removeHistoryLayers();
      return;
    }

    const totalPoints = validPoints.length;
    const geojsonFeatures: GeoJSON.Feature[] = [];

    // Build contiguous 2-point LineString segments with smooth gradient coloring
    // preserving gaps (> 6 hours or > 50km without recorded points)
    for (let i = 1; i < totalPoints; i++) {
      const prevPt = validPoints[i - 1];
      const currPt = validPoints[i];

      const timeDiffHours = Math.abs(new Date(currPt.timestamp).getTime() - new Date(prevPt.timestamp).getTime()) / (3600 * 1000);
      const distKm = calculateDistanceKm(prevPt.latitude, prevPt.longitude, currPt.latitude, currPt.longitude);

      // Do NOT invent paths across large gaps in recorded history
      if (timeDiffHours > 6 || distKm > 50) {
        continue;
      }

      // Progress along chronological journey: oldest is 0.0 (lightest), newest is 1.0 (darkest)
      const segmentProgress = totalPoints > 1 ? (i - 0.5) / (totalPoints - 1) : 1.0;
      const segmentColor = getRouteGradientColor(selectedMember?.avatar_color, segmentProgress);

      geojsonFeatures.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [prevPt.longitude, prevPt.latitude],
            [currPt.longitude, currPt.latitude]
          ]
        },
        properties: {
          color: segmentColor
        }
      });
    }

    // Add individual waypoint circles with matching gradient color
    validPoints.forEach((pt, idx) => {
      const ptProgress = totalPoints > 1 ? idx / (totalPoints - 1) : 1.0;
      const ptColor = getRouteGradientColor(selectedMember?.avatar_color, ptProgress);

      geojsonFeatures.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [pt.longitude, pt.latitude]
        },
        properties: {
          color: ptColor,
          isLatest: idx === totalPoints - 1
        }
      });
    });

    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: geojsonFeatures
    };

    try {
      const existingSource = map.getSource("history-route-source") as maplibregl.GeoJSONSource;
      if (existingSource) {
        existingSource.setData(geojson);
        if (map.getLayer("history-route-line")) {
          map.setPaintProperty("history-route-line", "line-color", ["get", "color"]);
        }
        if (map.getLayer("history-route-points")) {
          map.setPaintProperty("history-route-points", "circle-color", ["get", "color"]);
        }
      } else {
        map.addSource("history-route-source", {
          type: "geojson",
          data: geojson
        });

        // Gradient route line segments with rounded joins and caps
        map.addLayer({
          id: "history-route-line",
          type: "line",
          source: "history-route-source",
          filter: ["==", "$type", "LineString"],
          layout: {
            "line-join": "round",
            "line-cap": "round"
          },
          paint: {
            "line-color": ["get", "color"],
            "line-width": 4.5,
            "line-opacity": 0.95
          }
        });

        // Waypoint circles along gradient
        map.addLayer({
          id: "history-route-points",
          type: "circle",
          source: "history-route-source",
          filter: ["==", "$type", "Point"],
          paint: {
            "circle-radius": 5,
            "circle-color": ["get", "color"],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff"
          }
        });
      }
    } catch (err) {
      console.warn("History layer update deferred until style data is ready:", err);
    }
  }, [isHistoryOpen, selectedMemberId, historyData, selectedMember?.avatar_color, mapStyle]);

  // Custom Map Actions
  const handleZoomIn = () => {
    mapRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    mapRef.current?.zoomOut();
  };

  const handleFitBounds = () => {
    if (!mapRef.current || membersWithLocation.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    membersWithLocation.forEach((m) => {
      m.devices.forEach((d) => {
        if (d.longitude !== null && d.latitude !== null) {
          bounds.extend([d.longitude, d.latitude]);
        }
      });
    });

    if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 1000 });
    }
    setSelectedMemberId(null);
    setIsHistoryOpen(false);
    setIsCustomRangeActive(false);
    setHistoryData([]);
    setIsCardHidden(false);
    navMemberHistoryRef.current = [];
  };

  // Card-aware bottom padding calculation
  const getBottomPadding = useCallback((isHidden: boolean) => {
    if (isHidden) return 28;
    if (cardContainerRef.current) {
      const rect = cardContainerRef.current.getBoundingClientRect();
      const measured = window.innerHeight - rect.top + 16;
      if (measured > 80 && measured < window.innerHeight * 0.65) return measured;
    }
    return isHistoryOpen ? 210 : 155;
  }, [isHistoryOpen]);

  // Directly fly map camera to clicked member's current real coordinates
  const flyToMemberLocation = useCallback((
    member: CircleMember,
    isHidden: boolean = false,
    duration = 800
  ) => {
    const dev = member.devices?.find(d => d.latitude !== null && d.longitude !== null) || member.devices?.[0];
    if (!dev || dev.latitude === null || dev.longitude === null) return;
    const map = mapRef.current;
    if (!map) return;

    const bottomPad = getBottomPadding(isHidden);
    const topPad = 76;

    // Direct target coordinate tracking (avoid stale React state)
    currentTargetCoordRef.current = [dev.longitude, dev.latitude];

    const currentZoom = map.getZoom();
    const targetZoom = currentZoom < 14 ? 15 : currentZoom;

    map.flyTo({
      center: [dev.longitude, dev.latitude],
      zoom: targetZoom,
      padding: { top: topPad, bottom: bottomPad, left: 0, right: 0 },
      duration,
      essential: true
    });
  }, [getBottomPadding]);

  // Focus member, center map in usable area above card, and show member information card
  const handleFocusMember = useCallback((member: CircleMember) => {
    if (selectedMemberId && selectedMemberId !== member.id) {
      navMemberHistoryRef.current.push(selectedMemberId);
    }
    setSelectedMemberId(member.id);
    setCustomDateError(null);
    setIsCardHidden(false);

    // Direct flyTo using clicked member's current coordinates
    flyToMemberLocation(member, false, 800);
    if (isHistoryOpen) {
      fetchMemberHistory(member.id, activeRange);
    }
  }, [selectedMemberId, isHistoryOpen, activeRange, fetchMemberHistory, flyToMemberLocation]);

  // Synchronise external propSelectedMemberId with internal selection state
  useEffect(() => {
    if (propSelectedMemberId !== undefined && propSelectedMemberId !== internalSelectedMemberId) {
      if (propSelectedMemberId === null) {
        setInternalSelectedMemberId(null);
      } else {
        const member = members.find(m => m.id === propSelectedMemberId);
        if (member) {
          setInternalSelectedMemberId(propSelectedMemberId);
          setIsCardHidden(false);
          const timer = setTimeout(() => {
            flyToMemberLocation(member, false, 800);
          }, 50);
          if (isHistoryOpen) {
            fetchMemberHistory(member.id, activeRange);
          }
          return () => clearTimeout(timer);
        }
      }
    }
  }, [propSelectedMemberId, internalSelectedMemberId, members, flyToMemberLocation, isHistoryOpen, activeRange, fetchMemberHistory]);

  // Show Card action: restores card and re-centers member in usable area above card
  const handleShowCard = useCallback(() => {
    setIsCardHidden(false);
    if (selectedMember) {
      flyToMemberLocation(selectedMember, false, 400);
    }
  }, [selectedMember, flyToMemberLocation]);

  // Hide Card action: hides card and expands usable map area to full viewport
  const handleHideCard = useCallback(() => {
    setIsCardHidden(true);
    if (selectedMember) {
      const dev = selectedMember.devices?.find(d => d.latitude !== null && d.longitude !== null);
      if (dev && dev.longitude !== null && dev.latitude !== null && mapRef.current) {
        mapRef.current.easeTo({
          center: [dev.longitude, dev.latitude],
          padding: { top: 76, bottom: 28, left: 0, right: 0 },
          duration: 350
        });
      }
    }
  }, [selectedMember]);

  // Back button navigation: returns to previous state without losing map state
  const handleNavBack = useCallback(() => {
    if (isCustomRangeActive) {
      setIsCustomRangeActive(false);
      setCustomDateError(null);
      return;
    }
    if (isHistoryOpen) {
      setIsHistoryOpen(false);
      return;
    }
    if (navMemberHistoryRef.current.length > 0) {
      const prevId = navMemberHistoryRef.current.pop();
      if (prevId) {
        const prevMember = membersWithLocRef.current.find(m => m.id === prevId);
        if (prevMember) {
          setSelectedMemberId(prevId);
          flyToMemberLocation(prevMember, false, 600);
          return;
        }
      }
    }
    // Return to general map view
    setSelectedMemberId(null);
    setIsHistoryOpen(false);
    setIsCustomRangeActive(false);
    setHistoryData([]);
  }, [isCustomRangeActive, isHistoryOpen, flyToMemberLocation]);

  // Close Card action
  const handleCloseCard = useCallback(() => {
    setSelectedMemberId(null);
    setIsHistoryOpen(false);
    setIsCustomRangeActive(false);
    setHistoryData([]);
    setIsCardHidden(false);
    currentTargetCoordRef.current = null;
    navMemberHistoryRef.current = [];
  }, []);

  // Toggle History control within card
  const handleToggleHistory = useCallback(() => {
    if (!selectedMember) return;
    const nextOpen = !isHistoryOpen;
    setIsHistoryOpen(nextOpen);
    if (nextOpen) {
      fetchMemberHistory(selectedMember.id, activeRange);
    }
  }, [selectedMember, isHistoryOpen, activeRange, fetchMemberHistory]);

  // Select Date Range Preset (Today | Week | Month | Custom)
  const handleSelectRange = useCallback((rangeOption: 'today' | 'week' | 'month' | 'custom') => {
    if (!selectedMember) return;
    if (rangeOption === 'custom') {
      setIsCustomRangeActive(true);
      setDraftStartDate(activeRange.startDate || threeDaysAgoStr);
      setDraftEndDate(activeRange.endDate || todayStr);
      return;
    }
    setIsCustomRangeActive(false);
    let hours = 24;
    let label = "Today";
    if (rangeOption === 'week') {
      hours = 168;
      label = "Week";
    } else if (rangeOption === 'month') {
      hours = 720;
      label = "Month";
    }
    const newRange: ActiveRangeConfig = {
      type: 'preset',
      presetId: rangeOption,
      hours,
      label
    };
    setActiveRange(newRange);
    fetchMemberHistory(selectedMember.id, newRange);
  }, [selectedMember, activeRange, threeDaysAgoStr, todayStr, fetchMemberHistory]);

  // Apply Custom Date Range
  const handleApplyCustomRange = useCallback(() => {
    if (!selectedMember) return;
    if (!draftStartDate || !draftEndDate) {
      setCustomDateError("Please select both start and end dates.");
      return;
    }
    if (draftStartDate > draftEndDate) {
      setCustomDateError("Start date cannot be after End date.");
      return;
    }
    const customLabel = formatCustomRangeLabel(draftStartDate, draftEndDate);
    const newRange: ActiveRangeConfig = {
      type: 'custom',
      startDate: draftStartDate,
      endDate: draftEndDate,
      label: customLabel
    };
    setActiveRange(newRange);
    setCustomDateError(null);
    fetchMemberHistory(selectedMember.id, newRange);
  }, [selectedMember, draftStartDate, draftEndDate, fetchMemberHistory]);

  // Post-layout camera adjustment: when card finishes rendering or changes dimensions,
  // ensure the selected member is visually centered in the usable map area ABOVE the bottom card
  useEffect(() => {
    if (!cardContainerRef.current || !selectedMemberId || isCardHidden) return;

    const observer = new ResizeObserver(() => {
      const map = mapRef.current;
      const targetCoord = currentTargetCoordRef.current;
      if (!map || !targetCoord) return;

      // Do NOT interrupt active flyTo animations during initial selection!
      if (map.isMoving()) return;

      const rect = cardContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const actualBottomPad = Math.max(80, Math.min(window.innerHeight * 0.65, window.innerHeight - rect.top + 16));

      map.easeTo({
        center: targetCoord,
        padding: { top: 76, bottom: actualBottomPad, left: 0, right: 0 },
        duration: 200
      });
    });

    observer.observe(cardContainerRef.current);
    return () => observer.disconnect();
  }, [selectedMemberId, isHistoryOpen, isCustomRangeActive, isCardHidden]);

  // Update Markers & Sync Selection
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentMemberIds = new Set<string>();

    membersWithLocation.forEach((member) => {
      const primaryDevice = member.devices?.[0];
      if (!primaryDevice || primaryDevice.longitude === null || primaryDevice.latitude === null) return;

      const markerKey = `member_${member.id}`;
      currentMemberIds.add(markerKey);

      const isSelected = selectedMemberId === member.id;
      const baseColor = member.avatar_color || "#4f46e5";

      // Effective marker dimensions based on user customization settings
      const unselSize = unselectedIconSize || 44;
      const selSize = selectedIconSize || 54;
      const markerSize = isSelected ? selSize : unselSize;
      const innerSize = markerSize - 6;

      let marker = markersRef.current[markerKey];

      if (!marker) {
        // Create custom MapLibre HTML marker element
        const el = document.createElement("div");
        el.className = "custom-member-marker cursor-pointer transition-transform duration-200";
        el.style.zIndex = isSelected ? "10" : "1";

        marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([primaryDevice.longitude, primaryDevice.latitude])
          .addTo(map);

        markersRef.current[markerKey] = marker;
      } else {
        marker.setLngLat([primaryDevice.longitude, primaryDevice.latitude]);
      }

      // Update marker element styling and dynamic HTML with avatar picture / initials
      const el = marker.getElement();
      el.style.zIndex = isSelected ? "20" : "5";
      el.style.width = `${markerSize}px`;
      el.style.height = `${markerSize}px`;

      // Always wire click handler to freshest member coordinates, selecting & centering on the same first click (no popup)
      el.onclick = (e) => {
        e.stopPropagation();
        const freshMember = membersWithLocRef.current.find(m => m.id === member.id) || member;
        handleFocusMember(freshMember);
      };

      el.innerHTML = `
        <div class="relative w-full h-full rounded-full flex items-center justify-center transition-all duration-300"
             style="
               background-color: white;
               padding: 3px;
               box-shadow: ${
                 isSelected
                   ? `0 0 0 3.5px ${baseColor}, 0 8px 24px rgba(0,0,0,0.22)`
                   : `0 2px 10px rgba(0,0,0,0.12)`
               };
             ">
          <div class="w-full h-full rounded-full text-white font-black text-xs flex items-center justify-center overflow-hidden"
               style="
                 width: ${innerSize}px;
                 height: ${innerSize}px;
                 background-color: ${baseColor};
               ">
            ${
              member.profile_picture_url
                ? `<img src="${member.profile_picture_url}" alt="${member.display_name}" class="w-full h-full object-cover rounded-full pointer-events-none" />`
                : member.display_name.charAt(0).toUpperCase()
            }
          </div>
          ${
            primaryDevice.battery !== undefined && primaryDevice.battery !== null
              ? `
                <div class="absolute -bottom-1 -right-1 bg-white text-slate-800 text-[9px] font-black px-1 rounded-full shadow-sm border border-slate-200">
                  ${primaryDevice.battery}%
                </div>
              `
              : ''
          }
        </div>
      `;
    });

    // Cleanup markers for removed members
    Object.keys(markersRef.current).forEach((key) => {
      if (!currentMemberIds.has(key)) {
        markersRef.current[key].remove();
        delete markersRef.current[key];
      }
    });

    // Auto-fit initial bounds when markers first load if nothing is selected
    if (selectedMemberId === null && membersWithLocation.length > 0 && map.getZoom() <= 2) {
      const bounds = new maplibregl.LngLatBounds();
      membersWithLocation.forEach(m => {
        m.devices.forEach(d => {
          if (d.longitude !== null && d.latitude !== null) {
            bounds.extend([d.longitude, d.latitude]);
          }
        });
      });

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
      }
    }
  }, [membersWithLocation, selectedMemberId, selectedIconSize, unselectedIconSize, handleFocusMember]);

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      
      {/* FULL-SCREEN MAP CANVAS */}
      <div ref={mapContainerRef} className="w-full h-full absolute inset-0 z-0 bg-[#f8fafc]" />

      {/* FLOATING MEMBER AVATARS BAR (CENTRED AT VERY TOP) */}
      {membersWithLocation.length > 0 && (
        <div className="hidden sm:flex absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none justify-center max-w-[calc(100vw-2rem)]">
          <div className="pointer-events-auto flex items-center gap-2 overflow-x-auto p-1.5 bg-white/85 backdrop-blur-2xl border border-white/80 shadow-[0_8px_30px_rgb(0,0,0,0.08)] rounded-full max-w-full scrollbar-none">
            {/* Member Pills with Saved Avatar Colors (Icon/Avatar Only) */}
            {membersWithLocation.map((member) => {
              const isSelected = selectedMemberId === member.id;
              const memberColor = member.avatar_color || "#4f46e5";

              return (
                <button
                  key={member.id}
                  onClick={() => handleFocusMember(member)}
                  title={member.display_name}
                  aria-label={member.display_name}
                  className={`relative p-0.5 rounded-full transition shrink-0 cursor-pointer border ${
                    isSelected
                      ? "bg-white text-slate-900 shadow-md scale-110"
                      : "bg-white/60 text-slate-700 hover:bg-white/90 hover:scale-105 border-slate-100"
                  }`}
                  style={{
                    borderColor: isSelected ? memberColor : "rgba(226, 232, 240, 0.8)",
                    boxShadow: isSelected ? `0 0 0 2.5px ${memberColor}` : "none"
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full text-white font-extrabold text-xs flex items-center justify-center shadow-sm overflow-hidden shrink-0"
                    style={{ backgroundColor: memberColor }}
                  >
                    {member.profile_picture_url ? (
                      <img
                        src={member.profile_picture_url}
                        alt={member.display_name}
                        className="w-full h-full object-cover rounded-full"
                      />
                    ) : (
                      member.display_name.charAt(0).toUpperCase()
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* FLOATING MAP CONTROLS (RIGHT SIDEBAR) */}
      <div className="absolute right-3 sm:right-4 top-16 sm:top-20 z-20 pointer-events-auto flex flex-col gap-2">
        <div className="bg-white/80 backdrop-blur-xl p-1 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-white/60 flex flex-col gap-1">
          <button
            onClick={handleZoomIn}
            className="w-9 h-9 rounded-xl hover:bg-slate-100/80 flex items-center justify-center text-slate-700 transition cursor-pointer"
            title="Zoom In"
          >
            <Plus className="w-4 h-4" />
          </button>

          <div className="w-6 h-px bg-slate-200/60 mx-auto" />

          <button
            onClick={handleZoomOut}
            className="w-9 h-9 rounded-xl hover:bg-slate-100/80 flex items-center justify-center text-slate-700 transition cursor-pointer"
            title="Zoom Out"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={handleFitBounds}
          className="w-11 h-11 bg-white/80 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-white/60 flex items-center justify-center text-slate-700 hover:bg-white hover:text-indigo-600 transition cursor-pointer"
          title="Recenter / Fit All"
        >
          <Navigation className="w-4.5 h-4.5" />
        </button>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="w-11 h-11 bg-white/80 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-white/60 flex items-center justify-center text-slate-700 hover:bg-white hover:text-indigo-600 transition cursor-pointer disabled:opacity-50"
          title="Refresh Locations"
        >
          <RefreshCw className={`w-4.5 h-4.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* COMPACT FROSTED SELECTED-MEMBER CARD WITH NAVIGATION & HISTORY (DESKTOP) */}
      {selectedMember && !isCardHidden && !isMobile && (
        <motion.div 
          ref={cardContainerRef}
          layout
          drag={isMobile && !isHistoryOpen ? "y" : false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.1, bottom: 0.5 }}
          onDragEnd={(event, info) => {
            const swipeThreshold = 30;
            if (info.offset.y > swipeThreshold) {
              setSheetState("compact");
            } else if (info.offset.y < -swipeThreshold) {
              setSheetState("expanded");
            }
          }}
          className="absolute bottom-[88px] sm:bottom-22 left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:w-[520px] sm:max-w-[calc(100vw-2rem)] z-30 pointer-events-auto"
        >
          <div className="bg-white/95 backdrop-blur-2xl p-4 sm:p-5 rounded-3xl shadow-[0_12px_40px_rgba(0,0,0,0.16)] border border-white/80 transition-all duration-300 space-y-3">
            {/* Small Drag Handle at the top of the sheet (Mobile Only) */}
            {isMobile && !isHistoryOpen && (
              <div 
                onClick={() => setSheetState(sheetState === "expanded" ? "compact" : "expanded")}
                className="w-12 h-1 bg-slate-300/80 rounded-full mx-auto mb-2.5 cursor-pointer hover:bg-slate-400 transition"
                title="Drag or tap to resize"
              />
            )}

            {isHistoryOpen ? (
              isCustomRangeActive ? (
                /* CUSTOM RANGE MODE - ONLY custom range controls */
                <div className="space-y-3 animate-in fade-in duration-200">
                  {/* Custom Range Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleNavBack}
                        className="p-1.5 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100/90 active:bg-slate-200 transition cursor-pointer shrink-0"
                        title="Back to history options"
                        aria-label="Back"
                      >
                        <ChevronLeft className="w-4.5 h-4.5" />
                      </button>
                      <h4 className="text-sm sm:text-base font-black text-slate-800">
                        Custom Range
                      </h4>
                    </div>
                    
                    <button
                      onClick={handleCloseCard}
                      className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                      title="Close card"
                      aria-label="Close card"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Custom Start/End Inputs & Apply Button */}
                  <div className="p-3 rounded-2xl bg-slate-50/80 border border-slate-100/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Start</span>
                        <input
                          type="date"
                          value={draftStartDate}
                          onChange={(e) => {
                            setDraftStartDate(e.target.value);
                            setCustomDateError(null);
                          }}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200/80 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">End</span>
                        <input
                          type="date"
                          value={draftEndDate}
                          onChange={(e) => {
                            setDraftEndDate(e.target.value);
                            setCustomDateError(null);
                          }}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200/80 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleApplyCustomRange}
                      className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer shrink-0"
                    >
                      Apply
                    </button>
                  </div>

                  {customDateError && (
                    <div className="text-[10px] font-bold text-rose-500 px-1">
                      {customDateError}
                    </div>
                  )}

                  {/* Status summary */}
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold px-1 pt-1 border-t border-slate-100/60">
                    <span>
                      {historyLoading
                        ? "Fetching location logs..."
                        : historyError
                        ? historyError
                        : historyData.length > 0
                        ? `${historyData.length} location waypoint${historyData.length === 1 ? "" : "s"} plotted`
                        : "No telemetry logged in selected range"}
                    </span>
                    {historyData.length > 0 && !historyLoading && (
                      <span className="text-indigo-600 font-bold">
                        Trail on map
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                /* HISTORY PRESET MODE - ONLY preset choices Today, Week, Month, Custom */
                <div className="space-y-3 animate-in fade-in duration-200">
                  {/* History Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleNavBack}
                        className="p-1.5 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100/90 active:bg-slate-200 transition cursor-pointer shrink-0"
                        title="Back to member info"
                        aria-label="Back"
                      >
                        <ChevronLeft className="w-4.5 h-4.5" />
                      </button>
                      <h4 className="text-sm sm:text-base font-black text-slate-800">
                        History
                      </h4>
                    </div>

                    <button
                      onClick={handleCloseCard}
                      className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                      title="Close card"
                      aria-label="Close card"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Preset Pills */}
                  <div className="flex items-center gap-2.5">
                    {(['today', 'week', 'month', 'custom'] as const).map((opt) => {
                      const isSelected = activeRange.presetId === opt || (opt === 'today' && !activeRange.presetId);
                      const labels: Record<string, string> = {
                        today: 'Today',
                        week: 'Week',
                        month: 'Month',
                        custom: 'Custom'
                      };
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => handleSelectRange(opt)}
                          className={`flex-1 px-3 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer active:scale-95 text-center ${
                            isSelected
                              ? "bg-indigo-600 text-white shadow-xs"
                              : "bg-slate-100 hover:bg-slate-200/80 text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          {labels[opt]}
                        </button>
                      );
                    })}
                  </div>

                  {/* Status summary */}
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold px-1 pt-1 border-t border-slate-100/60">
                    <span>
                      {historyLoading
                        ? "Fetching location logs..."
                        : historyError
                        ? historyError
                        : historyData.length > 0
                        ? `${historyData.length} location waypoint${historyData.length === 1 ? "" : "s"} plotted`
                        : "No telemetry logged in selected range"}
                    </span>
                    {historyData.length > 0 && !historyLoading && (
                      <span className="text-indigo-600 font-bold">
                        Trail on map
                      </span>
                    )}
                  </div>
                </div>
              )
            ) : (
              /* NORMAL MODE */
              isMobile && sheetState === "compact" ? (
                /* COMPACT MOBILE STATE */
                <div 
                  onClick={() => setSheetState("expanded")}
                  className="flex items-center gap-3 cursor-pointer select-none animate-in fade-in duration-200"
                >
                  {/* Compact Back Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNavBack();
                    }}
                    className="p-1.5 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100/90 active:bg-slate-200 transition cursor-pointer shrink-0"
                    title="Back"
                  >
                    <ChevronLeft className="w-4.5 h-4.5" />
                  </button>

                  {/* Member Avatar */}
                  <div
                    className="w-9 h-9 rounded-full text-white font-black text-xs flex items-center justify-center select-none shadow-sm overflow-hidden shrink-0"
                    style={{
                      backgroundColor: selectedMember.avatar_color || "#4f46e5",
                      boxShadow: `0 0 0 2px white, 0 2px 6px ${selectedMember.avatar_color || '#4f46e5'}40`
                    }}
                  >
                    {selectedMember.profile_picture_url ? (
                      <img
                        src={selectedMember.profile_picture_url}
                        alt={selectedMember.display_name}
                        className="w-full h-full object-cover rounded-full"
                      />
                    ) : (
                      selectedMember.display_name.charAt(0).toUpperCase()
                    )}
                  </div>

                  {/* Member Name and Battery / Time */}
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-black text-slate-800 truncate leading-tight">
                      {selectedMember.display_name}
                    </h4>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium leading-tight mt-0.5 truncate">
                      {primaryDevice?.battery !== undefined && primaryDevice?.battery !== null && (
                        <span className="flex items-center gap-1 shrink-0 font-bold text-slate-600">
                          <Battery className="w-3 h-3 text-emerald-500" />
                          {primaryDevice.battery}%
                        </span>
                      )}
                      {primaryDevice?.battery !== undefined && primaryDevice?.last_updated && (
                        <span className="text-slate-300">•</span>
                      )}
                      {primaryDevice?.last_updated && (
                        <span className="flex items-center gap-1 truncate text-slate-400">
                          <Clock className="w-3 h-3 shrink-0" />
                          {new Date(primaryDevice.last_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Simple Expand Indicator */}
                  <div className="text-slate-400 p-1 shrink-0">
                    <ChevronUp className="w-4.5 h-4.5 animate-bounce" />
                  </div>
                </div>
              ) : (
                /* EXPANDED STATE (OR DESKTOP STATE) */
                <div className="space-y-4 animate-in fade-in duration-200">
                  {/* Profile Header Row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Compact Back Button */}
                      <button
                        onClick={handleNavBack}
                        className="p-1.5 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100/90 active:bg-slate-200 transition cursor-pointer shrink-0"
                        title="Back to previous state"
                        aria-label="Back"
                      >
                        <ChevronLeft className="w-4.5 h-4.5" />
                      </button>

                      {/* Large Avatar */}
                      <div
                        onClick={() => {
                          if (isMobile) setSheetState("compact");
                        }}
                        className={`w-12 h-12 rounded-full text-white font-black text-base flex items-center justify-center select-none shadow-sm overflow-hidden shrink-0 ${isMobile ? "cursor-pointer" : ""}`}
                        style={{
                          backgroundColor: selectedMember.avatar_color || "#4f46e5",
                          boxShadow: `0 0 0 2px white, 0 2px 6px ${selectedMember.avatar_color || '#4f46e5'}40`
                        }}
                      >
                        {selectedMember.profile_picture_url ? (
                          <img
                            src={selectedMember.profile_picture_url}
                            alt={selectedMember.display_name}
                            className="w-full h-full object-cover rounded-full"
                          />
                        ) : (
                          selectedMember.display_name.charAt(0).toUpperCase()
                        )}
                      </div>

                      {/* Member Name and Battery / Time */}
                      <div className="min-w-0 flex-1">
                        <h4 className="text-base sm:text-lg font-black text-slate-800 truncate leading-tight">
                          {selectedMember.display_name}
                        </h4>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 font-medium leading-tight mt-1 truncate">
                          {primaryDevice?.battery !== undefined && primaryDevice?.battery !== null && (
                            <span className="flex items-center gap-1 shrink-0 font-bold text-slate-600">
                              <Battery className="w-3.5 h-3.5 text-emerald-500" />
                              {primaryDevice.battery}%
                            </span>
                          )}
                          {primaryDevice?.battery !== undefined && primaryDevice?.last_updated && (
                            <span className="text-slate-300">•</span>
                          )}
                          {primaryDevice?.last_updated && (
                            <span className="flex items-center gap-1 truncate text-slate-400">
                              <Clock className="w-3.5 h-3.5 shrink-0" />
                              {new Date(primaryDevice.last_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Close button at top right of the sheet */}
                    <button
                      onClick={handleCloseCard}
                      className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                      title="Close card"
                      aria-label="Close card"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Bottom Action Grid for a premium, substantial bottom-sheet feel */}
                  <div className="grid grid-cols-3 gap-2.5 pt-1">
                    {/* Compact History Control */}
                    <button
                      onClick={handleToggleHistory}
                      className="py-2.5 px-3 bg-indigo-50 hover:bg-indigo-100 active:scale-95 text-indigo-700 rounded-2xl text-xs font-bold transition flex flex-col items-center justify-center gap-1.5 cursor-pointer shadow-xs border border-indigo-100/40"
                      title="Location History Range"
                    >
                      <History className={`w-4 h-4 ${historyLoading ? "animate-spin" : ""}`} />
                      <span>History</span>
                    </button>

                    <button
                      onClick={() => handleFocusMember(selectedMember)}
                      className="py-2.5 px-3 bg-slate-50 hover:bg-slate-100 active:scale-95 text-slate-700 rounded-2xl text-xs font-bold transition flex flex-col items-center justify-center gap-1.5 cursor-pointer shadow-xs border border-slate-100/40"
                      title="Center on member"
                      aria-label="Center on member"
                    >
                      <Navigation className="w-4 h-4" />
                      <span>Recenter</span>
                    </button>

                    <button
                      onClick={() => {
                        if (isMobile) {
                          setSheetState("compact");
                        } else {
                          handleHideCard();
                        }
                      }}
                      className="py-2.5 px-3 bg-slate-50 hover:bg-slate-100 active:scale-95 text-slate-700 rounded-2xl text-xs font-bold transition flex flex-col items-center justify-center gap-1.5 cursor-pointer shadow-xs border border-slate-100/40"
                      title={isMobile ? "Collapse sheet" : "Hide card"}
                      aria-label={isMobile ? "Collapse sheet" : "Hide card"}
                    >
                      <ChevronDown className="w-4 h-4" />
                      <span>{isMobile ? "Collapse" : "Hide"}</span>
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </motion.div>
      )}

      {/* MOBILE DRIFTABLE BOTTOM SHEET FOR SELECTED-MEMBER CARD (MOBILE ONLY) */}
      {selectedMember && !isCardHidden && isMobile && (
        <motion.div
          ref={cardContainerRef}
          layout
          animate={{
            y: sheetState === "expanded" ? 0 : 404
          }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed bottom-[calc(88px+env(safe-area-inset-bottom,16px))] left-3 right-3 h-[440px] z-30 pointer-events-auto backdrop-blur-2xl border border-white/85 shadow-[0_-12px_40px_rgba(0,0,0,0.12)] rounded-t-[32px] rounded-b-2xl overflow-hidden select-none touch-none"
          style={{
            backgroundColor: getSubtleTintStyle(selectedMember.avatar_color),
            transition: "background-color 350ms cubic-bezier(0.4, 0, 0.2, 1)",
            y: (sheetState === "expanded" ? 0 : 404) + dragOffsetY
          }}
        >
          {/* Centered Drag Handle / Tap to expand-collapse */}
          <div
            onClick={() => setSheetState(sheetState === "expanded" ? "compact" : "expanded")}
            className="w-full pt-3 pb-2 cursor-pointer flex justify-center items-center select-none animate-pulse-slow"
            title="Drag or tap to resize"
          >
            <div className="w-12 h-1 bg-slate-300/80 rounded-full hover:bg-slate-400 transition" />
          </div>

          {/* Draggable/Swipeable Content Pages Container (Always rendered for fluid animations, clipped via parent overflow) */}
          <div className="w-full h-[390px] overflow-hidden relative">
            <motion.div
              animate={{
                x: `calc(${-mobilePage * 50}% + ${dragOffsetX}px)`
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="flex w-[200%] h-full"
            >
              {/* PAGE 1: Current Info */}
              <div className="w-1/2 h-full px-5 pb-4 flex flex-col justify-between overflow-y-auto scrollbar-none select-none">
                <div className="space-y-3.5">
                  {/* Large Avatar */}
                  <div
                    className="w-18 h-18 rounded-full text-white font-black text-xl flex items-center justify-center select-none shadow-md overflow-hidden shrink-0 mx-auto mt-1"
                    style={{
                      backgroundColor: selectedMember.avatar_color || "#4f46e5",
                      boxShadow: `0 0 0 3px white, 0 4px 12px ${selectedMember.avatar_color || '#4f46e5'}40`
                    }}
                  >
                    {selectedMember.profile_picture_url ? (
                      <img
                        src={selectedMember.profile_picture_url}
                        alt={selectedMember.display_name}
                        className="w-full h-full object-cover rounded-full"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      selectedMember.display_name.charAt(0).toUpperCase()
                    )}
                  </div>

                  {/* Member Name */}
                  <h3 className="text-lg font-black text-slate-800 text-center leading-tight">
                    {selectedMember.display_name}
                  </h3>

                  {/* Last Known Location */}
                  <div className="text-center">
                    <div className="flex items-center gap-1 text-slate-400 text-[11px] font-bold uppercase tracking-wider justify-center">
                      <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span>Last known address</span>
                    </div>
                    <span className="text-xs text-slate-600 font-extrabold block mt-1 px-4 truncate">
                      {primaryDevice 
                        ? `${primaryDevice.latitude.toFixed(5)}, ${primaryDevice.longitude.toFixed(5)}` 
                        : "Unknown Location"}
                    </span>
                  </div>

                  {/* Battery Status */}
                  <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500 font-bold">
                    <Battery className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>Battery {primaryDevice?.battery !== undefined && primaryDevice?.battery !== null ? `${primaryDevice.battery}%` : "100%"}</span>
                  </div>

                  {/* Divider and Preset History Controls */}
                  <div className="border-t border-slate-100/80 pt-3">
                    <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2 text-center">
                      History
                    </h4>
                    <div className="flex items-center gap-2 px-1">
                      {(['today', 'week', 'month'] as const).map((opt) => {
                        const isSelected = activeRange.type === 'preset' && activeRange.presetId === opt;
                        const labels: Record<string, string> = {
                          today: 'Today',
                          week: 'Week',
                          month: 'Month'
                        };
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              handleSelectRange(opt);
                              if (!isHistoryOpen) {
                                // Make sure trail gets opened immediately
                                setIsHistoryOpen(true);
                              }
                            }}
                            className={`flex-1 py-2 rounded-xl text-xs font-black transition cursor-pointer active:scale-95 text-center ${
                              isSelected
                                ? "bg-indigo-600 text-white shadow-xs"
                                : "bg-slate-100 hover:bg-slate-200/80 text-slate-600 hover:text-slate-900"
                            }`}
                          >
                            {labels[opt]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Page Indicator 1 */}
                <div className="flex items-center justify-center gap-1.5 mt-2 pb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                  <button
                    onClick={() => setMobilePage(1)}
                    className="w-1.5 h-1.5 rounded-full bg-slate-300 hover:bg-slate-400 transition"
                    aria-label="Go to Custom Range page"
                  />
                </div>
              </div>

              {/* PAGE 2: Custom Range */}
              <div className="w-1/2 h-full px-5 pb-4 flex flex-col justify-between overflow-y-auto scrollbar-none select-none">
                <div className="space-y-4">
                  <h3 className="text-base font-black text-slate-800 text-center mt-1">
                    Custom Range
                  </h3>

                  <div className="space-y-3 px-1">
                    {/* Start Date */}
                    <div className="space-y-1 text-left">
                      <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                        Start
                      </label>
                      <input
                        type="date"
                        value={draftStartDate}
                        onChange={(e) => {
                          setDraftStartDate(e.target.value);
                          setCustomDateError(null);
                        }}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200/60 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                      />
                    </div>

                    {/* End Date */}
                    <div className="space-y-1 text-left">
                      <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                        End
                      </label>
                      <input
                        type="date"
                        value={draftEndDate}
                        onChange={(e) => {
                          setDraftEndDate(e.target.value);
                          setCustomDateError(null);
                        }}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200/60 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                      />
                    </div>

                    {customDateError && (
                      <div className="text-[10px] font-bold text-rose-500 text-center">
                        {customDateError}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        handleApplyCustomRange();
                        if (!isHistoryOpen) {
                          setIsHistoryOpen(true);
                        }
                      }}
                      className="w-full mt-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-black transition shadow-xs cursor-pointer"
                    >
                      Apply
                    </button>
                  </div>
                </div>

                {/* Page Indicator 2 */}
                <div className="flex items-center justify-center gap-1.5 mt-2 pb-2">
                  <button
                    onClick={() => setMobilePage(0)}
                    className="w-1.5 h-1.5 rounded-full bg-slate-300 hover:bg-slate-400 transition"
                    aria-label="Go to Current Info page"
                  />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}

      {/* 4. REOPEN / SHOW CARD FLOATING BUTTON (WHEN TEMPORARILY COLLAPSED) */}
      {selectedMember && isCardHidden && (
        <div className="absolute bottom-20 md:bottom-22 left-4 md:left-6 z-30 pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200">
          <button
            onClick={handleShowCard}
            className="w-10 h-10 sm:w-11 sm:h-11 bg-white/90 backdrop-blur-2xl rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-white/80 flex items-center justify-center text-slate-700 hover:text-indigo-600 hover:bg-white transition cursor-pointer"
            title="Show card"
            aria-label="Show card"
          >
            <ChevronUp className="w-4.5 h-4.5" />
          </button>
        </div>
      )}

      {/* NO FAKE LOCATIONS EMPTY STATE FLOATING OVERLAY */}
      {membersWithLocation.length === 0 && (
        <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center p-4">
          <div className="bg-white/90 backdrop-blur-2xl p-7 rounded-3xl shadow-2xl border border-white/80 pointer-events-auto text-center max-w-sm">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3.5 mx-auto shadow-sm border border-indigo-100/40">
              <MapPin className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">No device locations available</h3>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed font-semibold">
              Locations will automatically appear when family members connect their Home Assistant Companion App and send real coordinates.
            </p>

            <div className="mt-4 p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100 text-left">
              <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Connection steps:</h4>
              <ul className="mt-2 space-y-1 text-[10px] text-slate-400 list-disc list-inside font-semibold">
                <li>Install Home Assistant Companion App</li>
                <li>Enter this bridge's URL address</li>
                <li>Sign in to sync real location telemetry</li>
              </ul>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
