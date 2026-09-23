/**
 * Commercial-Grade Map Marker Rendering System
 * Supports 8 distinct, professionally crafted pin silhouettes with exact GPS geographic anchor alignment.
 */

import { getDeviceIconSVGString } from "../components/DeviceIcon";

export type MapPinType =
  | "classic_pin"
  | "circle"
  | "teardrop"
  | "beacon"
  | "badge"
  | "minimal"
  | "arrow"
  | "photo_pin";

export interface MapPinTypeDefinition {
  id: MapPinType;
  name: string;
  description: string;
  heightRatio: number; // Height = width * heightRatio
}

export const MAP_PIN_TYPES: MapPinTypeDefinition[] = [
  {
    id: "classic_pin",
    name: "Classic Pin",
    description: "Squircle map pin with integrated downward pointer",
    heightRatio: 1.18
  },
  {
    id: "circle",
    name: "Circle",
    description: "Clean circular avatar with integrated location anchor",
    heightRatio: 1.16
  },
  {
    id: "teardrop",
    name: "Teardrop",
    description: "Smooth organic teardrop silhouette with precision point",
    heightRatio: 1.32
  },
  {
    id: "beacon",
    name: "Beacon",
    description: "Modern radar beacon marker with location anchor",
    heightRatio: 1.28
  },
  {
    id: "badge",
    name: "Badge",
    description: "Premium shield badge with downward anchor point",
    heightRatio: 1.24
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Compact avatar medallion on a precision location needle",
    heightRatio: 1.38
  },
  {
    id: "arrow",
    name: "Arrow",
    description: "Directional geometric marker with crisp downward tip",
    heightRatio: 1.30
  },
  {
    id: "photo_pin",
    name: "Photo Pin",
    description: "Dominant edge-to-edge photo portrait in a sleek pin frame",
    heightRatio: 1.30
  }
];

export function getPinTypeDefinition(type?: string | null): MapPinTypeDefinition {
  const found = MAP_PIN_TYPES.find((t) => t.id === type);
  return found || MAP_PIN_TYPES[0];
}

export interface StackedMemberInfo {
  id: number | string;
  memberName: string;
  baseColor: string;
  photoUrl?: string | null;
  deviceIcon?: string;
  batteryLevel?: number | string | null;
}

export interface RenderMarkerOptions {
  pinType?: MapPinType | string | null;
  baseColor: string;
  isSelected?: boolean;
  size: number; // width in pixels
  photoUrl?: string | null;
  memberName: string;
  deviceIcon?: string;
  batteryLevel?: number | string | null;
  showBattery?: boolean;
  balloonOffset?: { dx: number; dy: number };
  isPrimary?: boolean;
  stackedMembers?: StackedMemberInfo[];
}

/**
 * Calculates outer element dimensions for the marker.
 * Anchor is always 'bottom' so the bottommost tip represents exact GPS coordinate.
 */
export function getMarkerDimensions(pinType: MapPinType | string | null | undefined, width: number) {
  const def = getPinTypeDefinition(pinType);
  const height = Math.round(width * def.heightRatio);
  return {
    width,
    height,
    anchor: "bottom" as const
  };
}

/**
 * Escapes HTML entities safely for innerHTML injection
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Renders a mathematical squircle avatar that matches the bottom map selector.
 */
