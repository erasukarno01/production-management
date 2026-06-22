## Tujuan
Menambah visualisasi produksi yang lebih kaya di halaman **Station Detail**, serta menambah master data **Product** dan modul **Work Order** di Admin.

---

## 1. Skema Database (migrasi baru)

### Tabel baru
- **`products`** — master produk
  - `code` (unique), `name`, `model`, `cycle_time_sec` (numeric, target detik/pcs), `ng_target_ratio` (default 0.02), `active` (bool)
- **`work_orders`** — perintah kerja produksi
  - `wo_number` (unique), `product_id` → products, `line_id` → lines, `station_id` (nullable, opsional) → stations, `planned_qty`, `planned_start`, `planned_end`, `status` enum(`draft`,`released`,`in_progress`,`done`,`cancelled`), `created_by`

### Kolom tambahan ke `oee_snapshots`
- `ng_count` (int, default 0) — jumlah NG dalam window snapshot
- `plan_count` (int, default 0) — target pcs untuk window tsb (dihitung dari cycle_time × run_time)
- `speedloss_sec` (int, default 0) — waktu hilang karena penurunan kecepatan: `run_time − (total_count × cycle_time)` jika positif

> Field lama (`good_count`, `total_count`, `run_time_sec`, `planned_time_sec`) tetap dipakai. NG = `total − good` (bisa dihitung), tetapi `ng_count` eksplisit memudahkan agregasi.

### RLS & GRANT
- `products`, `work_orders`: SELECT untuk `authenticated`; INSERT/UPDATE/DELETE hanya `admin` & `supervisor` (pakai `has_role`).
- GRANT lengkap untuk `authenticated` + `service_role` sesuai konvensi proyek.

---

## 2. Simulator Update (`admin.simulator.tsx` / `lib/oee.ts`)
Saat tick simulasi:
- Lookup `cycle_time_sec` station (via Work Order aktif → product, fallback default 30 dtk jika tidak ada WO).
- `plan_count = floor(run_time_sec / cycle_time)`.
- `ng_count = round(total_count × (1 − quality))`.
- `speedloss_sec = max(0, run_time_sec − total_count × cycle_time)`.
- Tulis semua field baru ke `oee_snapshots`.

---

## 3. Halaman Station Detail (`/station/$stationId`)

Tambahan **3 chart baru** di bawah "OEE Trend", sebelum "Recent Downtime":

### a. Bar Chart — Output Production (Pcs / Hour)
- Sumbu X: jam (24 jam terakhir, atau ikut `bucket`).
- Dua bar bersisian per jam: **Plan** (abu) vs **Actual** (biru). Actual berwarna merah jika di bawah plan.
- Sumber: agregasi `oee_snapshots` (`SUM(total_count)`, `SUM(plan_count)`) per jam.

### b. Donut Chart — NG Quantity & Ratio
- 2 segmen: **Good** vs **NG** (24 jam terakhir).
- Label tengah: total NG pcs + ratio %.
- Warna NG mengikuti threshold target (hijau < target, kuning < 2×, merah ≥ 2×).

### c. Bar Chart — Downtime + Speedloss (Minutes)
- Stacked bar per kategori downtime (`breakdown`, `changeover`, `material`, `quality`, `idle`, `other`) + **Speedloss** sebagai kategori tambahan.
- Sumber:
  - Downtime: agregasi `downtime_events.duration_sec` per kategori.
  - Speedloss: `SUM(speedloss_sec)` dari `oee_snapshots` window 24 jam.
- Tampilkan total menit di atas tiap bar.

Komponen baru dipisah ke `src/components/ProductionBarChart.tsx`, `NgDonutChart.tsx`, `DowntimeBarChart.tsx` (pakai Recharts).

---

## 4. Halaman Admin Baru

### a. `/admin/products` — Master Product
- Tabel: Code, Name, Model, Cycle Time (sec), NG Target %, Active, Action.
- Dialog Create/Edit (admin & supervisor saja).
- Toggle Active, soft-disable instead of delete.

### b. `/admin/work-orders` — Work Order
- Tabel: WO Number, Product, Line, Planned Qty, Start, End, Status, Action.
- Dialog "Create Work Order": pilih Product → pilih Line → (opsional) Station, isi qty & jadwal.
- Status flow: draft → released → in_progress → done / cancelled (tombol transisi).
- Filter by status & line.

Tambah link di sidebar `AppShell` di bawah grup Admin:
- Admin → Structure
- Admin → **Products** (baru)
- Admin → **Work Orders** (baru)
- Admin → Users
- Admin → Simulator

---

## 5. Catatan Teknis
- Charts pakai Recharts (sudah ada).
- Query agregasi dilakukan client-side dari hasil `select *` snapshot 24 jam (sudah ada limit 1000), atau via RPC `get_station_hourly_output(station_id)` jika data membesar (opsional, tidak di scope awal).
- TypeScript types regenerated otomatis setelah migrasi (jangan edit `types.ts` manual).
- Tidak ada perubahan auth flow; role check pakai `useAuth().isAdmin / isSupervisor`.

---

## Urutan Build
1. Migrasi DB (products, work_orders, kolom snapshots, RLS, GRANT).
2. Update simulator untuk mengisi field baru.
3. Komponen chart baru + integrasi di Station Detail.
4. Halaman `/admin/products`.
5. Halaman `/admin/work-orders`.
6. Update `AppShell` navigasi.

Apakah plan ini OK untuk dilanjut ke implementasi?
