import React from "react";
import { CircleMember } from "../types";
import { UserCheck } from "lucide-react";
import { getAvatarColor } from "../lib/avatarColor";

interface PeopleTabProps {
  members: CircleMember[];
  loading: boolean;
  onSelectMember?: (member: CircleMember) => void;
}

export const PeopleTab: React.FC<PeopleTabProps> = ({ members, loading, onSelectMember }) => {
  return (
    <div className="bg-white p-7 sm:p-8 rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.015)] max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-indigo-600" />
          Family Members
        </h2>
        <p className="text-xs text-slate-400 font-semibold mt-1 leading-relaxed">
          Review the members and active companion app devices registered under this Circle. Click any member to focus on the map.
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
          {members.map((member) => {
            const avatarBg = getAvatarColor(member.avatar_color);
            return (
              <div
                key={member.id}
                onClick={() => onSelectMember?.(member)}
                className="flex items-center justify-between p-4.5 hover:bg-slate-50/70 transition duration-150 cursor-pointer group"
              >
                {/* Left Side: Avatar & Display Name */}
                <div className="flex items-center gap-3.5">
                  <div 
                    className="h-10 w-10 text-white font-black text-sm flex items-center justify-center select-none transition-all duration-300 overflow-hidden shrink-0 group-hover:scale-105"
                    style={{ 
                      backgroundColor: avatarBg, 
                      clipPath: "url(#squircle-clip-app)",
                      filter: `drop-shadow(0 2px 4px ${avatarBg}40)`
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
                  <div>
                    <p className="text-sm font-bold text-slate-800 group-hover:text-indigo-600 transition">{member.display_name}</p>
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
          );
        })}
        </div>
      )}
    </div>
  );
};
