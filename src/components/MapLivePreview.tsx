import React, { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getMapStyle } from "../lib/mapStyles";

interface MapLivePreviewProps {
  styleId: string;
  selectedIconSize: number;
  unselectedIconSize: number;
  userColor?: string;
  userPhoto?: string | null;
  userInitial?: string;
  deviceIcon?: string;
}

export const MapLivePreview: React.FC<MapLivePreviewProps> = ({
  styleId,
  selectedIconSize,
  unselectedIconSize,
  userColor = "#E2D9F3",
  userPhoto = null,
  userInitial = "U",
  deviceIcon = "📱 Phone"
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const selectedMarkerRef = useRef<maplibregl.Marker | null>(null);
  const unselectedMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current) return;

    const styleOpt = getMapStyle(styleId);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleOpt.style,
      center: [-122.4194, 37.7749],
      zoom: 13,
      attributionControl: false,
      interactive: true
    });

    mapRef.current = map;

    // Create Selected Marker Element
    const selEl = document.createElement("div");
    selEl.className = "preview-selected-marker flex items-center justify-center transition-all duration-150";
    const selectedMarker = new maplibregl.Marker({ element: selEl })
      .setLngLat([-122.4194, 37.7749])
      .addTo(map);
    selectedMarkerRef.current = selectedMarker;

    // Create Unselected Marker Element
    const unselEl = document.createElement("div");
    unselEl.className = "preview-unselected-marker flex items-center justify-center transition-all duration-150";
    const unselectedMarker = new maplibregl.Marker({ element: unselEl })
      .setLngLat([-122.4080, 37.7830])
      .addTo(map);
    unselectedMarkerRef.current = unselectedMarker;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Map Style when styleId changes
  useEffect(() => {
    if (!mapRef.current) return;
    const styleOpt = getMapStyle(styleId);
    mapRef.current.setStyle(styleOpt.style);
  }, [styleId]);

  // Update Markers HTML and sizes
  useEffect(() => {
    const rawEmoji = deviceIcon ? deviceIcon.split(" ")[0] : "📱";

    // Update Selected Marker
    if (selectedMarkerRef.current) {
      const el = selectedMarkerRef.current.getElement();
      el.style.width = `${selectedIconSize}px`;
      el.style.height = `${selectedIconSize}px`;
      const innerSize = Math.max(16, selectedIconSize - 6);

      el.innerHTML = `
        <div class="relative w-full h-full rounded-full flex items-center justify-center"
             style="
               background-color: white;
               padding: 3px;
               box-shadow: 0 0 0 3px ${userColor}, 0 8px 20px rgba(0,0,0,0.25);
             ">
          <div class="w-full h-full rounded-full text-white font-black text-xs flex items-center justify-center overflow-hidden"
               style="
                 width: ${innerSize}px;
                 height: ${innerSize}px;
                 background-color: ${userColor};
               ">
            ${
              userPhoto
                ? `<img src="${userPhoto}" alt="User" class="w-full h-full object-cover rounded-full pointer-events-none" />`
                : `<span class="text-slate-800 font-bold">${userInitial}</span>`
            }
          </div>
          <div class="absolute -top-1 -left-1 bg-white text-slate-800 text-[10px] w-4.5 h-4.5 rounded-full shadow-xs border border-slate-200 flex items-center justify-center pointer-events-none">
            ${rawEmoji}
          </div>
          <div class="absolute -bottom-1 -right-1 bg-white text-slate-800 text-[9px] font-black px-1 rounded-full shadow-sm border border-slate-200">
            95%
          </div>
        </div>
      `;
    }

    // Update Unselected Marker
    if (unselectedMarkerRef.current) {
      const el = unselectedMarkerRef.current.getElement();
      el.style.width = `${unselectedIconSize}px`;
      el.style.height = `${unselectedIconSize}px`;
      const innerSize = Math.max(16, unselectedIconSize - 6);
      const memberColor = "#FAD2E1";

      el.innerHTML = `
        <div class="relative w-full h-full rounded-full flex items-center justify-center"
             style="
               background-color: white;
               padding: 3px;
               box-shadow: 0 2px 10px rgba(0,0,0,0.14);
             ">
          <div class="w-full h-full rounded-full text-slate-800 font-black text-xs flex items-center justify-center overflow-hidden"
               style="
                 width: ${innerSize}px;
                 height: ${innerSize}px;
                 background-color: ${memberColor};
               ">
            <span>M</span>
          </div>
          <div class="absolute -top-1 -left-1 bg-white text-slate-800 text-[10px] w-4.5 h-4.5 rounded-full shadow-xs border border-slate-200 flex items-center justify-center pointer-events-none">
            📱
          </div>
          <div class="absolute -bottom-1 -right-1 bg-white text-slate-800 text-[9px] font-black px-1 rounded-full shadow-sm border border-slate-200">
            82%
          </div>
        </div>
      `;
    }
  }, [selectedIconSize, unselectedIconSize, userColor, userPhoto, userInitial, deviceIcon]);

  return (
    <div className="relative w-full h-64 md:h-72 rounded-2xl overflow-hidden border border-slate-200/80 shadow-inner bg-slate-100">
      <div ref={containerRef} className="w-full h-full" />
      <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full text-[11px] font-bold text-slate-700 shadow-xs border border-white/60 pointer-events-none flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        Live Map Preview
      </div>
      <div className="absolute bottom-3 right-3 bg-white/90 backdrop-blur-md px-2.5 py-1 rounded-lg text-[10px] text-slate-500 font-medium shadow-xs border border-white/60 pointer-events-none">
        Selected: {selectedIconSize}px • Unselected: {unselectedIconSize}px
      </div>
    </div>
  );
};
