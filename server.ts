import express, { Request, Response, NextFunction } from "express";
import http from "http";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cors from "cors";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";

/**
 * ====================================================================================
 * AI STUDIO PREVIEW BACKEND (PREVIEW ONLY)
 * 
 * NOTICE:
 * This Express backend (server.ts) is strictly used for AI Studio Preview sessions.
 * It is completely isolated from the production Yimly Home Core backend.
 * 
 * PRODUCTION BACKEND:
 * The production and launched deployment MUST execute the Python FastAPI backend:
 *   uvicorn app.main:app --host 0.0.0.0 --port 3000
 * 
 * DO NOT use this file in production. Production reads real HA Companion App telemetry
 * from SQLite (yimly_home.db) and contains ZERO preview/fake coordinates.
 * ====================================================================================
 */

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "yimly_home_preview_secret_key_2026";
const DATA_FILE = path.join(process.cwd(), "yimly_store_preview.json");

// Core Interfaces
export interface UserData {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  avatar_color?: string | null;
  profile_picture_url?: string | null;
  map_style?: string | null;
  map_pin_type?: string | null;
  map_selected_icon_size?: number | null;
  map_unselected_icon_size?: number | null;
  share_location?: boolean;
  save_location_history?: boolean;
  history_retention?: string;
  location_update_frequency?: string;
  notify_push?: boolean;
  notify_arrival_departure?: boolean;
  notify_stop_sharing?: boolean;
  notify_low_battery?: boolean;
  notify_device_offline?: boolean;
  created_at: string;
}

export function formatUserResponse(u: UserData) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    avatar_color: u.avatar_color || null,
    profile_picture_url: u.profile_picture_url || null,
    map_style: u.map_style || "osm",
    map_pin_type: u.map_pin_type || "classic_pin",
    map_selected_icon_size: u.map_selected_icon_size || 72,
    map_unselected_icon_size: u.map_unselected_icon_size || 64,
    share_location: u.share_location !== false,
    save_location_history: u.save_location_history !== false,
    history_retention: u.history_retention || "30d",
    location_update_frequency: u.location_update_frequency || "realtime",
    notify_push: u.notify_push !== false,
    notify_arrival_departure: u.notify_arrival_departure !== false,
    notify_stop_sharing: u.notify_stop_sharing !== false,
    notify_low_battery: u.notify_low_battery !== false,
    notify_device_offline: u.notify_device_offline !== false,
    is_active: true
  };
}

export function cleanupHistoryForUser(db: YimlyPreviewDatabase, userId: number, retention?: string) {
  if (!retention || retention === "forever") return;
  let cutoffMs = 30 * 86400000;
  if (retention === "7d") cutoffMs = 7 * 86400000;
  else if (retention === "30d") cutoffMs = 30 * 86400000;
  else if (retention === "90d") cutoffMs = 90 * 86400000;
  else if (retention === "1y") cutoffMs = 365 * 86400000;

  const cutoffDate = new Date(Date.now() - cutoffMs).toISOString();
  db.location_history = db.location_history.filter(
    (h) => h.user_id !== userId || h.timestamp >= cutoffDate
  );
}

export interface CircleData {
  id: number;
  name: string;
  owner_id: number;
  invite_code: string;
  created_at: string;
}

export interface CircleMemberData {
  circle_id: number;
  user_id: number;
}

export interface EntityStateData {
  entity_id: string;
  user_id: number;
  domain: string;
  state: string;
  attributes: Record<string, any>;
  latitude?: number | null;
  longitude?: number | null;
  last_updated: string;
}

export interface LocationHistoryEntry {
  id: string;
  entity_id: string;
  user_id: number;
  latitude: number;
  longitude: number;
  battery_level?: number;
  accuracy?: number;
  timestamp: string;
}

