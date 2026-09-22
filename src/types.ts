export interface UserInfo {
  id: number;
  username: string;
  display_name: string;
  avatar_color?: string | null;
  profile_picture_url?: string | null;
  map_style?: string | null;
  map_selected_icon_size?: number | null;
  map_unselected_icon_size?: number | null;
}

export interface MemberDeviceLocation {
  entity_id: string;
  device_name: string;
  latitude: number;
  longitude: number;
  battery?: number | string | null;
  accuracy?: number | null;
  last_updated: string;
}

export interface CircleMember {
  id: number;
  username: string;
  display_name: string;
  avatar_color?: string | null;
  profile_picture_url?: string | null;
  devices: MemberDeviceLocation[];
}

export interface Circle {
  id: number;
  name: string;
  owner_id: number;
  invite_code: string;
  created_at: string;
}

export interface LocationHistoryItem {
  id: string;
  entity_id: string;
  user_id: number;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  bearing?: number | null;
  battery_level?: number | string | null;
  timestamp: string;
}
