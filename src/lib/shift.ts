import { format } from "date-fns";

export type Bucket = "hourly" | "shift" | "daily";

// Default shifts: A 06-14, B 14-22, C 22-06
export function shiftOf(d: Date): "A" | "B" | "C" {
  const h = d.getHours();
  if (h >= 6 && h < 14) return "A";
  if (h >= 14 && h < 22) return "B";
  return "C";
}

export function bucketKey(d: Date, bucket: Bucket): string {
  if (bucket === "hourly") return format(d, "MMM d HH:00");
  if (bucket === "daily") return format(d, "MMM d");
  // shift
  const s = shiftOf(d);
  // Shift C straddles midnight; key on the date the shift started
  const date = new Date(d);
  if (s === "C" && d.getHours() < 6) date.setDate(date.getDate() - 1);
  return `${format(date, "MMM d")} · ${s}`;
}

export function bucketize<T extends { ts: string | Date; oee: number | string }>(
  rows: T[], bucket: Bucket,
): { ts: string; oee: number }[] {
  const map = new Map<string, { sum: number; n: number; order: number }>();
  rows.forEach((r) => {
    const d = new Date(r.ts);
    const k = bucketKey(d, bucket);
    const cur = map.get(k) ?? { sum: 0, n: 0, order: d.getTime() };
    cur.sum += Number(r.oee); cur.n++;
    cur.order = Math.min(cur.order, d.getTime());
    map.set(k, cur);
  });
  return Array.from(map.entries())
    .sort((a, b) => a[1].order - b[1].order)
    .map(([ts, v]) => ({ ts, oee: v.sum / v.n }));
}