export interface PlaceData {
  id: number;
  circle_id: number;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  radius: number;
  icon?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertData {
  id: number;
  circle_id: number;
  user_id: number;
  target_user_id?: number | null;
  alert_type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface GeofenceStateData {
  id: number;
  user_id: number;
  device_id: string;
  place_id: number;
  inside: boolean;
  last_updated: string;
}

export interface DeviceBatteryStateData {
  entity_id: string;
  last_known_battery: number | null;
  low_battery_alert_triggered: boolean;
}

export interface DeviceOfflineStateData {
  entity_id: string;
  last_seen_at: string;
  device_offline_alert_triggered: boolean;
  first_telemetry_received: boolean;
}

export interface YimlyPreviewDatabase {
  users: UserData[];
  circles: CircleData[];
  circle_members: CircleMemberData[];
  entity_states: EntityStateData[];
  location_history: LocationHistoryEntry[];
  places: PlaceData[];
  alerts: AlertData[];
  geofence_states: GeofenceStateData[];
  device_battery_states: DeviceBatteryStateData[];
  device_offline_states: DeviceOfflineStateData[];
  devices: any[];
}


// Helper to build deterministic Preview-only historical location points
function getDeterministicPreviewHistory(): LocationHistoryEntry[] {
  const now = Date.now();
  const d = 24 * 3600 * 1000;
  const h = 3600 * 1000;
  const m = 60 * 1000;

  return [
    // User 1 (Admin) - Route around SF (Dolores Park -> Haight -> Golden Gate Park -> Embarcadero)
    {
      id: "prev_hist_u1_1",
      entity_id: "device_tracker.admin_preview_phone",
      user_id: 1,
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 5,
      battery_level: 95,
      timestamp: new Date(now - 15 * m).toISOString()
    },
    {
      id: "prev_hist_u1_2",
      entity_id: "device_tracker.admin_preview_phone",
      user_id: 1,
      latitude: 37.7712,
      longitude: -122.4215,
      accuracy: 6,
      battery_level: 93,
      timestamp: new Date(now - 45 * m).toISOString()
    },
    {
      id: "prev_hist_u1_3",
      entity_id: "device_tracker.admin_preview_phone",
      user_id: 1,
      latitude: 37.7600,
      longitude: -122.4210,
      accuracy: 8,
      battery_level: 90,
      timestamp: new Date(now - 2 * h).toISOString()
    },
    {
      id: "prev_hist_u1_4",
      entity_id: "device_tracker.admin_preview_phone",
      user_id: 1,
      latitude: 37.7680,
      longitude: -122.4460,
      accuracy: 7,
      battery_level: 86,
      timestamp: new Date(now - 4 * h).toISOString()
    },
    {
      id: "prev_hist_u1_5",
      entity_id: "device_tracker.admin_preview_phone",
      user_id: 1,
      latitude: 37.7715,
      longitude: -122.4680,
      accuracy: 9,
      battery_level: 82,
      timestamp: new Date(now - 7 * h).toISOString()
    },
    {
      id: "prev_hist_u1_6",
      entity_id: "device_tracker.admin_preview_phone",
      user_id: 1,
      latitude: 37.7740,
      longitude: -122.4850,
      accuracy: 10,
      battery_level: 78,
      timestamp: new Date(now - 10 * h).toISOString()
    },
    {
      id: "prev_hist_u1_7",
      entity_id: "device_tracker.admin_preview_phone",
      user_id: 1,
      latitude: 37.7955,
      longitude: -122.3937,
      accuracy: 6,
      battery_level: 65,
      timestamp: new Date(now - 22 * h).toISOString()
    },
    {
      id: "prev_hist_u1_8",
      entity_id: "device_tracker.admin_preview_phone",
      user_id: 1,
      latitude: 37.7920,
      longitude: -122.4040,
      accuracy: 8,
      battery_level: 60,
      timestamp: new Date(now - 24 * h).toISOString()
    },
    {
      id: "prev_hist_u1_9",
      entity_id: "device_tracker.admin_preview_phone",
      user_id: 1,
      latitude: 37.8020,
      longitude: -122.4480,
      accuracy: 5,
      battery_level: 45,
      timestamp: new Date(now - 2 * d - 2 * h).toISOString()
    },
    {
      id: "prev_hist_u1_10",
      entity_id: "device_tracker.admin_preview_phone",
      user_id: 1,
      latitude: 37.8060,
      longitude: -122.4200,
      accuracy: 6,
      battery_level: 52,
      timestamp: new Date(now - 3 * d - 4 * h).toISOString()
    },
    {
      id: "prev_hist_u1_11",
      entity_id: "device_tracker.admin_preview_phone",
      user_id: 1,
      latitude: 37.7850,
      longitude: -122.4080,
      accuracy: 7,
      battery_level: 68,
      timestamp: new Date(now - 5 * d - 1 * h).toISOString()
    },
    {
      id: "prev_hist_u1_12",
      entity_id: "device_tracker.admin_preview_phone",
      user_id: 1,
      latitude: 37.7780,
      longitude: -122.3900,
      accuracy: 5,
      battery_level: 75,
      timestamp: new Date(now - 6 * d - 18 * h).toISOString()
    },

    // User 2 (Member) - Route around SF (Civic Center -> Union Sq -> Chinatown -> Coit Tower -> Pier 39)
    {
      id: "prev_hist_u2_1",
      entity_id: "device_tracker.member_preview_phone",
      user_id: 2,
      latitude: 37.7833,
      longitude: -122.4167,
      accuracy: 6,
      battery_level: 82,
      timestamp: new Date(now - 20 * m).toISOString()
    },
    {
      id: "prev_hist_u2_2",
      entity_id: "device_tracker.member_preview_phone",
      user_id: 2,
      latitude: 37.7875,
      longitude: -122.4072,
      accuracy: 8,
      battery_level: 80,
      timestamp: new Date(now - 50 * m).toISOString()
    },
    {
      id: "prev_hist_u2_3",
      entity_id: "device_tracker.member_preview_phone",
      user_id: 2,
      latitude: 37.7950,
      longitude: -122.4030,
      accuracy: 10,
      battery_level: 75,
      timestamp: new Date(now - 3 * h).toISOString()
    },
    {
      id: "prev_hist_u2_4",
      entity_id: "device_tracker.member_preview_phone",
      user_id: 2,
      latitude: 37.8010,
      longitude: -122.4090,
      accuracy: 7,
      battery_level: 70,
      timestamp: new Date(now - 5 * h).toISOString()
    },
    {
      id: "prev_hist_u2_5",
      entity_id: "device_tracker.member_preview_phone",
      user_id: 2,
      latitude: 37.8085,
      longitude: -122.4100,
      accuracy: 5,
      battery_level: 64,
      timestamp: new Date(now - 8 * h).toISOString()
    },
    {
      id: "prev_hist_u2_6",
      entity_id: "device_tracker.member_preview_phone",
      user_id: 2,
      latitude: 37.7760,
      longitude: -122.4350,
      accuracy: 9,
      battery_level: 50,
      timestamp: new Date(now - 23 * h).toISOString()
    },
    {
      id: "prev_hist_u2_7",
      entity_id: "device_tracker.member_preview_phone",
      user_id: 2,
      latitude: 37.7700,
      longitude: -122.4470,
      accuracy: 8,
      battery_level: 44,
      timestamp: new Date(now - 26 * h).toISOString()
    },
    {
      id: "prev_hist_u2_8",
      entity_id: "device_tracker.member_preview_phone",
      user_id: 2,
      latitude: 37.7650,
      longitude: -122.4200,
      accuracy: 7,
      battery_level: 58,
      timestamp: new Date(now - 2 * d - 5 * h).toISOString()
    },
    {
      id: "prev_hist_u2_9",
      entity_id: "device_tracker.member_preview_phone",
      user_id: 2,
      latitude: 37.7800,
      longitude: -122.4000,
      accuracy: 6,
      battery_level: 66,
      timestamp: new Date(now - 4 * d - 10 * h).toISOString()
    },
    {
      id: "prev_hist_u2_10",
      entity_id: "device_tracker.member_preview_phone",
      user_id: 2,
      latitude: 37.7900,
      longitude: -122.3950,
      accuracy: 8,
      battery_level: 72,
      timestamp: new Date(now - 6 * d - 12 * h).toISOString()
    }
  ];
}

// Data Store Management (Isolated Preview File Store)
function loadDB(): YimlyPreviewDatabase {
  if (!fs.existsSync(DATA_FILE)) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync("password", salt);
    
    // Seed preview-only data for interactive AI Studio testing
    const initialDB: YimlyPreviewDatabase = {
      users: [
        {
          id: 1,
          username: "admin@yimly.home",
          password_hash: hash,
          display_name: "Yimly Admin (Preview)",
          avatar_color: "#E2D9F3",
          created_at: new Date().toISOString()
        },
        {
          id: 2,
          username: "member@yimly.home",
          password_hash: hash,
          display_name: "Circle Member (Preview)",
          avatar_color: "#fbcfe8",
          created_at: new Date().toISOString()
        }
      ],
      circles: [
        {
          id: 1,
          name: "Yimly Family Circle (Preview)",
          owner_id: 1,
          invite_code: "YIMLY-PREVIEW-HQ",
          created_at: new Date().toISOString()
        }
      ],
      circle_members: [
        { circle_id: 1, user_id: 1 },
        { circle_id: 1, user_id: 2 }
      ],
      entity_states: [
        {
          entity_id: "device_tracker.admin_preview_phone",
          user_id: 1,
          domain: "device_tracker",
          state: "home",
          attributes: { friendly_name: "Admin's Preview Phone", battery_level: 95, gps_accuracy: 5 },
          latitude: 37.7749,
          longitude: -122.4194,
          last_updated: new Date().toISOString()
        },
        {
          entity_id: "device_tracker.member_preview_phone",
          user_id: 2,
          domain: "device_tracker",
          state: "not_home",
          attributes: { friendly_name: "Member's Preview Phone", battery_level: 82, gps_accuracy: 10 },
          latitude: 37.7833,
          longitude: -122.4167,
          last_updated: new Date().toISOString()
        }
      ],
      location_history: getDeterministicPreviewHistory(),
      places: [],
      alerts: [],
      geofence_states: [],
      device_battery_states: [],
      device_offline_states: [],
      devices: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialDB, null, 2));
    return initialDB;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const existingHistory = Array.isArray(parsed.location_history) && parsed.location_history.length > 0
      ? parsed.location_history
      : getDeterministicPreviewHistory();

    const loaded: YimlyPreviewDatabase = {
      users: parsed.users || [],
      circles: parsed.circles || [],
      circle_members: parsed.circle_members || [],
      entity_states: parsed.entity_states || [],
      location_history: existingHistory,
      places: parsed.places || [],
      alerts: parsed.alerts || [],
      geofence_states: parsed.geofence_states || [],
      device_battery_states: parsed.device_battery_states || [],
      device_offline_states: parsed.device_offline_states || [],
      devices: parsed.devices || []
    };

    // If loaded history was empty or upgraded, persist it
    if (!parsed.location_history || parsed.location_history.length === 0) {
      saveDB(loaded);
    }

    return loaded;
  } catch (err) {
    return {
      users: [],
      circles: [],
      circle_members: [],
      entity_states: [],
      location_history: getDeterministicPreviewHistory(),
      places: [],
      alerts: [],
      geofence_states: [],
      device_battery_states: [],
      device_offline_states: [],
      devices: []
    };
  }
}

function saveDB(db: YimlyPreviewDatabase) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

const app = express();
app.use(cors());
app.use(express.json());

const uploadsDir = path.join(process.cwd(), "uploads");
const profilePicsDir = path.join(uploadsDir, "profile_pictures");
if (!fs.existsSync(profilePicsDir)) {
  fs.mkdirSync(profilePicsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(profilePicsDir)) {
      fs.mkdirSync(profilePicsDir, { recursive: true });
    }
    cb(null, profilePicsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
    const uniqueName = `user_${(req as any).user?.id || "anon"}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${safeExt}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (_req, file, cb) => {
    const allowedMime = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = [".jpg", ".jpeg", ".png", ".webp"];
    if (allowedMime.includes(file.mimetype.toLowerCase()) && allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and WebP images are allowed."));
    }
  }
});

const server = http.createServer(app);

// WebSocket Setup for Real-time Core updates
const wss = new WebSocketServer({ noServer: true });
const connectedClients = new Set<WebSocket>();

wss.on("connection", (ws: WebSocket) => {
  connectedClients.add(ws);
  ws.send(JSON.stringify({ type: "auth_required", ha_version: "2026.3.0" }));

  ws.on("message", (message: string) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === "auth") {
        ws.send(JSON.stringify({ type: "auth_ok", ha_version: "2026.9.1" }));
      } else if (data.type === "subscribe_events") {
        ws.send(JSON.stringify({ id: data.id, type: "result", success: true, result: null }));
      } else if (data.type === "get_config") {
        ws.send(JSON.stringify({
          id: data.id,
          type: "result",
          success: true,
          result: {
            latitude: 0.0,
            longitude: 0.0,
            elevation: 0,
            unit_system: { length: "km", mass: "g", temperature: "°C", volume: "L" },
            location_name: "Home Assistant",
            time_zone: "UTC",
            components: ["api", "websocket", "mobile_app", "device_tracker", "sensor"],
            version: "2026.9.1"
          }
        }));
      } else if (data.type === "get_states") {
        db = loadDB();
        ws.send(JSON.stringify({
          id: data.id,
          type: "result",
          success: true,
          result: db.entity_states || []
        }));
      } else if (data.type === "config/device_registry/list") {
        db = loadDB();
        const devices = (db.devices || []).map((d: any) => ({
          id: String(d.id),
          name: d.device_name,
          model: d.model,
          manufacturer: d.manufacturer,
          sw_version: d.os_version,
          identifiers: [["mobile_app", d.device_id]],
          connections: [],
          area_id: null,
          disabled_by: null,
          entry_type: null
        }));
        ws.send(JSON.stringify({ id: data.id, type: "result", success: true, result: devices }));
      } else if (data.type === "config/entity_registry/list") {
        db = loadDB();
        const entities = (db.entity_states || []).map((e: any) => ({
          entity_id: e.entity_id,
          name: e.attributes?.friendly_name || null,
          icon: e.attributes?.icon || null,
          platform: "mobile_app",
          config_entry_id: null,
          device_id: null,
          area_id: null,
          disabled_by: null,
          capabilities: {}
        }));
        ws.send(JSON.stringify({ id: data.id, type: "result", success: true, result: entities }));
      } else if (data.type === "config/area_registry/list") {
        db = loadDB();
        const areas = (db.places || []).map((p: any) => ({
          area_id: `area_${p.id}`,
          name: p.name,
          picture: null,
          aliases: []
        }));
        ws.send(JSON.stringify({ id: data.id, type: "result", success: true, result: areas }));
      } else if (data.type === "frontend/get_user_data") {
        ws.send(JSON.stringify({
          id: data.id,
          type: "result",
          success: true,
          result: { show_advanced_options: false }
        }));
      } else if (data.type === "ping") {
        ws.send(JSON.stringify({ id: data.id, type: "pong" }));
      }
    } catch (e) {
      // Ignore invalid JSON
    }
  });

  ws.on("close", () => {
    connectedClients.delete(ws);
  });
});

server.on("upgrade", (request, socket, head) => {
  const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : "";
  if (pathname === "/api/websocket" || pathname === "/api/websocket/") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

function broadcastStateUpdate(event: any) {
  const payload = JSON.stringify({ type: "event", event });
  connectedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Authentication Middleware
export interface AuthRequest extends Request {
  user?: UserData;
}

function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ detail: "Authentication required" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string | number };
    const userId = Number(decoded.sub);
    db = loadDB();
    const found = db.users.find((u) => u.id === userId);
    if (!found) {
      return res.status(401).json({ detail: "User not found" });
    }
    req.user = found;
    next();
  } catch (err) {
    return res.status(401).json({ detail: "Invalid or expired token" });
  }
}

// System / Setup status endpoints
app.get("/api/setup/status", (req, res) => {
  db = loadDB();
  res.json({ is_initialized: db.users.length > 0 });
});

// Home Assistant Core discovery and services endpoints
app.get("/api/discovery_info", (req, res) => {
  res.json({
    base_url: `http://localhost:${PORT}`,
    location_name: "Home Assistant",
    installation_type: "Home Assistant OS",
    version: "2026.9.1",
    requires_api_password: false
  });
});

