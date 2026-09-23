import React, { useState } from "react";
import { FlaskConical, ChevronDown, ChevronUp, UserCheck, Users, Smartphone, Shield, Eye } from "lucide-react";
import { PreviewTestState, SIMULATED_TEST_DEVICES, isDevOrPreviewEnvironment } from "../lib/previewTestMode";

interface PreviewTestModeControlsProps {
  testState: PreviewTestState;
  onChangeTestState: (newState: PreviewTestState) => void;
}

export const PreviewTestModeControls: React.FC<PreviewTestModeControlsProps> = ({
  testState,
  onChangeTestState
}) => {
  const [expanded, setExpanded] = useState(false);

  // Strictly return null in production environment
  if (!isDevOrPreviewEnvironment()) {
    return null;
  }

  const handleToggleEnabled = () => {
    onChangeTestState({
      ...testState,
      enabled: !testState.enabled
    });
  };

  const handleSetRole = (role: "owner" | "other_member") => {
    onChangeTestState({
      ...testState,
      viewingRole: role
    });
  };

  const handleSetDefaultDevice = (deviceId: string) => {
    onChangeTestState({
      ...testState,
      defaultDeviceId: deviceId
    });
  };

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex flex-col items-center">
      {/* Floating Pill Header */}
      <div className="bg-slate-900/90 backdrop-blur-xl border border-indigo-500/40 text-white rounded-full px-3.5 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.3)] flex items-center gap-2.5 text-xs font-bold select-none">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <FlaskConical className="w-3.5 h-3.5 text-indigo-400" />
        <span className="tracking-wide font-extrabold text-[11px] uppercase">Preview Test Mode</span>

        <label className="relative inline-flex items-center cursor-pointer ml-1">
          <input
            type="checkbox"
            checked={testState.enabled}
            onChange={handleToggleEnabled}
            className="sr-only peer"
          />
          <div className="w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
        </label>

        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 hover:bg-slate-800 rounded-full transition cursor-pointer text-slate-300 hover:text-white"
          title={expanded ? "Hide test controls" : "Show test controls"}
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Expanded Control Panel */}
      {expanded && (
        <div className="mt-2 w-80 bg-slate-900/95 backdrop-blur-2xl border border-indigo-500/30 text-white rounded-2xl p-4 shadow-2xl text-xs space-y-3 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-extrabold text-slate-300 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <Shield className="w-3.5 h-3.5 text-indigo-400" /> Private Device Simulator
            </span>
            <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full">
              {testState.enabled ? "Active" : "Disabled"}
            </span>
          </div>

          {/* Role Switcher */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Eye className="w-3 h-3 text-indigo-400" /> Viewing Context (Privacy Test)
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => handleSetRole("owner")}
                className={`px-2.5 py-1.5 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition cursor-pointer text-[11px] ${
                  testState.viewingRole === "owner"
                    ? "bg-indigo-600 border-indigo-400 text-white shadow-xs"
                    : "bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" /> Owner (Me)
              </button>
              <button
                onClick={() => handleSetRole("other_member")}
                className={`px-2.5 py-1.5 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition cursor-pointer text-[11px] ${
                  testState.viewingRole === "other_member"
                    ? "bg-emerald-600 border-emerald-400 text-white shadow-xs"
                    : "bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <Users className="w-3.5 h-3.5" /> Alex (Circle Member)
              </button>
            </div>
            {testState.viewingRole === "other_member" && (
              <p className="text-[10px] text-amber-300/90 font-medium bg-amber-950/40 border border-amber-800/40 p-2 rounded-lg leading-tight">
                🔒 Privacy Mode Active: Owner&apos;s private devices (iPad & Galaxy) are stripped from location payload and hidden from Alex.
              </p>
            )}
          </div>

          {/* Default Device Selector */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Smartphone className="w-3 h-3 text-indigo-400" /> Test Owner Default Shared Device
            </label>
            <div className="space-y-1">
              {SIMULATED_TEST_DEVICES.map((dev) => {
                const isSelected = testState.defaultDeviceId === dev.entity_id;
                return (
                  <button
                    key={dev.entity_id}
                    onClick={() => handleSetDefaultDevice(dev.entity_id)}
                    className={`w-full px-2.5 py-1.5 rounded-xl border text-left flex items-center justify-between transition cursor-pointer text-[11px] ${
                      isSelected
                        ? "bg-indigo-950/80 border-indigo-500 text-white font-bold"
                        : "bg-slate-800/50 border-slate-700/60 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{dev.map_icon.split(" ")[0]}</span>
                      <span>{dev.device_name}</span>
                    </span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${isSelected ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400"}`}>
                      {isSelected ? "SHARED MARKER" : "PRIVATE 34px"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 text-[9px] text-slate-400 text-center">
            AI Studio Preview Test Only • Zero production database or HA impact
          </div>
        </div>
      )}
    </div>
  );
};
