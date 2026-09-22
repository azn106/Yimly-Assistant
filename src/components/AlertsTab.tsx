import React from "react";
import { AlertTriangle, Bell, Info, ShieldAlert } from "lucide-react";

export const AlertsTab: React.FC = () => {
  return (
    <div className="bg-white p-7 sm:p-8 rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <Bell className="w-5 h-5 text-indigo-600" />
          Circle Alerts
        </h2>
        <p className="text-xs text-slate-400 font-semibold mt-1 leading-relaxed">
          Stay updated on family movements, low batteries, and geofence events.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-slate-100 rounded-3xl text-center p-8 bg-[#fafbfe]/20">
        <div className="h-14 w-14 rounded-2xl bg-amber-50/60 text-amber-600 flex items-center justify-center border border-amber-100/20 mb-4.5 shadow-sm">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-bold text-slate-800">No Alerts Active</h3>
        <p className="text-xs text-slate-400 max-w-xs mt-1.5 leading-relaxed font-semibold">
          You are currently all caught up. When a member enters or exits a place zone, or their battery drops below critical levels, alerts will appear here.
        </p>
      </div>

      <div className="p-5 rounded-3xl bg-slate-50/50 border border-slate-100/60 flex gap-3 text-xs text-slate-600">
        <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-extrabold text-slate-800 block mb-0.5">Real-time Telemetry Processing:</span>
          <p className="mt-1 text-slate-400 leading-relaxed font-semibold">
            The Family Circle sharing layer reads webhook payload signals from registered devices. Safety notifications will be sent directly via web push and app alerts as soon as device tracker states shift.
          </p>
        </div>
      </div>
    </div>
  );
};