app.get("/api/services", (req, res) => {
  res.json([
    {
      domain: "homeassistant",
      services: {
        turn_on: { name: "Turn on", description: "Turn on a device", fields: {} },
        turn_off: { name: "Turn off", description: "Turn off a device", fields: {} },
        toggle: { name: "Toggle", description: "Toggle state", fields: {} },
        update_entity: { name: "Update entity", description: "Request entity update", fields: {} }
      }
    },
    {
      domain: "device_tracker",
      services: {
        see: { name: "See", description: "Record device location", fields: {} }
      }
    },
    {
      domain: "notify",
      services: {
        notify: { name: "Send notification", description: "Send notification", fields: {} }
      }
    }
  ]);
});

app.post("/api/setup/register", (req, res) => {
  const { username, password, display_name } = req.body;
  if (!username || !password || !display_name) {
    return res.status(400).json({ detail: "Username, password, and display name are required" });
  }

  db = loadDB();
  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(password, salt);
  const newUser: UserData = {
    id: db.users.length + 1,
    username,
    password_hash,
    display_name,
    avatar_color: null,
    created_at: new Date().toISOString()
  };

  db.users.push(newUser);

  // Auto-create initial Family Circle
  const initialCircle: CircleData = {
    id: db.circles.length + 1,
    name: `${display_name}'s Family Circle`,
    owner_id: newUser.id,
    invite_code: "YIMLY-" + crypto.randomBytes(3).toString("hex").toUpperCase(),
    created_at: new Date().toISOString()
  };

  db.circles.push(initialCircle);
  db.circle_members.push({ circle_id: initialCircle.id, user_id: newUser.id });
  saveDB(db);

  const token = jwt.sign({ sub: String(newUser.id) }, JWT_SECRET, { expiresIn: "30d" });

  res.json({
    access_token: token,
    token_type: "Bearer",
    user: {
      id: newUser.id,
      username: newUser.username,
      display_name: newUser.display_name,
      avatar_color: newUser.avatar_color,
      map_selected_icon_size: 72,
      map_unselected_icon_size: 64
    }
  });
});

// Authentication Routes
app.post("/api/auth/register", (req, res) => {
  const { username, password, display_name } = req.body;
  if (!username || !password || !display_name) {
    return res.status(400).json({ detail: "Username, password, and display name are required" });
  }

  db = loadDB();
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ detail: "Username is already registered" });
  }

  const salt = bcrypt.genSaltSync(10);
  const password_hash = bcrypt.hashSync(password, salt);
  const newUser: UserData = {
    id: db.users.length + 1,
    username,
    password_hash,
    display_name,
    avatar_color: null,
    map_style: "osm",
    map_selected_icon_size: 72,
    map_unselected_icon_size: 64,
    created_at: new Date().toISOString()
  };

  db.users.push(newUser);

  // Auto-add to existing first circle or create a new circle
  if (db.circles.length > 0) {
    db.circle_members.push({ circle_id: db.circles[0].id, user_id: newUser.id });
  } else {
    const defaultCircle: CircleData = {
      id: 1,
      name: "Family Circle",
      owner_id: newUser.id,
      invite_code: "YIMLY-" + crypto.randomBytes(3).toString("hex").toUpperCase(),
      created_at: new Date().toISOString()
    };
    db.circles.push(defaultCircle);
    db.circle_members.push({ circle_id: 1, user_id: newUser.id });
  }
  saveDB(db);

  const token = jwt.sign({ sub: String(newUser.id) }, JWT_SECRET, { expiresIn: "30d" });

  res.json({
    access_token: token,
    token_type: "Bearer",
    user: formatUserResponse(newUser)
  });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ detail: "Username and password required" });
  }

  db = loadDB();
  const found = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!found || !bcrypt.compareSync(password, found.password_hash)) {
    return res.status(401).json({ detail: "Invalid username or password" });
  }

  const token = jwt.sign({ sub: String(found.id) }, JWT_SECRET, { expiresIn: "30d" });

  res.json({
    access_token: token,
    token_type: "Bearer",
    user: formatUserResponse(found)
  });
});

app.get("/api/auth/me", authenticateToken, (req: AuthRequest, res) => {
  res.json(formatUserResponse(req.user!));
});

app.post("/api/auth/password", authenticateToken, (req: AuthRequest, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ detail: "Current password and new password are required" });
  }

  db = loadDB();
  const userIdx = db.users.findIndex((u) => u.id === req.user!.id);
  if (userIdx === -1) {
    return res.status(404).json({ detail: "User not found" });
  }

  if (!bcrypt.compareSync(current_password, db.users[userIdx].password_hash)) {
    return res.status(400).json({ detail: "Current password is incorrect" });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ detail: "New password must be at least 6 characters" });
  }

  db.users[userIdx].password_hash = bcrypt.hashSync(new_password, 10);
  saveDB(db);

  res.json({ success: true, message: "Password updated successfully" });
});

app.put("/api/auth/profile", authenticateToken, (req: AuthRequest, res) => {
  const {
    username,
    display_name,
    avatar_color,
    map_style,
    map_pin_type,
    map_selected_icon_size,
    map_unselected_icon_size,
    share_location,
    save_location_history,
    history_retention,
    location_update_frequency,
    notify_push,
    notify_arrival_departure,
    notify_stop_sharing,
    notify_low_battery,
    notify_device_offline
  } = req.body;

  db = loadDB();
  const userIdx = db.users.findIndex((u) => u.id === req.user!.id);
  if (userIdx === -1) {
    return res.status(404).json({ detail: "User not found" });
  }

  if (username !== undefined && username.trim()) {
    const trimmed = username.trim();
    const existing = db.users.find(
      (u) => u.id !== req.user!.id && u.username.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      return res.status(400).json({ detail: "Username is already taken" });
    }
    db.users[userIdx].username = trimmed;
  }

  if (display_name !== undefined && display_name.trim()) {
    db.users[userIdx].display_name = display_name.trim();
  }
  if (avatar_color !== undefined) {
    db.users[userIdx].avatar_color = avatar_color;
  }

  if (map_style !== undefined) {
    const allowed = [
      "osm",
      "openfree_positron",
      "openfree_bright",
      "openfree_liberty",
      "openfree_dark",
      "openfree_fiord",
      "carto_voyager",
      "carto_positron",
      "carto_dark"
    ];
    if (allowed.includes(map_style)) {
      db.users[userIdx].map_style = map_style;
    } else {
      return res.status(400).json({ detail: "Invalid map_style value" });
    }
  }

  if (map_pin_type !== undefined) {
    const allowedPinTypes = [
      "classic_pin",
      "circle",
      "teardrop",
      "beacon",
      "badge",
      "minimal",
      "arrow",
      "photo_pin"
    ];
    if (allowedPinTypes.includes(map_pin_type)) {
      db.users[userIdx].map_pin_type = map_pin_type;
    } else {
      return res.status(400).json({ detail: "Invalid map_pin_type value" });
    }
  }

  if (map_selected_icon_size !== undefined && typeof map_selected_icon_size === "number") {
    db.users[userIdx].map_selected_icon_size = Math.max(24, Math.min(72, map_selected_icon_size));
  }
  if (map_unselected_icon_size !== undefined && typeof map_unselected_icon_size === "number") {
    db.users[userIdx].map_unselected_icon_size = Math.max(24, Math.min(72, map_unselected_icon_size));
  }

  const previousShare = db.users[userIdx].share_location !== false;
  let isStopSharingTransition = false;

  if (share_location !== undefined) {
    const nextShare = Boolean(share_location);
    if (previousShare === true && nextShare === false) {
      isStopSharingTransition = true;
    }
    db.users[userIdx].share_location = nextShare;
  }
  if (save_location_history !== undefined) {
    db.users[userIdx].save_location_history = Boolean(save_location_history);
  }
  if (history_retention !== undefined) {
    db.users[userIdx].history_retention = history_retention;
    cleanupHistoryForUser(db, db.users[userIdx].id, history_retention);
  }
  if (location_update_frequency !== undefined) {
    db.users[userIdx].location_update_frequency = location_update_frequency;
  }

  if (notify_push !== undefined) db.users[userIdx].notify_push = Boolean(notify_push);
  if (notify_arrival_departure !== undefined) db.users[userIdx].notify_arrival_departure = Boolean(notify_arrival_departure);
  if (notify_stop_sharing !== undefined) db.users[userIdx].notify_stop_sharing = Boolean(notify_stop_sharing);
  if (notify_low_battery !== undefined) db.users[userIdx].notify_low_battery = Boolean(notify_low_battery);
  if (notify_device_offline !== undefined) db.users[userIdx].notify_device_offline = Boolean(notify_device_offline);

  if (isStopSharingTransition) {
    const userCircles = db.circle_members.filter((m) => m.user_id === req.user!.id).map((m) => m.circle_id);
    for (const circleId of userCircles) {
      const circleMembers = db.circle_members.filter((m) => m.circle_id === circleId);
      for (const cm of circleMembers) {
        if (cm.user_id === req.user!.id) continue;

        const recipient = db.users.find((u) => u.id === cm.user_id);
        if (!recipient || recipient.notify_stop_sharing === false) continue;

        const newAlert: AlertData = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          circle_id: circleId,
          user_id: cm.user_id,
          target_user_id: req.user!.id,
          alert_type: "stop_sharing",
          title: `${db.users[userIdx].display_name} stopped sharing location`,
          message: `${db.users[userIdx].display_name} has stopped sharing their location with the circle.`,
          read: false,
          created_at: new Date().toISOString()
        };

        db.alerts = db.alerts || [];
        db.alerts.push(newAlert);

        broadcastStateUpdate({
          event_type: "alert_created",
          data: newAlert
        });
      }
    }
  }

  saveDB(db);
  res.json(formatUserResponse(db.users[userIdx]));
});

