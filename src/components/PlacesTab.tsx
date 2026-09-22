import React, { useState } from "react";
import { Compass, MapPin, Plus, Home, Briefcase, Clock } from "lucide-react";

export const PlacesTab: React.FC = () => {
  const [places] = useState([
    { id: 1, name: "Home Circle Zone", type: "home", address: "Configure inside Home Assistant Zones", icon: Home },
    { id: 2, name: "Family Workspace", type: "work", address: "Active Zone boundaries defined by Core", icon: Briefcase }
  ]);

  return (
    <div className="bg-white p-7 sm:p-8 rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Compass className="w-5 h-5 text-indigo-600" />
            Circle Places
          </h2>
          <p className="text-xs text-slate-400 font-semibold mt-1 leading-relaxed">
            Review shared family coordinates, workspaces, and home zones registered in Core.
          </p>
        </div>

        <button
          className="flex items-center justify-center gap-1.5 bg-slate-50/70 border border-slate-100 text-slate-400 font-bold px-4 py-2.5 rounded-2xl text-xs transition cursor-not-allowed opacity-50"
          title="Zones are configured in Core"
          disabled
        >
          <Plus className="w-3.5 h-3.5" />
          Add Zone
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4.5">
        {places.map((place) => {
          const IconComponent = place.icon;
          return (
            <div
              key={place.id}
              className="p-6 rounded-3xl bg-[#fafbfe]/40 border border-slate-100/80 flex items-start gap-4 hover:border-slate-200/40 hover:shadow-[0_12px_32px_rgba(148,163,184,0.04)] transition duration-200"
            >
              <div className="h-11 w-11 rounded-2xl bg-indigo-50/80 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100/20 shadow-sm">
                <IconComponent className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">{place.name}</h3>
                <p className="text-xs text-slate-400 font-semibold mt-1 leading-relaxed">{place.address}</p>
                <div className="mt-4.5 flex items-center gap-1.5 text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                  <Clock className="w-3.5 h-3.5 text-slate-300" />
                  <span>Configured via Home Assistant Protocol</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-5 bg-indigo-50/30 rounded-3xl border border-indigo-100/20 flex items-start gap-3">
        <MapPin className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
        <p className="text-xs text-indigo-700/90 font-medium leading-relaxed">
          <strong className="font-extrabold text-indigo-800 block mb-1">Underlying architecture notes:</strong> Places represent your Home Assistant Zones (`zone.*` entities). To define or modify these spatial boundaries, simply configure them in your companion device tracker config. Yimly Home Core syncs with these boundaries instantly.
        </p>
      </div>
    </div>
  );
};
