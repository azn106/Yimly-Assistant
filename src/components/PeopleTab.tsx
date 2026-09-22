import React from "react";
import { CircleMember } from "../types";
import { UserCheck } from "lucide-react";

interface PeopleTabProps {
  members: CircleMember[];
  loading: boolean;
}

export const PeopleTab: React.FC<PeopleTabProps> = ({ members, loading }) => {
  return (
    <div className="bg-white p-7 sm:p-8 rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-indigo-600" />
          Family Members
        </h2>
        <p className="text-xs text-slate-400 font-semibold mt-1 leading-relaxed">
          Review the members and active companion app devices registered under this Circle.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-xs text-slate-400 font-bold tracking-wide">
          Loading members...
        </div>
      ) : members.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-100 rounded-3xl bg-slate-50/20 px-6">
          <p className="text-sm font-bold text-slate-600">No members in this Circle</p>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed font-semibold max-w-xs mx-auto">
            Invite family members by sharing your active Circle's invite code.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100/70 border border-slate-100/80 rounded-2xl overflow-hidden bg-white/45 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.01)]">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between p-4.5 hover:bg-slate-50/40 transition duration-150"
            >
              {/* Left Side: Avatar & Display Name */}
              <div className="flex items-center gap-3.5">
                <div 
                  className="h-10 w-10 text-white font-black text-sm rounded-full flex items-center justify-center select-none shadow-sm transition-all duration-300 overflow-hidden shrink-0"
                  style={{ 
                    backgroundColor: member.avatar_color || "#4f46e5", 
                    border: member.avatar_color ? "2px solid white" : "none",
                    boxShadow: member.avatar_color ? `0 0 0 2px ${member.avatar_color}` : "none" 
                  }}
                >
                  {member.profile_picture_url ? (
                    <img
                      src={member.profile_picture_url}
                      alt={member.display_name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover rounded-full"
                    />
                  ) : (
                    member.display_name.charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">{member.display_name}</p>
                </div>
              </div>

              {/* Right Side: Companion App Device Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {member.devices && member.devices.map((device) => (
                  <span
                    key={device.entity_id}
                    className="text-[10px] font-bold text-slate-500 bg-slate-100/60 border border-slate-200/40 px-2.5 py-0.5 rounded-lg whitespace-nowrap shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
                  >
                    {device.device_name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