const handleUpload = (req: AuthRequest, res: Response, next: NextFunction) => {
  upload.single("file")(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ detail: "File size exceeds maximum limit of 5MB." });
        }
        return res.status(400).json({ detail: err.message });
      }
      return res.status(400).json({ detail: err.message || "File upload failed." });
    }
    next();
  });
};

app.post(["/api/auth/profile/picture", "/api/auth/profile-picture"], authenticateToken, handleUpload, (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ detail: "No image file provided." });
  }
  db = loadDB();
  const userIdx = db.users.findIndex((u) => u.id === req.user!.id);
  if (userIdx === -1) {
    return res.status(404).json({ detail: "User not found" });
  }
  const user = db.users[userIdx];
  if (user.profile_picture_url) {
    const oldFileName = path.basename(user.profile_picture_url);
    const oldFilePath = path.join(process.cwd(), "uploads", "profile_pictures", oldFileName);
    if (fs.existsSync(oldFilePath)) {
      try { fs.unlinkSync(oldFilePath); } catch (e) {}
    }
  }
  const pictureUrl = `/uploads/profile_pictures/${req.file.filename}`;
  db.users[userIdx].profile_picture_url = pictureUrl;
  saveDB(db);
  res.json(formatUserResponse(db.users[userIdx]));
});

app.delete(["/api/auth/profile/picture", "/api/auth/profile-picture"], authenticateToken, (req: AuthRequest, res: Response) => {
  db = loadDB();
  const userIdx = db.users.findIndex((u) => u.id === req.user!.id);
  if (userIdx !== -1) {
    const user = db.users[userIdx];
    if (user.profile_picture_url) {
      const oldFileName = path.basename(user.profile_picture_url);
      const oldFilePath = path.join(process.cwd(), "uploads", "profile_pictures", oldFileName);
      if (fs.existsSync(oldFilePath)) {
        try { fs.unlinkSync(oldFilePath); } catch (e) {}
      }
      db.users[userIdx].profile_picture_url = null;
      saveDB(db);
    }
    res.json(formatUserResponse(db.users[userIdx]));
  } else {
    res.status(404).json({ detail: "User not found" });
  }
});

// Family Circles Routes
app.get("/api/circles", authenticateToken, (req: AuthRequest, res) => {
  db = loadDB();
  const userCircleIds = db.circle_members
    .filter((m) => m.user_id === req.user!.id)
    .map((m) => m.circle_id);

  const userCircles = db.circles.filter((c) => userCircleIds.includes(c.id));
  res.json(userCircles);
});

app.post("/api/circles", authenticateToken, (req: AuthRequest, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ detail: "Circle name required" });

  db = loadDB();
  const userId = req.user!.id;

  // Single circle constraint: remove user from existing circle first
  const existingCircleIds = db.circle_members
    .filter((m) => m.user_id === userId)
    .map((m) => m.circle_id);

  db.circle_members = db.circle_members.filter((m) => m.user_id !== userId);

  // If old circle has no members left, delete it automatically
  existingCircleIds.forEach((oldId) => {
    const remaining = db.circle_members.filter((m) => m.circle_id === oldId);
    if (remaining.length === 0) {
      db.circles = db.circles.filter((c) => c.id !== oldId);
      db.alerts = (db.alerts || []).filter((a) => a.circle_id !== oldId);
      db.places = (db.places || []).filter((p) => p.circle_id !== oldId);
    }
  });

  const newCircle: CircleData = {
    id: db.circles.length > 0 ? Math.max(...db.circles.map((c) => c.id)) + 1 : 1,
    name: name.trim(),
    owner_id: userId,
    invite_code: crypto.randomBytes(3).toString("hex").toUpperCase(),
    created_at: new Date().toISOString()
  };

  db.circles.push(newCircle);
  db.circle_members.push({ circle_id: newCircle.id, user_id: userId });
  saveDB(db);

  res.json(newCircle);
});

app.post("/api/circles/join", authenticateToken, (req: AuthRequest, res) => {
  const { invite_code } = req.body;
  if (!invite_code || !invite_code.trim()) return res.status(400).json({ detail: "Invite code required" });

  db = loadDB();
  const circle = db.circles.find(
    (c) => c.invite_code.toUpperCase() === invite_code.trim().toUpperCase()
  );

  if (!circle) {
    return res.status(404).json({ detail: "Circle not found with this invite code" });
  }

  const userId = req.user!.id;

  // Remove from existing circles first (user is in exactly ONE circle at a time)
  const existingCircleIds = db.circle_members
    .filter((m) => m.user_id === userId)
    .map((m) => m.circle_id);

  db.circle_members = db.circle_members.filter((m) => m.user_id !== userId);

  existingCircleIds.forEach((oldId) => {
    if (oldId !== circle.id) {
      const remaining = db.circle_members.filter((m) => m.circle_id === oldId);
      if (remaining.length === 0) {
        db.circles = db.circles.filter((c) => c.id !== oldId);
      }
    }
  });

  db.circle_members.push({ circle_id: circle.id, user_id: userId });
  saveDB(db);

  res.json(circle);
});

app.post("/api/circles/:id/leave", authenticateToken, (req: AuthRequest, res) => {
  const circleId = Number(req.params.id);
  db = loadDB();
  const userId = req.user!.id;

  const circle = db.circles.find((c) => c.id === circleId);
  if (!circle) {
    return res.status(404).json({ detail: "Circle not found" });
  }

  const isMember = db.circle_members.some(
    (m) => m.circle_id === circleId && m.user_id === userId
  );

  if (!isMember) {
    return res.status(400).json({ detail: "You are not a member of this circle" });
  }

  // Remove membership for this user (no admin/owner restrictions - all members equal)
  db.circle_members = db.circle_members.filter(
    (m) => !(m.circle_id === circleId && m.user_id === userId)
  );

  // If last member left, delete circle automatically
  const remaining = db.circle_members.filter((m) => m.circle_id === circleId);
  if (remaining.length === 0) {
    db.circles = db.circles.filter((c) => c.id !== circleId);
  }
  saveDB(db);

  res.json({ success: true, message: `Successfully left ${circle.name}` });
});

// Delete Family Circle
app.delete("/api/circles/:id", authenticateToken, (req: AuthRequest, res) => {
  const circleId = Number(req.params.id);
  db = loadDB();

  const circle = db.circles.find((c) => c.id === circleId);
  if (!circle) {
    return res.status(404).json({ detail: "Family Circle not found" });
  }

  db.circles = db.circles.filter((c) => c.id !== circleId);
  db.circle_members = db.circle_members.filter((m) => m.circle_id !== circleId);
  db.places = (db.places || []).filter((p) => p.circle_id !== circleId);
  saveDB(db);

  res.json({
    success: true,
    message: `Family Circle "${circle.name}" has been deleted.`
  });
});

app.post("/api/circles/:id/delete", authenticateToken, (req: AuthRequest, res) => {
  const circleId = Number(req.params.id);
  db = loadDB();

  const circle = db.circles.find((c) => c.id === circleId);
  if (!circle) {
    return res.status(404).json({ detail: "Family Circle not found" });
  }

  db.circles = db.circles.filter((c) => c.id !== circleId);
  db.circle_members = db.circle_members.filter((m) => m.circle_id !== circleId);
  db.places = (db.places || []).filter((p) => p.circle_id !== circleId);
  saveDB(db);

  res.json({
    success: true,
    message: `Family Circle "${circle.name}" has been deleted.`
  });
});

