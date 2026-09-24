import { CircleMember, MemberDeviceLocation, UserInfo } from "../types";
import { getAvatarColor } from "./avatarColor";

// Detect if running in development or AI Studio Preview environment
export function isDevOrPreviewEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  
  // Production environment check
  if (import.meta.env.PROD && !window.location.hostname.includes("run.app") && window.location.hostname !== "localhost") {
    return false;
  }

  return (
    import.meta.env.DEV ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.includes("run.app")
  );
}

export interface PreviewTestState {
  enabled: boolean;
  viewingRole: "owner" | "other_member";
  defaultDeviceId: string;
}

export const SIMULATED_TEST_DEVICES = [
  {
    entity_id: "device_tracker.sim_iphone",
    device_name: "iPhone 15 Pro",
    latitude: -33.8688,
    longitude: 151.2093,
    battery: 88,
    accuracy: 5,
    map_icon: "📱 Phone",
    location_visibility: "family" as const
  },
  {
    entity_id: "device_tracker.sim_ipad",
    device_name: "iPad Air",
    latitude: -33.8640,
    longitude: 151.2040,
    battery: 94,
    accuracy: 8,
    map_icon: "📟 iPad",
    location_visibility: "me_only" as const
  },
  {
    entity_id: "device_tracker.sim_android_phone",
    device_name: "Galaxy S24",
    latitude: -33.8730,
    longitude: 151.2140,
    battery: 76,
    accuracy: 6,
    map_icon: "📱 Phone",
    location_visibility: "me_only" as const
  }
];

export const SIMULATED_ALEX_MEMBER: CircleMember = {
  id: 9999,
  username: "alex_circle_member",
  display_name: "Alex (Circle Member)",
  avatar_color: "#10b981",
  profile_picture_url: null,
  devices: [
    {
      entity_id: "device_tracker.sim_alex_phone",
      device_name: "Alex's Pixel 8",
      latitude: -33.8610,
      longitude: 151.2110,
      battery: 82,
      accuracy: 5,
      last_updated: new Date().toISOString(),
      map_icon: "📱 Phone",
      location_visibility: "family",
      is_default: true
    }
  ]
};

/**
 * Transforms members list for Preview testing mode according to the selected role and default device.
 */
export function processPreviewTestMembers(
  realMembers: CircleMember[],
  currentUser: UserInfo | null,
  testState: PreviewTestState
): { members: CircleMember[]; effectiveUser: UserInfo | null } {
  if (!testState.enabled || !isDevOrPreviewEnvironment()) {
    return { members: realMembers, effectiveUser: currentUser };
  }

  const nowIso = new Date().toISOString();
  const ownerId = currentUser?.id || 1;
  const ownerName = currentUser?.display_name || "Test Owner";
  const ownerColor = getAvatarColor(currentUser?.avatar_color);
  const ownerPhoto = currentUser?.profile_picture_url || null;

  // Build simulated owner devices list with selected default device at index 0
  const ownerDevices: MemberDeviceLocation[] = SIMULATED_TEST_DEVICES.map((dev) => {
    const isDefault = dev.entity_id === testState.defaultDeviceId;
    return {
      entity_id: dev.entity_id,
      device_name: dev.device_name,
      latitude: dev.latitude,
      longitude: dev.longitude,
      battery: dev.battery,
      accuracy: dev.accuracy,
      last_updated: nowIso,
      map_icon: dev.map_icon,
      location_visibility: isDefault ? "family" : "me_only",
      is_default: isDefault
    };
  });

  // Ensure default device is first at index 0
  ownerDevices.sort((a, b) => (a.is_default ? -1 : b.is_default ? 1 : 0));

  const effectiveUser: UserInfo = testState.viewingRole === "owner"
    ? (currentUser || {
        id: ownerId,
        username: "test_owner",
        display_name: ownerName,
        avatar_color: ownerColor
      })
    : {
        id: SIMULATED_ALEX_MEMBER.id,
        username: SIMULATED_ALEX_MEMBER.username,
        display_name: SIMULATED_ALEX_MEMBER.display_name,
        avatar_color: getAvatarColor(SIMULATED_ALEX_MEMBER.avatar_color)
      };

  // If viewing as Alex (other member):
  // STRICT PRIVACY: The owner's devices list is filtered to ONLY the single default shared device [ownerDevices[0]].
  // Private iPad & Galaxy S24 devices are COMPLETELY stripped out.
  const processedOwnerDevices = testState.viewingRole === "other_member"
    ? ownerDevices.slice(0, 1)
    : ownerDevices;

  const simulatedOwnerMember: CircleMember = {
    id: ownerId,
    username: currentUser?.username || "test_owner",
    display_name: ownerName,
    avatar_color: ownerColor,
    profile_picture_url: ownerPhoto,
    devices: processedOwnerDevices
  };

  // Combine owner member and Alex member
  const baseMembersList = realMembers.length > 0 ? [...realMembers] : [];
  
  // Replace or insert simulated owner member
  const ownerIdx = baseMembersList.findIndex((m) => m.id === ownerId);
  if (ownerIdx >= 0) {
    baseMembersList[ownerIdx] = simulatedOwnerMember;
  } else {
    baseMembersList.unshift(simulatedOwnerMember);
  }

  // Ensure Alex is in circle for two-member privacy testing
  if (!baseMembersList.some((m) => m.id === SIMULATED_ALEX_MEMBER.id)) {
    baseMembersList.push(SIMULATED_ALEX_MEMBER);
  }

  return {
    members: baseMembersList,
    effectiveUser
  };
}
