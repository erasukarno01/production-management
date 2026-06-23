export interface ProductionSection {
  id: string;
  name: string;
  sort_order: number;
  created_at?: string | null;
}

export interface Line {
  id: string;
  production_section_id: string;
  name: string;
  target_oee: number;
  sort_order: number;
  created_at?: string | null;
}

export interface Station {
  id: string;
  line_id: string;
  name: string;
  target_oee: number;
  sort_order: number;
  created_at?: string | null;
}

export interface OeeSnapshot {
  id: string;
  station_id: string;
  ts: string;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  total_count?: number | null;
  good_count?: number | null;
  ng_count?: number | null;
  plan_count?: number | null;
  planned_time_sec?: number | null;
  run_time_sec?: number | null;
  speedloss_sec?: number | null;
  job_card_id?: string | null;
  created_at?: string | null;
}

export interface DowntimeEvent {
  id: string;
  station_id: string;
  started_at: string;
  ended_at?: string | null;
  duration_sec?: number | null;
  category: string;
  reason?: string | null;
  note?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

export interface Alert {
  id: string;
  station_id: string;
  level: string;
  message: string;
  oee_value?: number | null;
  created_at: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  model?: string | null;
  serial_prefix?: string | null;
  cycle_time_sec?: number | null;
  ng_target_ratio?: number | null;
  active?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface WoStation {
  id: string;
  work_order_id: string;
  station_id: string;
  job_card_number?: string | null;
  status: string;
  actual_start?: string | null;
  actual_end?: string | null;
  actual_qty?: number | null;
  ng_qty?: number | null;
  operator_id?: string | null;
  operator_name?: string | null;
  notes?: string | null;
  availability?: number | null;
  performance?: number | null;
  quality?: number | null;
  oee?: number | null;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface WorkOrder {
  id: string;
  wo_number: string;
  product_id: string;
  line_id: string;
  station_ids?: string | null;
  planned_qty?: number | null;
  actual_qty?: number | null;
  ng_qty?: number | null;
  planned_start?: string | null;
  planned_end?: string | null;
  per?: number | null;
  otr?: number | null;
  qr?: number | null;
  oee?: number | null;
  status?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Profile {
  id: string;
  email?: string | null;
  full_name?: string | null;
  username?: string | null;
  password_hash?: string | null;
  line_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: string;
  created_at?: string | null;
}

export interface EdgeNode {
  id: string;
  node_name: string;
  station_id?: string | null;
  line_name?: string | null;
  group_category?: string | null;
  station_name?: string | null;
  version?: string | null;
  status?: string | null;
  last_seen?: string | null;
  config_token?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ApiToken {
  id: string;
  token: string;
  label?: string | null;
  node_name: string;
  station_id?: string | null;
  permissions?: string | null;
  expires_at?: string | null;
  last_used_at?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type TableMap = {
  production_sections: ProductionSection;
  lines: Line;
  stations: Station;
  oee_snapshots: OeeSnapshot;
  downtime_events: DowntimeEvent;
  alerts: Alert;
  products: Product;
  work_orders: WorkOrder;
  wo_stations: WoStation;
  profiles: Profile;
  user_roles: UserRole;
  edge_nodes: EdgeNode;
  api_tokens: ApiToken;
};