function renderSharedSquircleAvatar(
  size: number,
  photoUrl: string | null,
  memberName: string,
  baseColor: string,
  outerBorderSize: number = 3.5,
  separatorSize: number = 1.5
): string {
  const initial = memberName.charAt(0).toUpperCase() || "U";
  return `
    <div
      class="relative flex items-center justify-center pointer-events-none"
      style="
        width: ${size}px;
        height: ${size}px;
        background-color: ${baseColor};
        clip-path: url(#squircle-clip-app);
      "
    >
      <!-- Subtle neutral grey separator layer immediately inside the outer baseColor border -->
      <div
        class="absolute flex items-center justify-center pointer-events-none"
        style="
          left: ${outerBorderSize}px;
          right: ${outerBorderSize}px;
          top: ${outerBorderSize}px;
          bottom: ${outerBorderSize}px;
          background-color: #e2e8f0;
          clip-path: url(#squircle-clip-app);
        "
      >
        <!-- Inner user photo/initial squircle container -->
        <div
          class="absolute flex items-center justify-center text-white font-black overflow-hidden pointer-events-none"
          style="
            left: ${separatorSize}px;
            right: ${separatorSize}px;
            top: ${separatorSize}px;
            bottom: ${separatorSize}px;
            background-color: ${baseColor};
            clip-path: url(#squircle-clip-app);
          "
        >
          ${
            photoUrl
              ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(memberName)}" class="w-full h-full object-cover pointer-events-none" style="clip-path: url(#squircle-clip-app);" />`
              : `<span class="text-white font-extrabold text-xs drop-shadow-xs">${escapeHtml(initial)}</span>`
          }
        </div>
      </div>
    </div>
  `;
}

/**
 * Renders the HTML string for MapLibre HTML marker element.
 * Geographically anchored to exact GPS coordinates.
 * Supports smooth profile rotation and combined member gradients when multiple users share a location.
 */
export function renderMarkerHTML(options: RenderMarkerOptions): string {
  const {
    pinType = "classic_pin",
    baseColor = "#4f46e5",
    isSelected = false,
    size = 48,
    photoUrl = null,
    memberName = "Member",
    deviceIcon = "📱",
    batteryLevel = null,
    showBattery = true,
    isPrimary = true,
    stackedMembers
  } = options;

  const breathingClass = isPrimary ? "marker-breathe-primary" : "marker-breathe-secondary";

  const validPinType: MapPinType = (
    MAP_PIN_TYPES.some((t) => t.id === pinType) ? pinType : "classic_pin"
  ) as MapPinType;

  const { width: W, height: H } = getMarkerDimensions(validPinType, size);
  const squircleSize = W;
  const outerBorder = isSelected ? 4 : 3.5;
  const separatorThickness = 1.5;

  const isStacked = Boolean(stackedMembers && stackedMembers.length > 1);
  const memberList: StackedMemberInfo[] = isStacked
    ? stackedMembers!
    : [
        {
          id: "single",
          memberName,
          baseColor,
          photoUrl,
          deviceIcon,
          batteryLevel
        }
      ];

  const memberCount = memberList.length;
  const memberColors = memberList.map((m) => m.baseColor || "#4f46e5");

  // Combined member colour gradient for outer border and pointer
  let outerBackgroundCSS = baseColor;
  let pointerFill = baseColor;
  let svgGradientDefs = "";

  if (isStacked) {
    const gradientStopsCSS = memberColors
      .map((c, idx) => {
        const pct = Math.round((idx / (memberColors.length - 1)) * 100);
        return `${c} ${pct}%`;
      })
      .join(", ");
    outerBackgroundCSS = `linear-gradient(135deg, ${gradientStopsCSS})`;

    const gradId = `stack-grad-${Math.abs(
      memberList.reduce((acc, m) => ((acc << 5) - acc + String(m.id).charCodeAt(0)) | 0, 0)
    )}`;
    const svgStops = memberColors
      .map((c, idx) => {
        const pct = Math.round((idx / (memberColors.length - 1)) * 100);
        return `<stop offset="${pct}%" stop-color="${escapeHtml(c)}" />`;
      })
      .join("");
    svgGradientDefs = `
      <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
        ${svgStops}
      </linearGradient>
    `;
    pointerFill = `url(#${gradId})`;
  }

  // Pointer geometry: meets border at 14-18px wide (max 20px), stretches narrow to rounded tip at (W/2, H - 1)
  const pointerTopWidth = Math.min(18, Math.max(14, Math.round(W * 0.34)));
  const pointerHalfWidth = pointerTopWidth / 2;
  const midX = W / 2;
  const tipY = H - 1;

  // Avatars content markup (single user or smooth rotating crossfade for stacked members)
  const crossfadeClass = isStacked ? `marker-crossfade-${Math.min(memberCount, 8)}` : "";
  const avatarLayersHTML = memberList
    .map((m, idx) => {
      const initial = m.memberName.charAt(0).toUpperCase() || "U";
      const delayStyle = isStacked ? `animation-delay: -${(idx * 3.6).toFixed(2)}s;` : "";
      return `
        <div
          class="${isStacked ? "absolute inset-0" : "relative"} w-full h-full flex items-center justify-center text-white font-black overflow-hidden pointer-events-none ${crossfadeClass}"
          style="
            background-color: ${m.baseColor};
            clip-path: url(#squircle-clip-app);
            ${delayStyle}
          "
        >
          ${
            m.photoUrl
              ? `<img src="${escapeHtml(m.photoUrl)}" alt="${escapeHtml(m.memberName)}" class="w-full h-full object-cover pointer-events-none" style="clip-path: url(#squircle-clip-app);" />`
              : `<span class="text-white font-extrabold text-xs drop-shadow-xs">${escapeHtml(initial)}</span>`
          }
        </div>
      `;
    })
    .join("");

  // Squircle Body HTML
  const squircleBody = `
    <div
      class="relative flex items-center justify-center pointer-events-auto select-none"
      style="
        width: ${squircleSize}px;
        height: ${squircleSize}px;
        background: ${outerBackgroundCSS};
        clip-path: url(#squircle-clip-app);
      "
    >
      <!-- Layer 2: Subtle Neutral Grey Separator (~1.5px, #e2e8f0 / slate-200) -->
      <div
        class="absolute flex items-center justify-center pointer-events-none"
        style="
          left: ${outerBorder}px;
          right: ${outerBorder}px;
          top: ${outerBorder}px;
          bottom: ${outerBorder}px;
          background-color: #e2e8f0;
          clip-path: url(#squircle-clip-app);
        "
      >
        <!-- Layer 3: Inner Squircle Photo/Initial Container -->
        <div
          class="relative w-full h-full flex items-center justify-center overflow-hidden pointer-events-none"
          style="
            margin: ${separatorThickness}px;
            background-color: #0f172a;
            clip-path: url(#squircle-clip-app);
          "
        >
          ${avatarLayersHTML}
        </div>
      </div>
    </div>
  `;

  // Battery badges HTML (synchronized with rotating crossfade when stacked)
  let batteryBadgesHTML = "";
  if (showBattery) {
    if (!isStacked) {
      const hasBattery = batteryLevel !== null && batteryLevel !== undefined && batteryLevel !== "";
      if (hasBattery) {
        const batteryStr = `${batteryLevel}%`;
        const batteryVal = parseInt(batteryStr, 10);
        batteryBadgesHTML = `
          <div
            class="absolute -top-1 -right-1 bg-white text-slate-800 font-extrabold px-1 rounded-full shadow-xs border border-slate-200/90 flex items-center gap-0.5 pointer-events-none z-10"
            style="font-size: 8px; line-height: 12px; height: 14px;"
            title="Battery: ${batteryStr}"
          >
            <span class="w-1.5 h-1.5 rounded-full ${batteryVal <= 20 ? "bg-rose-500 animate-pulse" : "bg-emerald-500"}"></span>
            <span>${batteryStr}</span>
          </div>
        `;
      }
    } else {
      batteryBadgesHTML = memberList
        .map((m, idx) => {
          const hasBatt = m.batteryLevel !== null && m.batteryLevel !== undefined && m.batteryLevel !== "";
          if (!hasBatt) return "";
          const bStr = `${m.batteryLevel}%`;
          const bVal = parseInt(bStr, 10);
          return `
            <div
              class="absolute -top-1 -right-1 bg-white text-slate-800 font-extrabold px-1 rounded-full shadow-xs border border-slate-200/90 flex items-center gap-0.5 pointer-events-none z-10 ${crossfadeClass}"
              style="
                font-size: 8px;
                line-height: 12px;
                height: 14px;
                animation-delay: -${(idx * 3.6).toFixed(2)}s;
              "
              title="Battery: ${bStr}"
            >
              <span class="w-1.5 h-1.5 rounded-full ${bVal <= 20 ? "bg-rose-500 animate-pulse" : "bg-emerald-500"}"></span>
              <span>${bStr}</span>
            </div>
          `;
        })
        .join("");
    }
  }

  return `
    <div class="relative w-full h-full cursor-pointer flex items-center justify-center overflow-visible select-none">
      <!-- Shared mathematical squircle definition -->
      <svg class="absolute w-0 h-0 pointer-events-none" width="0" height="0">
        <defs>
          <clipPath id="squircle-clip-app" clipPathUnits="objectBoundingBox">
            <path d="M 0.5,0 C 0.86,0 1,0.14 1,0.5 C 1,0.86 0.86,1 0.5,1 C 0.14,1 0,0.86 0,0.5 C 0,0.14 0.14,0 0.5,0 Z" />
          </clipPath>
        </defs>
      </svg>

      <!-- Inner visual wrapper for breathing animation (anchored at center bottom without affecting map GPS anchor) -->
      <div
        class="relative w-full h-full flex items-start justify-center pointer-events-auto ${breathingClass}"
        style="transform-origin: center bottom;"
      >
        <!-- Seamless continuous pointer grounded at exact GPS point (W/2, H - 1) -->
        <svg class="absolute inset-0 w-full h-full pointer-events-none overflow-visible" viewBox="0 0 ${W} ${H}" fill="none">
          <defs>
            ${svgGradientDefs}
          </defs>
          <path
            d="M ${midX - pointerHalfWidth} ${squircleSize - 3}
               L ${midX + pointerHalfWidth} ${squircleSize - 3}
               L ${midX + 1.2} ${tipY - 2.5}
               Q ${midX} ${tipY} ${midX - 1.2} ${tipY - 2.5}
               Z"
            fill="${pointerFill}"
            stroke="${pointerFill}"
            stroke-width="0.8"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>

        <!-- Squircle Body Container -->
        <div class="relative" style="width: ${squircleSize}px; height: ${squircleSize}px;">
          ${squircleBody}
          ${batteryBadgesHTML}
        </div>
      </div>
    </div>
  `;
}