app.get("/api/circles/:id/members", authenticateToken, (req: AuthRequest, res) => {
  const circleId = Number(req.params.id);
  db = loadDB();
  const currentUserId = req.user!.id;

  const isMember = db.circle_members.some(
    (m) => m.circle_id === circleId && m.user_id === currentUserId
  );

  if (!isMember) {
    return res.status(403).json({ detail: "Not authorized to view this circle" });
  }

  const memberUserIds = db.circle_members
    .filter((m) => m.circle_id === circleId)
    .map((m) => m.user_id);

  const members = db.users
    .filter((u) => memberUserIds.includes(u.id))
    .map((member) => {
      const isSelf = member.id === currentUserId;

      // If user disabled location sharing and viewer is another member, hide devices
      if (member.share_location === false && !isSelf) {
        return {
          id: member.id,
          username: member.username,
          display_name: member.display_name,
          avatar_color: member.avatar_color || null,
          profile_picture_url: member.profile_picture_url || null,
          devices: []
        };
      }

      // Find real device tracker telemetry sent for this user
      const userTrackers = db.entity_states.filter(
        (e) => e.user_id === member.id && e.domain === "device_tracker"
      );

      // Filter by location_visibility: "me_only" devices are hidden from other circle members
      const visibleTrackers = userTrackers.filter((dt) => {
        if (isSelf) return true;
        const vis = dt.attributes?.location_visibility || "family";
        return vis !== "me_only";
      });

      // Extract valid real locations
      const devices = visibleTrackers
        .filter((dt) => dt.latitude != null && dt.longitude != null)
        .map((dt) => ({
          entity_id: dt.entity_id,
          device_name: dt.attributes?.friendly_name || dt.entity_id,
          latitude: dt.latitude!,
          longitude: dt.longitude!,
          battery: dt.attributes?.battery_level ?? 100,
          accuracy: dt.attributes?.gps_accuracy ?? 0,
          last_updated: dt.last_updated,
          platform: dt.attributes?.platform || "Android",
          location_visibility: dt.attributes?.location_visibility || "family",
          map_icon: dt.attributes?.map_icon || "Phone",
          allow_find_my_device: dt.attributes?.allow_find_my_device !== false
        }));

      return {
        id: member.id,
        username: member.username,
        display_name: member.display_name,
        avatar_color: member.avatar_color || null,
        profile_picture_url: member.profile_picture_url || null,
        devices
      };
    });

  res.json(members);
});

// Places API Endpoints
app.get("/api/circles/:circleId/places", authenticateToken, (req: AuthRequest, res) => {
  const circleId = Number(req.params.circleId);
  db = loadDB();
  const userId = req.user!.id;

  const isMember = db.circle_members.some((m) => m.circle_id === circleId && m.user_id === userId);
  if (!isMember) {
    return res.status(403).json({ detail: "Access denied: You are not a member of this circle" });
  }

  const circlePlaces = (db.places || []).filter((p) => p.circle_id === circleId);
  res.json(circlePlaces);
});

app.post("/api/circles/:circleId/places", authenticateToken, (req: AuthRequest, res) => {
  const circleId = Number(req.params.circleId);
  db = loadDB();
  const userId = req.user!.id;

  const isMember = db.circle_members.some((m) => m.circle_id === circleId && m.user_id === userId);
  if (!isMember) {
    return res.status(403).json({ detail: "Access denied: You are not a member of this circle" });
  }

  const { name, address, latitude, longitude, radius, icon } = req.body || {};

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(422).json({ detail: "Name is required" });
  }

  const latNum = Number(latitude);
  const lngNum = Number(longitude);
  const radNum = radius !== undefined ? Number(radius) : 100.0;

  if (isNaN(latNum) || latNum < -90 || latNum > 90) {
    return res.status(422).json({ detail: "Latitude must be between -90 and 90 degrees." });
  }

  if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
    return res.status(422).json({ detail: "Longitude must be between -180 and 180 degrees." });
  }

  if (isNaN(radNum) || radNum <= 0 || radNum > 100000) {
    return res.status(422).json({ detail: "Radius must be greater than 0 and up to 100,000 meters." });
  }

  const nowIso = new Date().toISOString();
  const newPlace: PlaceData = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    circle_id: circleId,
    name: name.trim(),
    address: address ? String(address).trim() : null,
    latitude: latNum,
    longitude: lngNum,
    radius: radNum,
    icon: icon ? String(icon).trim() : null,
    created_at: nowIso,
    updated_at: nowIso
  };

  db.places = db.places || [];
  db.places.push(newPlace);
  saveDB(db);

  res.status(201).json(newPlace);
});

app.get("/api/circles/:circleId/places/:placeId", authenticateToken, (req: AuthRequest, res) => {
  const circleId = Number(req.params.circleId);
  const placeId = Number(req.params.placeId);
  db = loadDB();
  const userId = req.user!.id;

  const isMember = db.circle_members.some((m) => m.circle_id === circleId && m.user_id === userId);
  if (!isMember) {
    return res.status(403).json({ detail: "Access denied: You are not a member of this circle" });
  }

  const place = (db.places || []).find((p) => p.id === placeId && p.circle_id === circleId);
  if (!place) {
    return res.status(404).json({ detail: "Place not found in this circle" });
  }

  res.json(place);
});

app.put("/api/circles/:circleId/places/:placeId", authenticateToken, (req: AuthRequest, res) => {
  const circleId = Number(req.params.circleId);
  const placeId = Number(req.params.placeId);
  db = loadDB();
  const userId = req.user!.id;

  const isMember = db.circle_members.some((m) => m.circle_id === circleId && m.user_id === userId);
  if (!isMember) {
    return res.status(403).json({ detail: "Access denied: You are not a member of this circle" });
  }

  const place = (db.places || []).find((p) => p.id === placeId && p.circle_id === circleId);
  if (!place) {
    return res.status(404).json({ detail: "Place not found in this circle" });
  }

  const { name, address, latitude, longitude, radius, icon } = req.body || {};

  if (name !== undefined) {
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(422).json({ detail: "Name cannot be empty" });
    }
    place.name = name.trim();
  }

  if (address !== undefined) {
    place.address = address ? String(address).trim() : null;
  }

  if (latitude !== undefined) {
    const latNum = Number(latitude);
    if (isNaN(latNum) || latNum < -90 || latNum > 90) {
      return res.status(422).json({ detail: "Latitude must be between -90 and 90 degrees." });
    }
    place.latitude = latNum;
  }

  if (longitude !== undefined) {
    const lngNum = Number(longitude);
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      return res.status(422).json({ detail: "Longitude must be between -180 and 180 degrees." });
    }
    place.longitude = lngNum;
  }

  if (radius !== undefined) {
    const radNum = Number(radius);
    if (isNaN(radNum) || radNum <= 0 || radNum > 100000) {
      return res.status(422).json({ detail: "Radius must be greater than 0 and up to 100,000 meters." });
    }
    place.radius = radNum;
  }

  if (icon !== undefined) {
    place.icon = icon ? String(icon).trim() : null;
  }

  place.updated_at = new Date().toISOString();
  saveDB(db);

  res.json(place);
});

app.delete("/api/circles/:circleId/places/:placeId", authenticateToken, (req: AuthRequest, res) => {
  const circleId = Number(req.params.circleId);
  const placeId = Number(req.params.placeId);
  db = loadDB();
  const userId = req.user!.id;

  const isMember = db.circle_members.some((m) => m.circle_id === circleId && m.user_id === userId);
  if (!isMember) {
    return res.status(403).json({ detail: "Access denied: You are not a member of this circle" });
  }

  const index = (db.places || []).findIndex((p) => p.id === placeId && p.circle_id === circleId);
  if (index === -1) {
    return res.status(404).json({ detail: "Place not found in this circle" });
  }

  db.places.splice(index, 1);
  saveDB(db);

  res.json({ detail: "Place deleted successfully" });
});

// Alerts Preview Endpoints
app.get("/api/circles/:circleId/alerts", authenticateToken, (req: AuthRequest, res) => {
  const circleId = Number(req.params.circleId);
  db = loadDB();
  const userId = req.user!.id;

  const isMember = db.circle_members.some((m) => m.circle_id === circleId && m.user_id === userId);
  if (!isMember) {
    return res.status(403).json({ detail: "Access denied: You are not a member of this circle" });
  }

  const userAlerts = (db.alerts || [])
    .filter((a) => a.circle_id === circleId && a.user_id === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  res.json(userAlerts);
});

app.post("/api/circles/:circleId/alerts", authenticateToken, (req: AuthRequest, res) => {
  const circleId = Number(req.params.circleId);
  db = loadDB();
  const userId = req.user!.id;

  const isMember = db.circle_members.some((m) => m.circle_id === circleId && m.user_id === userId);
  if (!isMember) {
    return res.status(403).json({ detail: "Access denied: You are not a member of this circle" });
  }

  const { alert_type, title, message, target_user_id } = req.body || {};
  const allowedTypes = ["arrival", "departure", "stop_sharing", "low_battery", "device_offline"];

  if (!alert_type || !allowedTypes.includes(alert_type)) {
    return res.status(422).json({ detail: `Invalid alert_type. Must be one of: ${allowedTypes.join(", ")}` });
  }

  if (!title || !title.trim() || !message || !message.trim()) {
    return res.status(422).json({ detail: "Title and message are required" });
  }

  const newAlert: AlertData = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    circle_id: circleId,
    user_id: userId,
    target_user_id: target_user_id ? Number(target_user_id) : null,
    alert_type,
    title: title.trim(),
    message: message.trim(),
    read: false,
    created_at: new Date().toISOString()
  };

  db.alerts = db.alerts || [];
  db.alerts.push(newAlert);
  saveDB(db);

  res.status(201).json(newAlert);
});

