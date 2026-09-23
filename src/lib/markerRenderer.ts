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
    description: "Iconic teardrop pin with tapered bottom pointer",
    heightRatio: 1.34
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
  borderSize: number = 1.5
): string {
  const initial = memberName.charAt(0).toUpperCase() || "U";
  return `
    <div
      class="relative flex items-center justify-center"
      style="
        width: ${size}px;
        height: ${size}px;
        background-color: #ffffff;
        clip-path: url(#squircle-clip-app);
      "
    >
      <div
        class="absolute flex items-center justify-center text-white font-black overflow-hidden"
        style="
          left: ${borderSize}px;
          right: ${borderSize}px;
          top: ${borderSize}px;
          bottom: ${borderSize}px;
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
  `;
}

/**
 * Renders the HTML string for MapLibre HTML marker element.
 * All shapes are built with precision SVG shells guaranteeing the bottom point is at (width/2, height).
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
    showBattery = true
  } = options;

  const validPinType: MapPinType = (
    MAP_PIN_TYPES.some((t) => t.id === pinType) ? pinType : "classic_pin"
  ) as MapPinType;

  const { width: W, height: H } = getMarkerDimensions(validPinType, size);
  const initial = memberName.charAt(0).toUpperCase() || "U";
  const deviceSVGMarkup = getDeviceIconSVGString(deviceIcon, memberName, "w-[65%] h-[65%] text-indigo-600");
  const hasBattery = showBattery && batteryLevel !== null && batteryLevel !== undefined && batteryLevel !== "";
  const batteryStr = hasBattery ? `${batteryLevel}%` : "";

  // Device badge sizing
  const badgeSize = Math.max(14, Math.min(22, Math.round(W * 0.36)));
  const badgeFontSize = Math.max(8, Math.min(11, Math.round(W * 0.22)));

  // Common shadow filter for selection and depth
  const dropShadowFilter = isSelected
    ? `filter: drop-shadow(0 0 6px ${baseColor}99) drop-shadow(0 6px 14px rgba(0,0,0,0.35));`
    : `filter: drop-shadow(0 2px 6px rgba(0,0,0,0.18));`;

  const borderStroke = isSelected ? baseColor : "#ffffff";
  const strokeWidth = isSelected ? 3 : 2.5;

  let markerContent = "";

  switch (validPinType) {
    case "classic_pin": {
      // Classic Pin: Smooth teardrop pin with continuous curved silhouette tapering to bottom center tip (W/2, H)
      const headRadius = W * 0.44;
      const headCenterY = W * 0.46;
      const avatarSize = Math.round(headRadius * 1.62);

      markerContent = `
        <div class="relative w-full h-full flex flex-col items-center justify-start select-none" style="${dropShadowFilter}">
          <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 ${W} ${H}" fill="none">
            <!-- Pin Body Silhouette -->
            <path
              d="M ${W / 2} ${H - 1}
                 C ${W * 0.28} ${H * 0.72}, ${W * 0.04} ${headCenterY + headRadius * 0.5}, ${W * 0.04} ${headCenterY}
                 A ${headRadius} ${headRadius} 0 1 1 ${W * 0.96} ${headCenterY}
                 C ${W * 0.96} ${headCenterY + headRadius * 0.5}, ${W * 0.72} ${H * 0.72}, ${W / 2} ${H - 1}
                 Z"
              fill="${baseColor}"
              stroke="${borderStroke}"
              stroke-width="${strokeWidth}"
              stroke-linejoin="round"
            />
            <!-- Subtle Inner Pin Highlight -->
            <path
              d="M ${W * 0.16} ${headCenterY - headRadius * 0.4} A ${headRadius * 0.75} ${headRadius * 0.75} 0 0 1 ${W * 0.5} ${headCenterY - headRadius * 0.85}"
              stroke="white"
              stroke-width="1.8"
              stroke-linecap="round"
              opacity="0.5"
            />
          </svg>

          <!-- Avatar / Photo in Head -->
          <div
            class="relative mt-[${Math.round(headCenterY - avatarSize / 2)}px]"
            style="width: ${avatarSize}px; height: ${avatarSize}px; margin-top: ${Math.round(headCenterY - avatarSize / 2)}px;"
          >
            ${renderSharedSquircleAvatar(avatarSize, photoUrl, memberName, baseColor, 2)}
          </div>
        </div>
      `;
      break;
    }

    case "circle": {
      // Circle: Clean round avatar with an integrated bottom geographic anchor pip
      const circleDiameter = W - 4;

      markerContent = `
        <div class="relative w-full h-full flex flex-col items-center justify-start select-none" style="${dropShadowFilter}">
          <!-- Squircle Shell -->
          ${renderSharedSquircleAvatar(circleDiameter, photoUrl, memberName, baseColor, isSelected ? 3.5 : 2.5)}

          <!-- Bottom Location Anchor Pip -->
          <svg class="w-4 h-3 -mt-0.5 pointer-events-none" viewBox="0 0 16 12" fill="none">
            <path
              d="M 8 11 L 3 2 Q 8 0 13 2 Z"
              fill="${baseColor}"
              stroke="${borderStroke}"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
            <circle cx="8" cy="4" r="1.5" fill="white" />
          </svg>
        </div>
      `;
      break;
    }

    case "teardrop": {
      // Teardrop: Smooth organic teardrop contour with point at bottom center
      const headR = W * 0.44;
      const headY = W * 0.44;
      const avatarSize = Math.round(W * 0.65);

      markerContent = `
        <div class="relative w-full h-full flex flex-col items-center justify-start select-none" style="${dropShadowFilter}">
          <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 ${W} ${H}" fill="none">
            <!-- Organic Teardrop Silhouette -->
            <path
              d="M ${W / 2} ${H - 1}
                 C ${W * 0.18} ${H * 0.68}, ${W * 0.05} ${headY + headR * 0.4}, ${W * 0.05} ${headY}
                 A ${headR} ${headR} 0 1 1 ${W * 0.95} ${headY}
                 C ${W * 0.95} ${headY + headR * 0.4}, ${W * 0.82} ${H * 0.68}, ${W / 2} ${H - 1}
                 Z"
              fill="#ffffff"
              stroke="${baseColor}"
              stroke-width="${isSelected ? 3.5 : 2.5}"
              stroke-linejoin="round"
            />
          </svg>

          <!-- Avatar Inside Teardrop -->
          <div
            class="relative overflow-hidden"
            style="
              width: ${avatarSize}px;
              height: ${avatarSize}px;
              margin-top: ${Math.round(headY - avatarSize / 2)}px;
            "
          >
            ${renderSharedSquircleAvatar(avatarSize, photoUrl, memberName, baseColor, 0)}
          </div>
        </div>
      `;
      break;
    }

    case "beacon": {
      // Beacon: Modern radar location beacon with concentric pulsed rings and sharp anchor needle
      const coreSize = Math.round(W * 0.68);

      markerContent = `
        <div class="relative w-full h-full flex flex-col items-center justify-start select-none" style="${dropShadowFilter}">
          <!-- Outer Radar Halo Ring -->
          <div class="relative flex items-center justify-center" style="width: ${W}px; height: ${W}px;">
            <div
              class="absolute inset-0 rounded-full border-2 opacity-30 animate-pulse pointer-events-none"
              style="border-color: ${baseColor};"
            ></div>
            <div
              class="absolute inset-1.5 rounded-full border border-dashed opacity-50 pointer-events-none"
              style="border-color: ${baseColor};"
            ></div>

            <!-- Central Beacon Core -->
            <div
              class="relative flex items-center justify-center transition-all"
              style="
                width: ${coreSize}px;
                height: ${coreSize}px;
              "
            >
              ${renderSharedSquircleAvatar(coreSize, photoUrl, memberName, baseColor, isSelected ? 3 : 2)}
            </div>
          </div>

          <!-- Bottom Location Needle Pointer -->
          <svg class="w-3 h-4 -mt-1 pointer-events-none" viewBox="0 0 12 16" fill="none">
            <path
              d="M 6 15 L 1 0 L 11 0 Z"
              fill="${baseColor}"
              stroke="#ffffff"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
            <circle cx="6" cy="3" r="1.5" fill="white" />
          </svg>
        </div>
      `;
      break;
    }

    case "badge": {
      // Badge: Premium rounded shield/badge silhouette with bottom crest anchor point
      const avatarSize = Math.round(W * 0.62);

      markerContent = `
        <div class="relative w-full h-full flex flex-col items-center justify-start select-none" style="${dropShadowFilter}">
          <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 ${W} ${H}" fill="none">
            <!-- Badge Shield Outline -->
            <path
              d="M ${W * 0.15} 4
                 C ${W * 0.15} 2, ${W * 0.85} 2, ${W * 0.85} 4
                 C ${W * 0.96} 4, ${W * 0.96} ${H * 0.55}, ${W * 0.90} ${H * 0.65}
                 L ${W / 2} ${H - 1}
                 L ${W * 0.10} ${H * 0.65}
                 C ${W * 0.04} ${H * 0.55}, ${W * 0.04} 4, ${W * 0.15} 4
                 Z"
              fill="#ffffff"
              stroke="${baseColor}"
              stroke-width="${isSelected ? 3.5 : 2.5}"
              stroke-linejoin="round"
            />
          </svg>

          <!-- Avatar Inside Badge -->
          <div
            class="relative"
            style="
              width: ${avatarSize}px;
              height: ${avatarSize}px;
              margin-top: ${Math.round((W - avatarSize) / 2)}px;
            "
          >
            ${renderSharedSquircleAvatar(avatarSize, photoUrl, memberName, baseColor, 0)}
          </div>
        </div>
      `;
      break;
    }

    case "minimal": {
      // Minimal: Ultra-compact, clean avatar medallion atop a sharp precision anchor needle
      const circleDiameter = Math.round(W * 0.72);

      markerContent = `
        <div class="relative w-full h-full flex flex-col items-center justify-start select-none" style="${dropShadowFilter}">
          <!-- Compact Medallion -->
          <div
            class="relative flex items-center justify-center transition-all"
            style="
              width: ${circleDiameter}px;
              height: ${circleDiameter}px;
            "
          >
            ${renderSharedSquircleAvatar(circleDiameter, photoUrl, memberName, baseColor, isSelected ? 2.5 : 2)}
          </div>

          <!-- Precision Needle Point -->
          <svg class="w-2.5 h-4 -mt-0.5 pointer-events-none" viewBox="0 0 10 16" fill="none">
            <path
              d="M 5 15 L 1 0 L 9 0 Z"
              fill="${baseColor}"
              stroke="#ffffff"
              stroke-width="1.2"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      `;
      break;
    }

    case "arrow": {
      // Arrow: Dynamic angular chevron frame with directional bottom arrow point
      const avatarSize = Math.round(W * 0.58);

      markerContent = `
        <div class="relative w-full h-full flex flex-col items-center justify-start select-none" style="${dropShadowFilter}">
          <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 ${W} ${H}" fill="none">
            <!-- Arrow Frame Silhouette -->
            <path
              d="M ${W * 0.20} 3
                 L ${W * 0.80} 3
                 C ${W * 0.94} 3, ${W * 0.98} ${W * 0.45}, ${W * 0.90} ${W * 0.65}
                 L ${W / 2} ${H - 1}
                 L ${W * 0.10} ${W * 0.65}
                 C ${W * 0.02} ${W * 0.45}, ${W * 0.06} 3, ${W * 0.20} 3
                 Z"
              fill="${baseColor}"
              stroke="${borderStroke}"
              stroke-width="${strokeWidth}"
              stroke-linejoin="round"
            />
          </svg>

          <!-- Avatar in Arrow Core -->
          <div
            class="relative flex items-center justify-center overflow-hidden"
            style="
              width: ${avatarSize}px;
              height: ${avatarSize}px;
              margin-top: ${Math.round((W * 0.65 - avatarSize) / 2 + 2)}px;
            "
          >
            ${renderSharedSquircleAvatar(avatarSize, photoUrl, memberName, baseColor, 1)}
          </div>
        </div>
      `;
      break;
    }

    case "photo_pin": {
      // Photo Pin: Premium dominant photo-first frame with bottom anchor stem
      const frameDiameter = W - 2;

      markerContent = `
        <div class="relative w-full h-full flex flex-col items-center justify-start select-none" style="${dropShadowFilter}">
          <!-- Photo Frame -->
          <div
            class="relative flex items-center justify-center transition-all overflow-hidden"
            style="
              width: ${frameDiameter}px;
              height: ${frameDiameter}px;
            "
          >
            ${renderSharedSquircleAvatar(frameDiameter, photoUrl, memberName, baseColor, isSelected ? 3 : 2.5)}
          </div>

          <!-- Bottom Location Anchor Tip -->
          <svg class="w-3.5 h-3.5 -mt-1 pointer-events-none" viewBox="0 0 14 14" fill="none">
            <path
              d="M 7 13 L 2 1 L 12 1 Z"
              fill="${baseColor}"
              stroke="#ffffff"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      `;
      break;
    }
  }

  // Device & Battery Badges (Uniform, High-Contrast, Perfectly Anchored)
  const deviceBadge = `
    <div
      class="absolute -top-1 -left-1 bg-white text-slate-800 rounded-full shadow-xs border border-slate-200/90 flex items-center justify-center pointer-events-none z-10"
      style="width: ${badgeSize}px; height: ${badgeSize}px;"
      title="Connected device"
    >
      ${deviceSVGMarkup}
    </div>
  `;

  const batteryBadge = batteryStr
    ? `
      <div
        class="absolute -top-1 -right-1 bg-white text-slate-800 font-extrabold px-1 rounded-full shadow-xs border border-slate-200/90 flex items-center gap-0.5 pointer-events-none z-10"
        style="font-size: 8px; line-height: 12px; height: 14px;"
        title="Battery: ${batteryStr}"
      >
        <span class="w-1.5 h-1.5 rounded-full ${parseInt(batteryStr, 10) <= 20 ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}"></span>
        <span>${batteryStr}</span>
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
      ${markerContent}
      ${deviceBadge}
      ${batteryBadge}
    </div>
  `;
}