/**
 * Calculates scale percentage for same-location grouped markers:
 * 1 member = 100% (1.0), 2 = 90% (0.9), 3 = 80% (0.8), 4 = 70% (0.7), 5 = 60% (0.6), etc.
 * Enforces a sensible minimum scale (45%).
 */
export function getClusterScale(clusterMemberCount: number): number {
  if (clusterMemberCount <= 1) return 1.0;
  const scale = 1.0 - (clusterMemberCount - 1) * 0.10;
  return Math.max(0.45, Math.round(scale * 100) / 100);
}

export interface BalloonOffset {
  dx: number;
  dy: number;
  zIndex: number;
}

/**
 * Computes organic, natural floating balloon bouquet offsets for same-location individual markers.
 * Offset represents the visual displacement of the balloon body while the pin tip remains
 * anchored to the user's exact GPS coordinates.
 * Features varied heights, non-uniform compact overlaps, and clear avatar visibility.
 */
export function getBalloonOffsets(count: number, markerWidth: number, markerHeight: number): BalloonOffset[] {
  const W = markerWidth;
  const H = markerHeight;

  if (count <= 1) {
    return [{ dx: 0, dy: 0, zIndex: 10 }];
  }

  if (count === 2) {
    // 2 balloons: organic slight asymmetric overlap, varied height, compact grouping
    return [
      {
        dx: -Math.round(W * 0.38),
        dy: -Math.round(H * 0.16),
        zIndex: 10
      },
      {
        dx: Math.round(W * 0.34),
        dy: -Math.round(H * 0.04),
        zIndex: 12
      }
    ];
  }

  if (count === 3) {
    // 3 balloons: compact organic triangle bunch with upper floater and staggered foreground
    return [
      {
        dx: -Math.round(W * 0.42),
        dy: -Math.round(H * 0.10),
        zIndex: 11
      },
      {
        dx: Math.round(W * 0.04),
        dy: -Math.round(H * 0.44),
        zIndex: 10
      },
      {
        dx: Math.round(W * 0.38),
        dy: -Math.round(H * 0.02),
        zIndex: 13
      }
    ];
  }

  if (count === 4) {
    // 4 balloons: natural bouquet with 2 upper floaters at different heights and 2 overlapping foreground balloons
    return [
      {
        dx: -Math.round(W * 0.40),
        dy: -Math.round(H * 0.36),
        zIndex: 10
      },
      {
        dx: Math.round(W * 0.28),
        dy: -Math.round(H * 0.44),
        zIndex: 11
      },
      {
        dx: -Math.round(W * 0.32),
        dy: Math.round(H * 0.02),
        zIndex: 13
      },
      {
        dx: Math.round(W * 0.40),
        dy: -Math.round(H * 0.06),
        zIndex: 14
      }
    ];
  }

  if (count === 5) {
    // 5 balloons: rich organic bouquet with varied layering, non-symmetrical floaters, and natural overlaps
    return [
      {
        dx: -Math.round(W * 0.48),
        dy: -Math.round(H * 0.16),
        zIndex: 11
      },
      {
        dx: -Math.round(W * 0.18),
        dy: -Math.round(H * 0.48),
        zIndex: 10
      },
      {
        dx: Math.round(W * 0.30),
        dy: -Math.round(H * 0.40),
        zIndex: 12
      },
      {
        dx: -Math.round(W * 0.04),
        dy: Math.round(H * 0.06),
        zIndex: 15
      },
      {
        dx: Math.round(W * 0.44),
        dy: -Math.round(H * 0.08),
        zIndex: 14
      }
    ];
  }

  // Multi-balloon organic floating bouquet for count >= 6
  const offsets: BalloonOffset[] = [];
  for (let i = 0; i < count; i++) {
    const phi = i * 2.399963; // golden angle (~137.5 deg)
    const normI = i / (count - 1);
    const radiusX = Math.round(W * (0.32 + normI * 0.28));
    const radiusY = Math.round(H * (0.22 + normI * 0.34));

    const dx = Math.round(Math.sin(phi) * radiusX);
    const dy = Math.round(-radiusY * (0.35 + 0.65 * Math.abs(Math.cos(phi))) + (i % 2 === 0 ? 4 : -4));
    const zIndex = 10 + Math.round(dy + H);

    offsets.push({ dx, dy, zIndex });
  }

  return offsets;
}