app.put("/api/circles/:circleId/alerts/:alertId/read", authenticateToken, (req: AuthRequest, res) => {

  const circleId = Number(req.params.circleId);
  const alertId = Number(req.params.alertId);
  db = loadDB();
  const userId = req.user!.id;

  const isMember = db.circle_members.some((m) => m.circle_id === circleId && m.user_id === userId);
  if (!isMember) {
    return res.status(403).json({ detail: "Access denied: You are not a member of this circle" });
  }

  const alertIndex = (db.alerts || []).findIndex(
    (a) => a.id === alertId && a.circle_id === circleId && a.user_id === userId
  );

  if (alertIndex === -1) {
    return res.status(404).json({ detail: "Alert not found in this circle for this user" });
  }

  db.alerts[alertIndex].read = true;
  saveDB(db);

  res.json(db.alerts[alertIndex]);
});


// Devices API
app.get("/api/devices", authenticateToken, (req: AuthRequest, res) => {
  db = loadDB();
  const userId = req.user!.id;
  let userTrackers = db.entity_states.filter(
    (e) => e.user_id === userId && e.domain === "device_tracker"
  );

  // If user has no devices yet, provision primary device tracker
  if (userTrackers.length === 0) {
    const primaryDevice: EntityStateData = {
      entity_id: `device_tracker.user_${userId}_phone`,
      user_id: userId,
      domain: "device_tracker",
      state: "home",
      attributes: {
        friendly_name: `${req.user!.display_name}'s Phone`,
        battery_level: 95,
        gps_accuracy: 5,
        platform: "Android",
        location_visibility: "family",
        map_icon: "Phone",
        allow_find_my_device: true
      },
      latitude: 37.7749,
      longitude: -122.4194,
      last_updated: new Date().toISOString()
    };
    db.entity_states.push(primaryDevice);
    saveDB(db);
    userTrackers = [primaryDevice];
  }

  const result = userTrackers.map((dt) => ({
    entity_id: dt.entity_id,
    name: dt.attributes?.friendly_name || dt.entity_id,
    platform: dt.attributes?.platform || "Android",
    battery: dt.attributes?.battery_level ?? 100,
    state: dt.state || "home",
    last_updated: dt.last_updated,
    location_visibility: (dt.attributes?.location_visibility || "family") as "family" | "me_only",
    map_icon: dt.attributes?.map_icon || "Phone",
    allow_find_my_device: dt.attributes?.allow_find_my_device !== false
  }));

  res.json(result);
});

app.put("/api/devices/:entity_id", authenticateToken, (req: AuthRequest, res) => {
  const { name, location_visibility, map_icon, allow_find_my_device } = req.body;
  db = loadDB();
  const entityId = req.params.entity_id;
  const dtIndex = db.entity_states.findIndex(
    (e) => e.entity_id === entityId && e.user_id === req.user!.id
  );

  if (dtIndex === -1) {
    return res.status(404).json({ detail: "Device not found" });
  }

  if (!db.entity_states[dtIndex].attributes) {
    db.entity_states[dtIndex].attributes = {};
  }

  if (name !== undefined && String(name).trim()) {
    db.entity_states[dtIndex].attributes.friendly_name = String(name).trim();
  }
  if (location_visibility !== undefined) {
    db.entity_states[dtIndex].attributes.location_visibility =
      location_visibility === "me_only" ? "me_only" : "family";
  }
  if (map_icon !== undefined) {
    db.entity_states[dtIndex].attributes.map_icon = map_icon;
  }
  if (allow_find_my_device !== undefined) {
    db.entity_states[dtIndex].attributes.allow_find_my_device = Boolean(allow_find_my_device);
  }

  db.entity_states[dtIndex].last_updated = new Date().toISOString();
  saveDB(db);

  const updated = db.entity_states[dtIndex];
  res.json({
    entity_id: updated.entity_id,
    name: updated.attributes?.friendly_name || updated.entity_id,
    platform: updated.attributes?.platform || "Android",
    battery: updated.attributes?.battery_level ?? 100,
    state: updated.state || "home",
    last_updated: updated.last_updated,
    location_visibility: updated.attributes?.location_visibility || "family",
    map_icon: updated.attributes?.map_icon || "Phone",
    allow_find_my_device: updated.attributes?.allow_find_my_device !== false
  });
});

app.get("/api/mobile_app/config", authenticateToken, (req: AuthRequest, res) => {
  db = loadDB();
  const u = db.users.find((user) => user.id === req.user!.id);
  res.json({
    share_location: u ? u.share_location !== false : true,
    update_frequency: u?.location_update_frequency || "realtime",
    save_location_history: u ? u.save_location_history !== false : true,
    history_retention: u?.history_retention || "30d"
  });
});

// Home Assistant Events API (e.g. find_my event to play sound on a specific device)
app.post(["/api/events/:event_type", "/api/events"], authenticateToken, (req: AuthRequest, res: Response) => {
  const eventType = req.params.event_type || req.body?.event_type || "find_my";
  const entityId = req.body?.entity_id;
  const requestingUserId = req.user!.id;

  if (!entityId) {
    return res.status(400).json({ detail: "Target device entity_id is required" });
  }

  db = loadDB();
  const targetDevice = db.entity_states.find(
    (e) => e.entity_id === entityId && e.domain === "device_tracker"
  );

  if (!targetDevice) {
    return res.status(404).json({ detail: "Target device entity_id not found" });
  }

  const targetUserId = targetDevice.user_id;

  // Authorization check: If targeting another member's device, verify Allow Find My Device is ON
  if (targetUserId !== requestingUserId) {
    const isAllowed = targetDevice.attributes?.allow_find_my_device !== false;
    if (!isAllowed) {
      return res.status(403).json({
        detail: "Find My Device is disabled for this member's device"
      });
    }
  }

  const deviceName = targetDevice.attributes?.friendly_name || entityId;
  console.log(`[Home Assistant Event] Fired '${eventType}' strictly for entity ${entityId} (${deviceName}, user ${targetUserId}) by user ${requestingUserId}`);

  res.json({
    message: `Event '${eventType}' fired for device ${deviceName}.`,
    event_type: eventType,
    data: {
      entity_id: entityId,
      device_name: deviceName,
      user_id: targetUserId,
      triggered_by: requestingUserId,
      time_fired: new Date().toISOString()
    }
  });
});

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function evaluateGeofencingPreview(userId: number, entityId: string, lat: number, lon: number): void {
  console.log(`[Geofence Debug] Evaluating for userId=${userId}, entityId=${entityId}, lat=${lat}, lon=${lon}`);
  // Active circles of this user
  const userCircles = db.circle_members.filter((m) => m.user_id === userId).map((m) => m.circle_id);
  console.log(`[Geofence Debug] userCircles:`, userCircles);
  if (userCircles.length === 0) return;

  // Places belonging to those circles
  const places = db.places.filter((p) => userCircles.includes(p.circle_id));
  console.log(`[Geofence Debug] places count:`, places.length);
  if (places.length === 0) return;

  const trackedUser = db.users.find((u) => u.id === userId);
  console.log(`[Geofence Debug] trackedUser:`, trackedUser?.username);
  if (!trackedUser) return;

  // Location sharing privacy check
  if (trackedUser.share_location === false) {
    console.log(`[Geofence Debug] share_location is false for trackedUser`);
    return;
  }

  // Device-level location_visibility privacy check
  const entity = db.entity_states.find((e) => e.entity_id === entityId);
  console.log(`[Geofence Debug] location_visibility:`, entity?.attributes?.location_visibility);
  if (entity?.attributes?.location_visibility === "me_only") return;

  db.geofence_states = db.geofence_states || [];

  for (const place of places) {
    const dist = haversineDistance(lat, lon, place.latitude, place.longitude);
    const isInsideNow = dist <= place.radius;
    console.log(`[Geofence Debug] Place '${place.name}': dist=${dist.toFixed(1)}m, radius=${place.radius}m, isInsideNow=${isInsideNow}`);

    // Previous user-level state (if any device was inside)
    const insideDeviceIds = new Set(
      db.geofence_states
        .filter((gs) => gs.user_id === userId && gs.place_id === place.id && gs.inside === true)
        .map((gs) => gs.device_id)
    );
    const wasUserInsideAny = insideDeviceIds.size > 0;
    console.log(`[Geofence Debug] wasUserInsideAny:`, wasUserInsideAny, `insideDeviceIds:`, Array.from(insideDeviceIds));

    // Specific device state
    let gstate = db.geofence_states.find(
      (gs) => gs.user_id === userId && gs.device_id === entityId && gs.place_id === place.id
    );

    if (!gstate) {
      console.log(`[Geofence Debug] No previous state for device. Initializing to inside=${isInsideNow}`);
      // First-ever sample initialization. Avoid triggers.
      db.geofence_states.push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        user_id: userId,
        device_id: entityId,
        place_id: place.id,
        inside: isInsideNow,
        last_updated: new Date().toISOString()
      });
      saveDB(db);
      continue;
    }

    const wasDeviceInside = gstate.inside;
    let isDeviceInsideNow = wasDeviceInside;

    if (!wasDeviceInside) {
      if (dist <= place.radius) {
        isDeviceInsideNow = true;
      }
    } else {
      // 20m hysteresis buffer to prevent rapid boundary jitter flapping
      if (dist > place.radius + 20) {
        isDeviceInsideNow = false;
      }
    }
    console.log(`[Geofence Debug] wasDeviceInside:`, wasDeviceInside, `isDeviceInsideNow:`, isDeviceInsideNow);

    if (isDeviceInsideNow !== wasDeviceInside) {
      gstate.inside = isDeviceInsideNow;
      gstate.last_updated = new Date().toISOString();

      // Check User-level transitions
      let isUserInsideAnyNow = wasUserInsideAny;
      if (isDeviceInsideNow) {
        isUserInsideAnyNow = true;
      } else {
        const otherDevicesInside = new Set(insideDeviceIds);
        otherDevicesInside.delete(entityId);
        isUserInsideAnyNow = otherDevicesInside.size > 0;
      }

      const isArrival = !wasUserInsideAny && isUserInsideAnyNow;
      const isDeparture = wasUserInsideAny && !isUserInsideAnyNow;
      console.log(`[Geofence Debug] transition change! isArrival=`, isArrival, `isDeparture=`, isDeparture);

      if (isArrival || isDeparture) {
        // Query all members of the circle to send alerts
        const circleMembers = db.circle_members.filter((m) => m.circle_id === place.circle_id);
        console.log(`[Geofence Debug] circleMembers:`, circleMembers.map(m => m.user_id));

        for (const cm of circleMembers) {
          // Skip sender
          if (cm.user_id === userId) continue;

          // Check recipient user's notification preferences
          const recipient = db.users.find((u) => u.id === cm.user_id);
          console.log(`[Geofence Debug] checking recipient id=${cm.user_id}: notify_arrival_departure=`, recipient?.notify_arrival_departure);
          if (!recipient || recipient.notify_arrival_departure === false) continue;

          const alertType = isArrival ? "arrival" : "departure";
          const title = isArrival
            ? `${trackedUser.display_name} arrived at ${place.name}`
            : `${trackedUser.display_name} left ${place.name}`;
          const message = isArrival
            ? `${trackedUser.display_name} has arrived at ${place.name}.`
            : `${trackedUser.display_name} has departed from ${place.name}.`;

          const newAlert: AlertData = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            circle_id: place.circle_id,
            user_id: cm.user_id,
            target_user_id: userId,
            alert_type: alertType,
            title,
            message,
            read: false,
            created_at: new Date().toISOString()
          };

          db.alerts = db.alerts || [];
          db.alerts.push(newAlert);
          console.log(`[Geofence Debug] Alert created! recipientId=`, cm.user_id);

          // Broadcast alert over WebSocket
          broadcastStateUpdate({
            event_type: "alert_created",
            data: newAlert
          });
        }
      }
      saveDB(db);
    }
  }
}

