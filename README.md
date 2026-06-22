# Ohio Well Risk Viewer

A map-based tool for identifying and prioritizing Ohio oil & gas wells that need plugging, based on environmental risk (population proximity, emissions, hazard zones, well status, and more).

## Features

- Interactive map (Mapbox GL + PMTiles) of wells and county boundaries, with click-to-inspect detail sidebar
- Composite risk scoring and priority filtering (critical / high / medium / low)
- County-level impact, emissions, and parcel data
- Operator and state roll-ups, stranded-well and anomaly views
- Satellite imagery comparison for well sites
- Methodology page (`/methodology`) documenting how risk scores are computed — full detail below

## Methodology

Each well gets a **composite risk score** from 0–100, blending six independently scored dimensions. If a well is missing data for a dimension, that dimension is dropped and the remaining weights are renormalized, so missing data doesn't unfairly penalize a well:

```
composite = (water·0.25 + population·0.15 + emissions·0.20 + vegetation·0.15 + terrain·0.05 + inactivity·0.20)
            / (sum of weights for factors with actual data)
```

The composite score is binned into priority tiers calibrated against the actual distribution of ~104,000 scored wells (not arbitrary percentiles): **Critical** ≥ 45 (≈2%), **High** ≥ 35 (≈3%), **Medium** ≥ 25 (≈21%), **Low** < 25 (≈74%).

### Scoring dimensions

| Dimension | Weight | What it measures | Primary source |
|---|---|---|---|
| Water risk | 25% | Distance to drinking-water protection zones; a water-body floor (100/70) applies if the well sits in a lake or wetland | Ohio EPA SWAP (8,307 zones) |
| Inactivity | 20% | Years since last recorded production, with a 2-year grace period to absorb RBDMS reporting lag | Production records / completion date |
| Emissions | 20% | Combines aircraft methane-plume proximity (CarbonMapper, MethaneAIR) with Landsat 9 thermal anomalies over the well pad | CarbonMapper, MethaneAIR, Landsat 9 |
| Population exposure | 15% | Census population weighted within 0.6 mi and 3 mi buffers | US Census 2020 (3,168 OH tracts) |
| Vegetation | 15% | NDVI decline trend, sudden greenness drops, and moisture stress around the wellhead (cropland/urban masked out) | Sentinel-2 (2017–2024), ESA WorldCover 2021 |
| Terrain | 5% | Artificial flattening of the well pad vs. surrounding terrain slope | USGS 3DEP elevation (33 ft resolution) |

### Auxiliary flags (not part of the composite score)

Used for filtering/exploration only: **Clustered** (≥2 wells within 100 ft), **Near plume** (within 0.6 mi of a methane detection), **CH₄ anomaly**, **Vegetation loss**, **Artificially flat**, **Orphans only** (excludes wells with an active named operator).

### Scoring policies

- **Historic-owner floor** — wells with RBDMS `HISTORIC OWNER` status are floored to **medium** priority even if their raw score is lower, since orphan candidates with no remote-sensing signal would otherwise sink to "low."
- **Operator status is informational only** — it drives the "Orphans only" filter but never caps priority; a producing well with high environmental risk still scores high/critical.

### Known caveats

- The composite realistically tops out around **56**, not 100 — vegetation/emissions/terrain pipelines write `0` (not `NULL`) when no anomaly is detected, so renormalization rarely triggers. Priority thresholds are calibrated to this realized distribution.
- **Vegetation coverage is partial** — only ≈5,000 of ~104,000 wells have been analyzed by the Sentinel-2 pipeline so far.
- **Producing wells may show 1–2 years "inactive"** due to RBDMS's 12–18 month reporting lag; the inactivity score is zeroed out for wells with production in the last 2 years.
- **Aircraft flyover coverage is intermittent** — a well with no detected plume may still be leaking below the ~10–50 kg/hr detection threshold or simply hasn't been overflown.

Scoring scripts (`compute_composite.py`, `score_wells.py`, `score_population.py`, `score_emissions.py`, `detect_surface_anomalies.py`, `score_terrain.py`, `backfill_production_years.py`) live in the separate `Oil_Well_Scripts` repository. See `/methodology` in-app for the full writeup with score tables.

## Getting Started

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Environment variables

Create a `.env.local` with:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_MAPBOX_TOKEN=
SATELLITE_SERVICE_URL=
```

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — client-side Supabase access
- `SUPABASE_SERVICE_ROLE_KEY` — used server-side for bulk/paginated reads that bypass Supabase's row-count cap
- `NEXT_PUBLIC_MAPBOX_TOKEN` — Mapbox GL token for map tiles and styling
- `SATELLITE_SERVICE_URL` — backend used for satellite imagery comparison

## Project structure

- `app/` — route pages (map home, `table`, `counties`, `operators`, `states`, `stranded`, `anomalies`, `emissions`, `impact`, `methodology`, `facts`, `about`) and API routes
- `components/` — map, sidebar, and imagery UI components
- `lib/` — Supabase client, shared types, unit conversion helpers

## Tech stack

Next.js (App Router) · React · TypeScript · Supabase · Mapbox GL · PMTiles · Tailwind CSS · Zustand