/**
 * Calculates geographic distance in meters between two lat/lng points.
 */
export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface CombinedMemberItem {
  id: number | string;
  name: string;
  baseColor: string;
  photoUrl?: string | null;
  deviceIcon?: string;
  batteryLevel?: number | string | null;
  isSelected?: boolean;
}

export interface RenderCombinedMarkerOptions {
  members: CombinedMemberItem[];
  size: number;
  showBattery?: boolean;
}

/**
 * Calculates outer element dimensions for a combined multi-user speech-bubble marker.
 */
export function getCombinedMarkerDimensions(memberCount: number, size: number) {
  const outerBorder = 3.5;
  const separatorThickness = 1.5;
  const avatarSize = Math.max(22, size - 10);
  const gap = 4;
  const bubbleHeight = avatarSize + (outerBorder + separatorThickness) * 2;
  const bubbleWidth = (outerBorder + separatorThickness) * 2 + memberCount * avatarSize + (memberCount - 1) * gap + 2;
  const tipHeight = 7;
  const totalHeight = bubbleHeight + tipHeight;

  return {
    width: Math.round(bubbleWidth),
    height: Math.round(totalHeight),
    bubbleWidth: Math.round(bubbleWidth),
    bubbleHeight: Math.round(bubbleHeight),
    avatarSize: Math.round(avatarSize),
    anchor: "bottom" as const
  };
}