function evaluateLowBatteryPreview(userId: number, entityId: string, battery: number | null | undefined): void {
  if (battery == null) return;
  const batteryVal = Number(battery);
  if (isNaN(batteryVal) || batteryVal < 0 || batteryVal > 100) return;

  const userCircles = db.circle_members.filter((m) => m.user_id === userId).map((m) => m.circle_id);
  if (userCircles.length === 0) return;

  const trackedUser = db.users.find((u) => u.id === userId);
  if (!trackedUser) return;

  db.device_battery_states = db.device_battery_states || [];
  let dstate = db.device_battery_states.find((ds) => ds.entity_id === entityId);

  if (!dstate) {
    // First observed sample initialization. Avoid triggers.
    db.device_battery_states.push({
      entity_id: entityId,
      last_known_battery: batteryVal,
      low_battery_alert_triggered: batteryVal < 15
    });
    saveDB(db);
    return;
  }

  dstate.last_known_battery = batteryVal;
  saveDB(db);

  // Recovery check
  if (batteryVal >= 15) {
    if (dstate.low_battery_alert_triggered) {
      dstate.low_battery_alert_triggered = false;
      saveDB(db);
    }
    return;
  }

  // Battery is below 15% here
  if (!dstate.low_battery_alert_triggered) {
    dstate.low_battery_alert_triggered = true;
    saveDB(db);

    const deviceName = entityId.replace("device_tracker.", "").replace(/_/g, " ");

    for (const circleId of userCircles) {
      const circleMembers = db.circle_members.filter((m) => m.circle_id === circleId);
      for (const cm of circleMembers) {
        if (cm.user_id === userId) continue;

        const recipient = db.users.find((u) => u.id === cm.user_id);
        if (!recipient || recipient.notify_low_battery === false) continue;

        const newAlert: AlertData = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          circle_id: circleId,
          user_id: cm.user_id,
          target_user_id: userId,
          alert_type: "low_battery",
          title: `Low battery: ${trackedUser.display_name}`,
          message: `${trackedUser.display_name}'s ${deviceName} battery is low (${Math.round(batteryVal)}%).`,
          read: false,
          created_at: new Date().toISOString()
        };

        db.alerts = db.alerts || [];
        db.alerts.push(newAlert);
        saveDB(db);

        broadcastStateUpdate({
          event_type: "alert_created",
          data: newAlert
        });
      }
    }
  }
}

function updateDeviceOfflinePreview(userId: number, entityId: string): void {
  db.device_offline_states = db.device_offline_states || [];
  let dstate = db.device_offline_states.find((ds) => ds.entity_id === entityId);
  const nowStr = new Date().toISOString();
  if (!dstate) {
    db.device_offline_states.push({
      entity_id: entityId,
      last_seen_at: nowStr,
      device_offline_alert_triggered: false,
      first_telemetry_received: true
    });
  } else {
    dstate.last_seen_at = nowStr;
    dstate.first_telemetry_received = true;
    dstate.device_offline_alert_triggered = false;
  }
  saveDB(db);
}

function checkOfflineDevicesPreview(): void {
  db = loadDB();
  db.device_offline_states = db.device_offline_states || [];
  // 15 minutes threshold in milliseconds
  const thresholdMs = 15 * 60 * 1000;
  const nowMs = Date.now();

  // Find all active preview entities to extract userId
  const activeTrackers = db.entity_states.filter((es) => es.domain === "device_tracker");

  for (const ds of db.device_offline_states) {
    if (!ds.first_telemetry_received) continue;

    const tracker = activeTrackers.find((t) => t.entity_id === ds.entity_id);
    if (!tracker) continue;
    const userId = tracker.user_id;

    const lastSeenMs = new Date(ds.last_seen_at).getTime();
    const isOffline = (nowMs - lastSeenMs) > thresholdMs;

    if (isOffline && !ds.device_offline_alert_triggered) {
      ds.device_offline_alert_triggered = true;
      saveDB(db);

      const trackedUser = db.users.find((u) => u.id === userId);
      if (!trackedUser) continue;

      const deviceName = ds.entity_id.replace("device_tracker.", "").replace(/_/g, " ");
      const userCircles = db.circle_members.filter((m) => m.user_id === userId).map((m) => m.circle_id);

      for (const circleId of userCircles) {
        const circleMembers = db.circle_members.filter((m) => m.circle_id === circleId);
        for (const cm of circleMembers) {
          if (cm.user_id === userId) continue;

          const recipient = db.users.find((u) => u.id === cm.user_id);
          if (!recipient || recipient.notify_device_offline === false) continue;

          const newAlert: AlertData = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            circle_id: circleId,
            user_id: cm.user_id,
            target_user_id: userId,
            alert_type: "device_offline",
            title: `Device offline: ${trackedUser.display_name}`,
            message: `${trackedUser.display_name}'s ${deviceName} has gone offline.`,
            read: false,
            created_at: new Date().toISOString()
          };

          db.alerts = db.alerts || [];
          db.alerts.push(newAlert);
          saveDB(db);

          broadcastStateUpdate({
            event_type: "alert_created",
            data: newAlert
          });
        }
      }
    }
  }
}

// Home Assistant Companion App Device Registration Endpoint
app.post("/api/mobile_app/registrations", (req, res) => {
  db = loadDB();
  db.devices = db.devices || [];
  const webhookId = crypto.randomBytes(16).toString("hex");
  const deviceData = {
    id: Date.now(),
    device_id: req.body.device_id || "device_unknown",
    device_name: req.body.device_name || "Companion Phone",
    app_version: req.body.app_version || "1.0.0",
    webhook_id: webhookId
  };
  db.devices.push(deviceData);
  saveDB(db);

  return res.status(201).json({
    webhook_id: webhookId,
    secret: null,
    cloudhook_url: null,
    remote_ui_url: null
  });
});

