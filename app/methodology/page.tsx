import Link from 'next/link';
import SiteHeader from '@/components/SiteHeader';

export const metadata = {
  title: 'Methodology — Ohio Well Risk',
  description: 'How the Ohio well risk scoring pipeline works — data sources, formulas, and score mappings for each dimension.',
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 py-10 border-t border-gray-800">
      <h2 className="text-xl font-bold text-white mb-6">{title}</h2>
      <div className="space-y-4 text-sm text-gray-300 leading-relaxed">{children}</div>
    </section>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-gray-900 border border-gray-700 rounded px-4 py-3 text-xs text-gray-200 overflow-x-auto font-mono whitespace-pre">
      {children}
    </pre>
  );
}

function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: color, color: '#000' }}
    >
      {children}
    </span>
  );
}

export default function MethodologyPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <SiteHeader title="Methodology" sticky />

      {/* Hero */}
      <section className="px-6 py-16 border-b border-gray-800 text-center">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Methodology</p>
          <h1 className="text-4xl font-bold mb-4">How we score wells</h1>
          <p className="text-base text-gray-400 leading-relaxed">
            A walkthrough of the five scoring dimensions, the satellite data sources behind them,
            and the formulas that produce every number you see in the sidebar.
          </p>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* TOC */}
        <nav className="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-4">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-3">On this page</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <a className="text-blue-400 hover:text-blue-300" href="#composite">1 · Composite formula</a>
            <a className="text-blue-400 hover:text-blue-300" href="#priority">2 · Priority tiers</a>
            <a className="text-blue-400 hover:text-blue-300" href="#water">3 · Water risk (30%)</a>
            <a className="text-blue-400 hover:text-blue-300" href="#population">4 · Population exposure (20%)</a>
            <a className="text-blue-400 hover:text-blue-300" href="#emissions">5 · Emissions (20%)</a>
            <a className="text-blue-400 hover:text-blue-300" href="#vegetation">6 · Vegetation (20%)</a>
            <a className="text-blue-400 hover:text-blue-300" href="#terrain">7 · Terrain (10%)</a>
            <a className="text-blue-400 hover:text-blue-300" href="#flags">8 · Auxiliary flags</a>
            <a className="text-blue-400 hover:text-blue-300" href="#operator-cap">9 · Operator status cap</a>
            <a className="text-blue-400 hover:text-blue-300" href="#caveats">10 · Known caveats</a>
          </div>
        </nav>

        {/* 1 · Composite formula */}
        <Section id="composite" title="1 · Composite formula">
          <p>
            Each scored well gets a <strong>composite risk score</strong> from 0 to 100, computed as the
            weighted average of up to five dimensional scores. Missing dimensions are renormalized out
            so wells with partial data are not unfairly penalized.
          </p>
          <Formula>{`composite = (water·0.30 + population·0.20 + emissions·0.20 + vegetation·0.20 + terrain·0.10)
            / (sum of weights for dimensions that actually have data)`}</Formula>
          <p>
            Example: a well with only water, population, and emissions scores (no vegetation or terrain signal)
            has a denominator of 0.30 + 0.20 + 0.20 = 0.70. Its composite is the weighted sum of those three
            dimensions, divided by 0.70.
          </p>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">compute_composite.py</code>
          </p>
        </Section>

        {/* 2 · Priority tiers */}
        <Section id="priority" title="2 · Priority tiers">
          <p>
            Composite scores are binned into four tiers. The thresholds are calibrated to the realized
            distribution of composites across all 131,000 scored wells, not to arbitrary quartiles.
          </p>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium uppercase tracking-wider">Tier</th>
                  <th className="px-3 py-2 text-center font-medium uppercase tracking-wider">Threshold</th>
                  <th className="px-4 py-2 text-center font-medium uppercase tracking-wider">Share</th>
                  <th className="px-4 py-2 text-left font-medium uppercase tracking-wider">Typical count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr>
                  <td className="px-4 py-2"><Pill color="#ef4444">Critical</Pill></td>
                  <td className="px-3 py-2 text-center font-mono">composite ≥ 45</td>
                  <td className="px-4 py-2 text-center">≈ 0.06%</td>
                  <td className="px-4 py-2">≈ 39 wells</td>
                </tr>
                <tr>
                  <td className="px-4 py-2"><Pill color="#f97316">High</Pill></td>
                  <td className="px-3 py-2 text-center font-mono">composite ≥ 35</td>
                  <td className="px-4 py-2 text-center">≈ 1.3%</td>
                  <td className="px-4 py-2">≈ 930 wells</td>
                </tr>
                <tr>
                  <td className="px-4 py-2"><Pill color="#eab308">Medium</Pill></td>
                  <td className="px-3 py-2 text-center font-mono">composite ≥ 25</td>
                  <td className="px-4 py-2 text-center">≈ 17.6%</td>
                  <td className="px-4 py-2">≈ 22,000 wells</td>
                </tr>
                <tr>
                  <td className="px-4 py-2"><Pill color="#22c55e">Low</Pill></td>
                  <td className="px-3 py-2 text-center font-mono">composite &lt; 25</td>
                  <td className="px-4 py-2 text-center">≈ 80%</td>
                  <td className="px-4 py-2">≈ 108,000 wells</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        {/* 3 · Water */}
        <Section id="water" title="3 · Water risk — 30%">
          <p>
            Measures how close the well sits to a drinking-water source and whether it falls inside
            a state-designated protection zone. Water contamination is the loudest public-health argument
            for plugging, which is why this dimension carries the highest weight.
          </p>
          <p className="text-xs text-gray-500">
            Source: Ohio EPA Source Water Assessment Program (SWAP) — 8,307 protection-zone polygons.
          </p>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Condition</th>
                  <th className="px-3 py-2 text-center font-medium">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr>
                  <td className="px-4 py-2">Inside a protection zone (ST_Intersects)</td>
                  <td className="px-3 py-2 text-center font-mono">100</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Within 0.3 mi of a zone</td>
                  <td className="px-3 py-2 text-center font-mono">90</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Within 0.6 mi</td>
                  <td className="px-3 py-2 text-center font-mono">70</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Within 1.2 mi</td>
                  <td className="px-3 py-2 text-center font-mono">40</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Within 3 mi</td>
                  <td className="px-3 py-2 text-center font-mono">15</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Beyond 3 mi</td>
                  <td className="px-3 py-2 text-center font-mono">0</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">score_wells.py</code> · PostGIS <code className="text-gray-400">ST_DWithin</code>,{' '}
            <code className="text-gray-400">ST_Intersects</code>, <code className="text-gray-400">&lt;-&gt;</code> KNN on centroids.
          </p>
        </Section>

        {/* 4 · Population */}
        <Section id="population" title="4 · Population exposure — 20%">
          <p>
            Counts how many people live near the well, using 2020 Census tract centroids. Because
            tract boundaries are not uniform, the pipeline uses PostGIS intersection with buffered
            well points rather than a simple nearest-centroid join.
          </p>
          <p className="text-xs text-gray-500">
            Source: US Census Bureau 2020 tracts (TIGER/Line) — 3,168 Ohio tracts via <code className="text-gray-400">pygris</code>.
          </p>
          <Formula>{`pop_within_1km  = SUM(tract.pop × (tract ∩ buffer_1km).area / tract.area)
pop_within_5km  = SUM(tract.pop × (tract ∩ buffer_5km).area / tract.area)

population_score = f(pop_within_1km, pop_within_5km)`}</Formula>
          <p>
            Score climbs sharply with 0.6 mi population (direct-exposure risk) and more gradually with
            3 mi population (regional risk). A well with 500 people inside 0.6 mi typically scores
            around 80; one with 5,000 inside 3 mi but none inside 0.6 mi scores around 40.
          </p>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">score_population.py</code>
          </p>
        </Section>

        {/* 5 · Emissions */}
        <Section id="emissions" title="5 · Emissions — 20%">
          <p>
            Combines two independent satellite signals: <strong>methane (CH₄)</strong> and <strong>thermal anomaly</strong>.
            The methane score uses a tiered source-of-truth hierarchy, falling back to lower-resolution
            sensors only when higher-resolution ones have no coverage.
          </p>

          <h3 className="text-sm font-semibold text-white mt-4">CH₄ — three-tier hierarchy</h3>
          <div className="space-y-3">
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <Pill color="#dc2626">Tier 1</Pill>
                <span className="font-semibold text-white">Plume proximity</span>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">
                If the well is within 0.6 mi of a CarbonMapper or MethaneAIR L4 plume detection in the
                oil-and-gas sector, it scores 60–90 based on plume flux (kg/hr, log-scaled).
                <br />
                <code className="text-gray-400">ch4_signal_source</code> = <code className="text-gray-400">plume:carbonmapper</code>{' '}
                or <code className="text-gray-400">plume:methaneair</code>.
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <Pill color="#f97316">Tier 2</Pill>
                <span className="font-semibold text-white">MethaneAIR L3 grid</span>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">
                Otherwise, if the well falls inside a MethaneAIR L3 aircraft footprint, the score is graded
                linearly on the ~33 ft XCH₄ value between Ohio L3 p50 (score 0) and p95 (score 70).
                <br />
                <code className="text-gray-400">ch4_signal_source</code> = <code className="text-gray-400">l3:methaneair</code>.
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <Pill color="#f59e0b">Tier 3</Pill>
                <span className="font-semibold text-white">Sentinel-5P hotspot fallback</span>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">
                When neither plume nor L3 data covers the well, the pipeline samples the 2021–2024
                Sentinel-5P mean over a 3.4 mi buffer (≈ 1 S5P pixel) and compares to the Ohio-wide
                95th percentile. Below threshold → score 0. At threshold → 50. At the 99th percentile
                cap → 100. Linearly interpolated between.
                <br />
                <code className="text-gray-400">ch4_signal_source</code> = <code className="text-gray-400">l3:s5p_hotspot</code>{' '}
                or <code className="text-gray-400">l3:s5p_below_threshold</code>.
              </p>
            </div>
          </div>

          <h3 className="text-sm font-semibold text-white mt-6">Thermal — Landsat 9</h3>
          <p>
            Stacked on top of the CH₄ score (capped at 100 combined). Compares the well&apos;s 330 ft surface
            temperature against its 0.6 mi background, averaged over summer 2022–2024, cloud &lt; 20%.
          </p>
          <Formula>{`thermal_Δ = LST(buffer_100m) − LST(buffer_1km)`}</Formula>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Δ (°C)</th>
                  <th className="px-3 py-2 text-center font-medium">Score added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr><td className="px-4 py-2">≥ 2</td><td className="px-3 py-2 text-center font-mono">+20</td></tr>
                <tr><td className="px-4 py-2">≥ 5</td><td className="px-3 py-2 text-center font-mono">+40</td></tr>
                <tr><td className="px-4 py-2">≥ 8</td><td className="px-3 py-2 text-center font-mono">+60</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">score_emissions.py</code>,{' '}
            <code className="text-gray-400">ingest_carbonmapper.py</code>,{' '}
            <code className="text-gray-400">ingest_methaneair_plumes.py</code>.
          </p>
        </Section>

        {/* 6 · Vegetation */}
        <Section id="vegetation" title="6 · Vegetation — 20%">
          <p>
            Detects vegetation die-off and moisture stress around the well using multi-year Sentinel-2 indices.
            Cropland and built-up land are masked out via ESA WorldCover 2021 so that seasonal harvest cycles
            and paved areas don&apos;t produce false positives.
          </p>
          <p className="text-xs text-gray-500">
            Sources: Sentinel-2 MSI (2017–2024), ESA WorldCover 2021.
          </p>
          <Formula>{`vegetation_score = min(100,
    max( NDVI-anomaly-score,
         NDVI-trend-score    )        # 25 / 50 / 80 based on slope
  + NDMI-stress-bonus )               # 0 / 10 / 20`}</Formula>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">NDVI trend slope (/yr)</th>
                  <th className="px-3 py-2 text-center font-medium">Contribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr><td className="px-4 py-2">&lt; -0.03 (steep multi-year decline)</td><td className="px-3 py-2 text-center font-mono">80</td></tr>
                <tr><td className="px-4 py-2">&lt; -0.015</td><td className="px-3 py-2 text-center font-mono">50</td></tr>
                <tr><td className="px-4 py-2">&lt; -0.005</td><td className="px-3 py-2 text-center font-mono">25</td></tr>
                <tr><td className="px-4 py-2">≥ -0.005 (stable or improving)</td><td className="px-3 py-2 text-center font-mono">0</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            NDMI (normalized difference moisture index) adds a bonus when the well&apos;s moisture signal has
            dropped noticeably from baseline — a signal of brine spill or salt stress around old wellheads.
          </p>
          <p className="text-xs text-gray-500">
            Sources: <code className="text-gray-400">detect_surface_anomalies.py</code>,{' '}
            <code className="text-gray-400">compute_composite.py</code>.
          </p>
        </Section>

        {/* 7 · Terrain */}
        <Section id="terrain" title="7 · Terrain — 10%">
          <p>
            Identifies artificially graded well pads by comparing the well&apos;s immediate 330 ft slope
            against its 1,300 ft surroundings. Natural terrain does not create sharp local flatness anomalies,
            so a well pad that is much flatter than its surroundings is almost certainly human-made.
          </p>
          <p className="text-xs text-gray-500">
            Source: USGS 3DEP ~33 ft DEM (tiled collection) via Google Earth Engine.
          </p>
          <Formula>{`slope_ratio = mean_slope_well_100m / mean_slope_bg_400m
is_artificially_flat = (bg_slope > 1.0°)  AND  (slope_ratio < 0.4)`}</Formula>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Condition</th>
                  <th className="px-3 py-2 text-center font-medium">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr><td className="px-4 py-2">ratio &lt; 0.25 (extreme grading)</td><td className="px-3 py-2 text-center font-mono">100</td></tr>
                <tr><td className="px-4 py-2">ratio &lt; 0.4</td><td className="px-3 py-2 text-center font-mono">70</td></tr>
                <tr><td className="px-4 py-2">ratio &lt; 0.6</td><td className="px-3 py-2 text-center font-mono">40</td></tr>
                <tr><td className="px-4 py-2">ratio &lt; 0.8</td><td className="px-3 py-2 text-center font-mono">15</td></tr>
                <tr><td className="px-4 py-2">no signal (bg flat or high ratio)</td><td className="px-3 py-2 text-center font-mono">0</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">score_terrain.py</code>
          </p>
        </Section>

        {/* 8 · Flags */}
        <Section id="flags" title="8 · Auxiliary flags">
          <p>
            In addition to the five scored dimensions, the map exposes binary flags that can be used
            to filter wells. Flags are not part of the composite — they are independent signals for
            hypothesis-driven filtering.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <p className="font-semibold text-white mb-1">Clustered (≥ 2 neighbors)</p>
              <p className="text-xs text-gray-300">
                Well has 2 or more other wells with centroids 33–100 ft away — typical of old infill
                pads or modern multi-lateral well sites. Computed via a PostGIS self-join with
                <code className="text-gray-400"> ST_DWithin</code> + exact geodesic distance.
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <p className="font-semibold text-white mb-1">Near plume</p>
              <p className="text-xs text-gray-300">
                Well matched Tier 1 in the CH₄ hierarchy — within 0.6 mi of a CarbonMapper or MethaneAIR
                plume point.
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <p className="font-semibold text-white mb-1">CH₄ anomaly</p>
              <p className="text-xs text-gray-300">
                Well has a detectable methane anomaly (any tier) — <code className="text-gray-400">ch4_is_anomaly = true</code>{' '}
                in the DB.
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <p className="font-semibold text-white mb-1">Vegetation loss</p>
              <p className="text-xs text-gray-300">
                Sentinel-2 analysis detected significant NDVI loss (types: vegetation_loss, severe_loss,
                near_total_loss).
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <p className="font-semibold text-white mb-1">Artificially flat</p>
              <p className="text-xs text-gray-300">
                Terrain analysis flagged the well pad as human-graded — see section 7.
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <p className="font-semibold text-white mb-1">Orphans only</p>
              <p className="text-xs text-gray-300">
                Hard filter that excludes wells with an active named operator on file, leaving only
                <code className="text-gray-400"> historic_owner</code> and{' '}
                <code className="text-gray-400">orphan_program</code> wells (≈ 50,000 of 131,000).
              </p>
            </div>
          </div>
        </Section>

        {/* 9 · Operator cap */}
        <Section id="operator-cap" title="9 · Operator status cap">
          <p>
            RBDMS tracks a rough operator status for each well. Wells with an active named operator
            are capped at <Pill color="#eab308">medium</Pill> priority regardless of composite score —
            they are the operator&apos;s legal responsibility to plug, not a state-funded plugging candidate.
          </p>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Meaning</th>
                  <th className="px-3 py-2 text-center font-medium">Plugging candidate?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr>
                  <td className="px-4 py-2"><code className="text-gray-400">named_operator</code></td>
                  <td className="px-4 py-2">Active company on file</td>
                  <td className="px-3 py-2 text-center text-red-400">No — operator liable</td>
                </tr>
                <tr>
                  <td className="px-4 py-2"><code className="text-gray-400">historic_owner</code></td>
                  <td className="px-4 py-2">RBDMS lists &ldquo;HISTORIC OWNER&rdquo; — real owner lost</td>
                  <td className="px-3 py-2 text-center text-green-400">Yes</td>
                </tr>
                <tr>
                  <td className="px-4 py-2"><code className="text-gray-400">orphan_program</code></td>
                  <td className="px-4 py-2">Enrolled in Ohio&apos;s Orphan Well Plugging Program</td>
                  <td className="px-3 py-2 text-center text-green-400">Yes</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        {/* 10 · Caveats */}
        <Section id="caveats" title="10 · Known caveats">
          <div className="space-y-5">
            <div>
              <p className="font-semibold text-white mb-1">Composite tops out around 56, not 100.</p>
              <p className="text-xs text-gray-400">
                Vegetation, emissions, and terrain pipelines write 0 (not NULL) for wells with no
                detected anomaly, so the renormalization fallback never triggers. The priority
                thresholds (45/35/25) are calibrated to this realized distribution — they are
                lower than a &ldquo;theoretical-max&rdquo; design would suggest.
              </p>
            </div>
            <div>
              <p className="font-semibold text-white mb-1">Surface-anomaly coverage is partial.</p>
              <p className="text-xs text-gray-400">
                Only ≈ 5,000 of the 131,000 scored wells have been analyzed by the Sentinel-2
                vegetation pipeline so far. Wells without coverage have NULL for{' '}
                <code className="text-gray-400">veg_anomaly_detected</code>, which means the{' '}
                &ldquo;Vegetation loss&rdquo; flag only matches the ≈ 484 wells with confirmed detection.
              </p>
            </div>
            <div>
              <p className="font-semibold text-white mb-1">Producing wells show 1–2 years inactive.</p>
              <p className="text-xs text-gray-400">
                RBDMS production is annual-resolution, and reports trail calendar time by 12–18 months.
                A well that produced through Dec 2024 shows <code className="text-gray-400">years_inactive = 1</code>{' '}
                in mid-2026 purely because the 2025 production numbers haven&apos;t been ingested. The sidebar
                displays &ldquo;Currently producing (last report YYYY)&rdquo; for these wells, and the inactivity
                score is zeroed out.
              </p>
            </div>
            <div>
              <p className="font-semibold text-white mb-1">Sentinel-5P can&apos;t see small leaks.</p>
              <p className="text-xs text-gray-400">
                S5P&apos;s 3.4 mi pixels can only detect plumes above ≈ 100 kg/hr, and only under favorable
                wind conditions. A well scored 0 on CH₄ via Tier 3 is not necessarily non-emitting —
                it may be emitting below S5P&apos;s detection threshold. CarbonMapper and MethaneAIR (Tiers
                1 and 2) can see down to ≈ 10 kg/hr and ≈ 50 kg/hr respectively, but only cover the
                geographies their campaigns flew.
              </p>
            </div>
          </div>
        </Section>
      </div>

      {/* Footer CTA */}
      <section className="bg-gradient-to-r from-gray-800 to-gray-900 px-6 py-12 border-t border-gray-800">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-gray-300 mb-6">Ready to explore the map with this context?</p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href="/"      className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded font-medium text-sm transition-colors">Open the Map</Link>
            <Link href="/about" className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded font-medium text-sm transition-colors">Back to About</Link>
          </div>
        </div>
      </section>

      <footer className="bg-gray-900 px-6 py-6 border-t border-gray-800 text-center text-xs text-gray-500">
        <p>Methodology last reviewed 2026-04. Scoring scripts live in the Oil_Well_Scripts repository.</p>
      </footer>
    </div>
  );
}