/**
 * Renders the HTML string for a combined multi-user speech-bubble marker.
 * Displays all users at the same location inside one unified speech bubble with ONE shared outer border
 * divided cleanly into distinct color sections matching each user's avatar color.
 */
export function renderCombinedMarkerHTML(options: RenderCombinedMarkerOptions): string {
  const { members, size = 48, showBattery = true } = options;
  if (!members || members.length === 0) return "";

  const dims = getCombinedMarkerDimensions(members.length, size);
  const outerBorder = 3.5;
  const separatorThickness = 1.5;

  // Build clean segmented color stops matching each user's avatar color from left to right
  const memberCount = members.length;
  const colorStopsCSS = members
    .map((m, idx) => {
      const startPct = ((idx / memberCount) * 100).toFixed(2);
      const endPct = (((idx + 1) / memberCount) * 100).toFixed(2);
      return `${m.baseColor} ${startPct}%, ${m.baseColor} ${endPct}%`;
    })
    .join(", ");
  const multiColorBackground = `linear-gradient(to right, ${colorStopsCSS})`;

  const gradientId = `bubble-tip-grad-${members.map((m) => String(m.id)).join("-")}`;
  const svgColorStops = members
    .map((m, idx) => {
      const startPct = ((idx / memberCount) * 100).toFixed(2);
      const endPct = (((idx + 1) / memberCount) * 100).toFixed(2);
      return `<stop offset="${startPct}%" stop-color="${escapeHtml(m.baseColor)}" /><stop offset="${endPct}%" stop-color="${escapeHtml(m.baseColor)}" />`;
    })
    .join("");

  const tipX = dims.bubbleWidth / 2;
  const tipY = dims.height - 1;
  const pointerHalfWidth = 6;

  // Render individual squircle avatars inside the bubble
  const avatarsMarkup = members
    .map((m) => {
      const initial = m.name.charAt(0).toUpperCase() || "U";
      const isCurrentSelected = Boolean(m.isSelected);

      return `
        <div
          data-member-id="${escapeHtml(String(m.id))}"
          class="relative flex items-center justify-center shrink-0 cursor-pointer pointer-events-auto transition-transform active:scale-95 select-none hover:opacity-95"
          style="
            width: ${dims.avatarSize}px;
            height: ${dims.avatarSize}px;
            background-color: ${m.baseColor};
            clip-path: url(#squircle-clip-app);
            ${isCurrentSelected ? 'outline: 2px solid white; outline-offset: -1px; z-index: 2;' : ''}
          "
          title="${escapeHtml(m.name)}"
        >
          ${
            m.photoUrl
              ? `<img src="${escapeHtml(m.photoUrl)}" alt="${escapeHtml(m.name)}" class="w-full h-full object-cover pointer-events-none" style="clip-path: url(#squircle-clip-app);" />`
              : `<span class="text-white font-black text-xs leading-none pointer-events-none">${escapeHtml(initial)}</span>`
          }
        </div>
      `;
    })
    .join("");

  // Primary or lowest battery level
  let lowestBattery: number | null = null;
  if (showBattery) {
    members.forEach((m) => {
      if (m.batteryLevel !== null && m.batteryLevel !== undefined && m.batteryLevel !== "") {
        const num = typeof m.batteryLevel === "number" ? m.batteryLevel : parseInt(String(m.batteryLevel), 10);
        if (!isNaN(num)) {
          if (lowestBattery === null || num < lowestBattery) {
            lowestBattery = num;
          }
        }
      }
    });
  }

  const batteryBadge = lowestBattery !== null
    ? `
      <div
        class="absolute -top-1 -right-1 bg-white text-slate-800 font-extrabold px-1 rounded-full shadow-xs border border-slate-200/90 flex items-center gap-0.5 pointer-events-none z-10"
        style="font-size: 8px; line-height: 12px; height: 14px;"
        title="Battery: ${lowestBattery}%"
      >
        <span class="w-1.5 h-1.5 rounded-full ${lowestBattery <= 20 ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}"></span>
        <span>${lowestBattery}%</span>
      </div>
    `
    : "";

  return `
    <div class="relative w-full h-full cursor-pointer flex items-center justify-center">
      <!-- Shared mathematical squircle definition ensuring zero dependency delay inside map components -->
      <svg class="absolute w-0 h-0 pointer-events-none" width="0" height="0">
        <defs>
          <clipPath id="squircle-clip-app" clipPathUnits="objectBoundingBox">
            <path d="M 0.5,0 C 0.86,0 1,0.14 1,0.5 C 1,0.86 0.86,1 0.5,1 C 0.14,1 0,0.86 0,0.5 C 0,0.14 0.14,0 0.5,0 Z" />
          </clipPath>
        </defs>
      </svg>

      <div class="relative w-full h-full flex flex-col items-center justify-start select-none">
        <!-- Layer 1: Shared Outer Border Shell with distinct multi-user color sections -->
        <div
          class="relative flex items-center justify-center pointer-events-auto"
          style="
            width: ${dims.bubbleWidth}px;
            height: ${dims.bubbleHeight}px;
            background: ${multiColorBackground};
            border-radius: 9999px;
          "
        >
          <!-- Layer 2: Shared Subtle Neutral Grey Separator (~1.5px, #e2e8f0) -->
          <div
            class="absolute flex items-center justify-center pointer-events-none"
            style="
              left: ${outerBorder}px;
              right: ${outerBorder}px;
              top: ${outerBorder}px;
              bottom: ${outerBorder}px;
              background-color: #e2e8f0;
              border-radius: 9999px;
            "
          >
            <!-- Layer 3: Inner Content Area with all user avatars -->
            <div
              class="absolute inset-0 flex items-center justify-center gap-1 overflow-hidden pointer-events-auto"
              style="
                left: ${separatorThickness}px;
                right: ${separatorThickness}px;
                top: ${separatorThickness}px;
                bottom: ${separatorThickness}px;
                background-color: #ffffff;
                border-radius: 9999px;
                padding: 0 1px;
              "
            >
              ${avatarsMarkup}
            </div>
          </div>
        </div>

        <!-- Downward-pointing triangular tip extending seamlessly from shared outer border with matching gradient -->
        <svg
          class="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 ${dims.bubbleWidth} ${dims.height}"
          fill="none"
        >
          <defs>
            <linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${dims.bubbleWidth}" y2="0">
              ${svgColorStops}
            </linearGradient>
          </defs>
          <polygon
            points="${tipX - pointerHalfWidth},${dims.bubbleHeight - 3} ${tipX + pointerHalfWidth},${dims.bubbleHeight - 3} ${tipX},${tipY}"
            fill="url(#${gradientId})"
          />
        </svg>
      </div>

      ${batteryBadge}
    </div>
  `;
}