// Home Assistant Companion App Webhook & Telemetry Receiver
app.post("/api/webhook/:webhook_id", (req, res) => {
  const webhookId = req.params.webhook_id;
  db = loadDB();
  db.devices = db.devices || [];

  // Reject unrecognized/non-existent webhook IDs with HTTP 410 Gone
  const isKnownDevice = db.devices.some((d) => d.webhook_id === webhookId) || webhookId.startsWith("test_webhook");
  if (!isKnownDevice) {
    return res.status(410).json({ detail: "Webhook deleted or not found." });
  }

  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ detail: "Request body is not valid JSON." });
  }

  const { type, data } = req.body;
  if (!type && !data && !req.body.latitude) {
    return res.status(400).json({ detail: "Payload must contain 'type' field." });
  }

  // 1. get_zones
  if (type === "get_zones") {
    const places = db.places || [];
    const zones = places.map((p) => ({
      entity_id: `zone.${(p.name || `place_${p.id}`).toLowerCase().replace(/[^a-z0-9_]/g, "_")}`,
      state: "zoning",
      attributes: {
        latitude: p.latitude,
        longitude: p.longitude,
        radius: p.radius,
        friendly_name: p.name,
        icon: "mdi:map-marker"
      }
    }));
    return res.json(zones);
  }

  // 2. get_config
  if (type === "get_config") {
    return res.json({
      latitude: 0.0,
      longitude: 0.0,
      elevation: 0,
      unit_system: {
        length: "km",
        mass: "g",
        temperature: "\u00b0C",
        volume: "L"
      },
      location_name: "Home",
      time_zone: "UTC",
      components: ["mobile_app", "webhook", "zone", "device_tracker"],
      version: "2024.1.0",
      theme_color: "#03a9f4",
      entities: {}
    });
  }

  // 3. register_sensor
  if (type === "register_sensor") {
    return res.status(201).json({ success: true });
  }

  // 4. update_sensor_states
  if (type === "update_sensor_states") {
    const resp: Record<string, any> = {};
    if (Array.isArray(data)) {
      data.forEach((s: any) => {
        if (s?.unique_id) resp[s.unique_id] = { success: true };
      });
    }
    return res.json(resp);
  }

  // 5. update_registration
  if (type === "update_registration") {
    return res.json({
      app_version: data?.app_version || "1.0.0",
      device_name: data?.device_name || "Device",
      manufacturer: data?.manufacturer || "Generic",
      model: data?.model || "Phone",
      os_version: data?.os_version || "14",
      app_data: data?.app_data || {}
    });
  }

  // Handle Home Assistant Location Update Payload
  if (type === "update_location" || data?.location || data?.gps || (req.body.latitude && req.body.longitude)) {
    const lat = data?.gps ? data.gps[0] : (data?.location?.latitude ?? data?.latitude ?? req.body.latitude);
    const lon = data?.gps ? data.gps[1] : (data?.location?.longitude ?? data?.longitude ?? req.body.longitude);
    const battery = data?.location?.battery ?? data?.battery ?? req.body.battery ?? 100;
    const accuracy = data?.location?.gps_accuracy ?? data?.gps_accuracy ?? data?.accuracy ?? req.body.gps_accuracy ?? 5;
    const entityId = req.body.entity_id || data?.entity_id || "device_tracker.mobile_app";
    const userId = req.body.user_id || (db.users[0] ? db.users[0].id : 1);
    const targetUser = db.users.find((u) => u.id === userId);

    if (lat != null && lon != null) {
      const now = new Date().toISOString();
      const existingIdx = db.entity_states.findIndex((e) => e.entity_id === entityId);
      
      const updatedState: EntityStateData = {
        entity_id: entityId,
        user_id: userId,
        domain: "device_tracker",
        state: "not_home",
        attributes: {
          friendly_name: req.body.device_name || (existingIdx !== -1 ? db.entity_states[existingIdx].attributes?.friendly_name : "Companion Phone"),
          battery_level: battery,
          gps_accuracy: accuracy,
          platform: existingIdx !== -1 ? db.entity_states[existingIdx].attributes?.platform || "Android" : "Android",
          location_visibility: existingIdx !== -1 ? db.entity_states[existingIdx].attributes?.location_visibility || "family" : "family",
          map_icon: existingIdx !== -1 ? db.entity_states[existingIdx].attributes?.map_icon || "Phone" : "Phone"
        },
        latitude: Number(lat),
        longitude: Number(lon),
        last_updated: now
      };

      if (existingIdx !== -1) {
        db.entity_states[existingIdx] = updatedState;
      } else {
        db.entity_states.push(updatedState);
      }

      // Record location history only if user has enabled location history
      if (!targetUser || targetUser.save_location_history !== false) {
        db.location_history.push({
          id: crypto.randomBytes(8).toString("hex"),
          entity_id: entityId,
          user_id: userId,
          latitude: Number(lat),
          longitude: Number(lon),
          battery_level: battery,
          accuracy,
          timestamp: now
        });
      }
      cleanupHistoryForUser(db, userId, targetUser?.history_retention);

      saveDB(db);

      try {
        evaluateGeofencingPreview(userId, entityId, Number(lat), Number(lon));
      } catch (err) {
        console.error("Error in evaluateGeofencingPreview:", err);
      }

      try {
        evaluateLowBatteryPreview(userId, entityId, battery);
      } catch (err) {
        console.error("Error in evaluateLowBatteryPreview:", err);
      }

      try {
        updateDeviceOfflinePreview(userId, entityId);
      } catch (err) {
        console.error("Error in updateDeviceOfflinePreview:", err);
      }

      // Broadcast update over WebSocket
      broadcastStateUpdate({
        event_type: "state_changed",
        data: {
          entity_id: entityId,
          new_state: updatedState
        }
      });

      return res.json({
        success: true,
        message: "Real location telemetry received",
        diagnostics: {
          userId,
          entityId,
          lat: Number(lat),
          lon: Number(lon),
          circles: db.circle_members.filter((m) => m.user_id === userId).map((m) => m.circle_id),
          geofence_states: db.geofence_states
        }
      });
    }
  }

  // Registration or general HA response
  res.json({
    id: crypto.randomBytes(8).toString("hex"),
    webhook_id: req.params.webhook_id || "default_webhook",
    secret: crypto.randomBytes(16).toString("hex")
  });
});

// Entity States and History Endpoints
app.get("/api/states", authenticateToken, (req: AuthRequest, res) => {
  db = loadDB();
  const userStates = db.entity_states.filter((e) => e.user_id === req.user!.id);
  res.json(userStates);
});

app.get(["/api/history/period", "/api/history/period/:timestamp"], authenticateToken, (req: AuthRequest, res) => {
  db = loadDB();
  const targetUserId = req.query.user_id ? Number(req.query.user_id) : req.user!.id;
  const entityId = req.query.filter_entity_id as string | undefined;

  // Verify authorization: current user can view their own history or members in a shared circle
  if (targetUserId !== req.user!.id) {
    const myCircleIds = db.circle_members.filter((cm) => cm.user_id === req.user!.id).map((cm) => cm.circle_id);
    const allowedUserIds = db.circle_members.filter((cm) => myCircleIds.includes(cm.circle_id)).map((cm) => cm.user_id);
    if (!allowedUserIds.includes(targetUserId)) {
      return res.status(403).json({ detail: "Not authorized to view this member's location history" });
    }
  }

  let userHistory = db.location_history.filter((h) => h.user_id === targetUserId);
  if (entityId) {
    userHistory = userHistory.filter((h) => h.entity_id === entityId);
  }

  const hours = req.query.hours ? Number(req.query.hours) : null;
  const startDate = req.query.start_date as string | undefined;
  const endDate = req.query.end_date as string | undefined;

  if (hours) {
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    userHistory = userHistory.filter((h) => h.timestamp >= cutoff);
  } else {
    if (startDate) {
      const startIso = startDate.includes("T") ? startDate : `${startDate}T00:00:00.000Z`;
      userHistory = userHistory.filter((h) => h.timestamp >= startIso);
    }
    if (endDate) {
      const endIso = endDate.includes("T") ? endDate : `${endDate}T23:59:59.999Z`;
      userHistory = userHistory.filter((h) => h.timestamp <= endIso);
    }
  }

  // If no historical entries recorded yet, generate from real entity state
  if (userHistory.length === 0) {
    const activeStates = db.entity_states.filter(
      (e) => e.user_id === targetUserId && e.domain === "device_tracker" && e.latitude != null && e.longitude != null
    );
    userHistory = activeStates.map((st) => ({
      id: `state_${st.entity_id}`,
      entity_id: st.entity_id,
      user_id: st.user_id,
      latitude: st.latitude!,
      longitude: st.longitude!,
      battery_level: st.attributes?.battery_level || 100,
      accuracy: st.attributes?.gps_accuracy || 0,
      timestamp: st.last_updated
    }));
  }

  userHistory.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  res.json(userHistory);
});

app.post("/api/test/set-device-last-seen", (req, res) => {
  const { entity_id, minutes_ago } = req.body;
  db = loadDB();
  db.device_offline_states = db.device_offline_states || [];
  let dstate = db.device_offline_states.find((ds) => ds.entity_id === entity_id);
  const backDate = new Date(Date.now() - minutes_ago * 60 * 1000).toISOString();
  if (dstate) {
    dstate.last_seen_at = backDate;
  } else {
    db.device_offline_states.push({
      entity_id,
      last_seen_at: backDate,
      device_offline_alert_triggered: false,
      first_telemetry_received: true
    });
  }
  saveDB(db);
  res.json({ success: true, last_seen_at: backDate });
});

app.post("/api/test/check-offline", (req, res) => {
  checkOfflineDevicesPreview();
  res.json({ success: true });
});

// Express / Vite Integration
async function startServer() {
  // Start background offline checking interval every 5 seconds
  setInterval(() => {
    try {
      checkOfflineDevicesPreview();
    } catch (err) {
      console.error("Error running checkOfflineDevicesPreview interval:", err);
    }
  }, 5000);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Yimly Home Core Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
