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
            Each well gets a risk score from 0 to 100 based on five factors: water proximity, population nearby,
            methane emissions, vegetation damage, and terrain. This page explains how each factor works and the data sources we use.
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
            <a className="text-blue-400 hover:text-blue-300" href="#water">3 · Water risk (25%)</a>
            <a className="text-blue-400 hover:text-blue-300" href="#population">4 · Population exposure (15%)</a>
            <a className="text-blue-400 hover:text-blue-300" href="#emissions">5 · Emissions (20%)</a>
            <a className="text-blue-400 hover:text-blue-300" href="#vegetation">6 · Vegetation (15%)</a>
            <a className="text-blue-400 hover:text-blue-300" href="#terrain">7 · Terrain (5%)</a>
            <a className="text-blue-400 hover:text-blue-300" href="#inactivity">8 · Inactivity (20%)</a>
            <a className="text-blue-400 hover:text-blue-300" href="#flags">9 · Auxiliary flags</a>
            <a className="text-blue-400 hover:text-blue-300" href="#policies">10 · Scoring policies</a>
            <a className="text-blue-400 hover:text-blue-300" href="#caveats">11 · Known caveats</a>
          </div>
        </nav>

        {/* 1 · Composite formula */}
        <Section id="composite" title="1 · Composite formula">
          <p>
            Each well gets a <strong>composite risk score</strong> from 0 to 100 by blending six independent factors.
            If any factor has no data, that factor is excluded and the others are rescaled — so missing data
            doesn't penalize a well unfairly.
          </p>
          <Formula>{`composite = (water·0.25 + population·0.15 + emissions·0.20 + vegetation·0.15 + terrain·0.05 + inactivity·0.20)
            / (sum of weights for factors with actual data)`}</Formula>
          <p>
            Example: if a well has water, population, emissions, and inactivity data but no vegetation or terrain,
            the denominator is 0.25 + 0.15 + 0.20 + 0.20 = 0.80. The final score normalizes the weighted sum of those four factors by dividing by 0.80.
          </p>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">compute_composite.py</code>
          </p>
        </Section>

        {/* 2 · Priority tiers */}
        <Section id="priority" title="2 · Priority tiers">
          <p>
            The composite score is binned into four priority tiers. The cutoff points are based on the
            actual distribution of wells in the database (about 104,000 scored), not arbitrary percentiles.
          </p>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium uppercase tracking-wider">Priority</th>
                  <th className="px-3 py-2 text-center font-medium uppercase tracking-wider">Score range</th>
                  <th className="px-4 py-2 text-center font-medium uppercase tracking-wider">Share</th>
                  <th className="px-4 py-2 text-left font-medium uppercase tracking-wider">Well count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr>
                  <td className="px-4 py-2"><Pill color="#ef4444">Critical</Pill></td>
                  <td className="px-3 py-2 text-center font-mono">≥ 45</td>
                  <td className="px-4 py-2 text-center">≈ 2%</td>
                  <td className="px-4 py-2">≈ 2,100</td>
                </tr>
                <tr>
                  <td className="px-4 py-2"><Pill color="#f97316">High</Pill></td>
                  <td className="px-3 py-2 text-center font-mono">≥ 35</td>
                  <td className="px-4 py-2 text-center">≈ 3%</td>
                  <td className="px-4 py-2">≈ 3,500</td>
                </tr>
                <tr>
                  <td className="px-4 py-2"><Pill color="#eab308">Medium</Pill></td>
                  <td className="px-3 py-2 text-center font-mono">≥ 25</td>
                  <td className="px-4 py-2 text-center">≈ 21%</td>
                  <td className="px-4 py-2">≈ 22,000</td>
                </tr>
                <tr>
                  <td className="px-4 py-2"><Pill color="#22c55e">Low</Pill></td>
                  <td className="px-3 py-2 text-center font-mono">&lt; 25</td>
                  <td className="px-4 py-2 text-center">≈ 74%</td>
                  <td className="px-4 py-2">≈ 76,000</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        {/* 3 · Water */}
        <Section id="water" title="3 · Water risk — 25%">
          <p>
            A leaking well near a drinking-water intake is the clearest public-health reason to plug it first.
            This score measures how close the well sits to registered drinking-water protection zones and, as a fallback,
            any permanent water body (like a lake or wetland).
          </p>
          <p className="text-xs text-gray-500">
            Source: Ohio EPA Source Water Assessment Program (SWAP) — 8,307 drinking-water protection zones.
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
                  <td className="px-4 py-2">Inside a protection zone</td>
                  <td className="px-3 py-2 text-center font-mono">90+</td>
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
                  <td className="px-4 py-2">Within 1.9 mi</td>
                  <td className="px-3 py-2 text-center font-mono">50</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Within 3 mi</td>
                  <td className="px-3 py-2 text-center font-mono">30</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Within 6 mi</td>
                  <td className="px-3 py-2 text-center font-mono">15</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Beyond 6 mi</td>
                  <td className="px-3 py-2 text-center font-mono">5</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-300 mt-3">
            <strong>Water-body floor:</strong> Wells that sit inside a lake or wetland (detected via satellite land-cover data) get
            a minimum water score of 100 (lakes) or 70 (wetlands), bypassing the distance calculation. This is a safety net for major water bodies
            not registered in the state zone database.
          </p>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">score_wells.py</code>
          </p>
        </Section>

        {/* 4 · Population */}
        <Section id="population" title="4 · Population exposure — 15%">
          <p>
            Wells near populated areas pose higher risks in case of spills or emissions. This score counts
            how many people live within 0.6 mi (immediate neighborhood) and 3 mi (surrounding area) of the well,
            using 2020 Census data scaled by the fraction of each neighborhood that overlaps the well's buffer.
          </p>
          <p className="text-xs text-gray-500">
            Source: US Census Bureau 2020 Census tracts — 3,168 Ohio neighborhoods.
          </p>
          <Formula>{`population_0_6mi  = weighted residents within 0.6 mi
population_3mi    = weighted residents within 3 mi

population_score = blended function of both buffers`}</Formula>
          <p>
            The score is sensitive to people within 0.6 mi (immediate danger zone) and somewhat sensitive to
            people within 3 mi (regional impact). A well with 500 people in the immediate neighborhood (0.6 mi)
            typically scores around 80. A well with 5,000 people at regional distance (3 mi) but none immediately nearby scores lower, around 40.
          </p>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">score_population.py</code>
          </p>
        </Section>

        {/* 5 · Emissions */}
        <Section id="emissions" title="5 · Emissions — 20%">
          <p>
            Leaking methane is a climate and safety hazard. This score combines two independent satellite
            measurements: nearby methane plume detections from aircraft and thermal heat signatures from satellite imagery.
          </p>

          <h3 className="text-sm font-semibold text-white mt-4">Plume proximity — CarbonMapper and MethaneAIR detections</h3>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <p className="text-xs text-gray-300 leading-relaxed mb-3">
              When aircraft flyovers detect a methane plume from the oil-and-gas sector, each detection is logged
              with its location and estimated emission rate (kg/hr). Wells near detected plumes get higher scores.
            </p>
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-3 py-1 text-left font-medium">Distance from nearest plume</th>
                  <th className="px-3 py-1 text-center font-medium">Score added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr><td className="px-3 py-1">Within 0.3 mi</td><td className="px-3 py-1 text-center font-mono">+50</td></tr>
                <tr><td className="px-3 py-1">Within 0.6 mi</td><td className="px-3 py-1 text-center font-mono">+35</td></tr>
                <tr><td className="px-3 py-1">Within 1.6 mi</td><td className="px-3 py-1 text-center font-mono">+20</td></tr>
                <tr><td className="px-3 py-1">Within 3 mi</td><td className="px-3 py-1 text-center font-mono">+10</td></tr>
              </tbody>
            </table>
            <p className="text-xs text-gray-400 mt-2">
              <strong>Large-leak bonus:</strong> if any plume within 3 mi emits ≥1,000 kg/hr (a major leak), add +20.
            </p>
          </div>

          <h3 className="text-sm font-semibold text-white mt-6">Thermal signal — Landsat 9 heat</h3>
          <p className="text-xs text-gray-300">
            Active venting warms the ground. Landsat 9 measures surface temperature over the well pad
            (330 ft radius) and compares it to the cooler background (0.6 mi radius), averaged over summer months 2022–2024.
          </p>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-3 py-1 text-left font-medium">Temperature rise</th>
                  <th className="px-3 py-1 text-center font-medium">Score added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr><td className="px-3 py-1">≥ 3.6°F warmer</td><td className="px-3 py-1 text-center font-mono">+20</td></tr>
                <tr><td className="px-3 py-1">≥ 9°F warmer</td><td className="px-3 py-1 text-center font-mono">+40</td></tr>
                <tr><td className="px-3 py-1">≥ 14°F warmer</td><td className="px-3 py-1 text-center font-mono">+60</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-300 mt-3">
            Both signals are added together, with a final cap of 100. A well with a nearby plume (+35) and a
            thermal anomaly of 9°F (+40) would score 75 for emissions.
          </p>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">score_emissions.py</code>
          </p>
        </Section>

        {/* 6 · Vegetation */}
        <Section id="vegetation" title="6 · Vegetation — 15%">
          <p>
            Wells that leak salt water or brine cause vegetation stress. This score detects dead or dying plants
            around the well using satellite imagery (Sentinel-2) from 2017–2024. Cropland and cities are masked out
            so that harvests and paved roads don't trigger false alarms.
          </p>
          <p className="text-xs text-gray-500">
            Source: Sentinel-2 satellite imagery (2017–2024), ESA WorldCover 2021 land classification.
          </p>
          <Formula>{`vegetation_score = combination of:
  • Long-term greenness trend (slope over 7 years)
  • Sudden drops in greenness (recent anomaly)
  • Moisture-stress signal around wellhead`}</Formula>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Greenness trend</th>
                  <th className="px-3 py-2 text-center font-medium">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr><td className="px-4 py-2">Steep decline (steeper than −0.03/yr)</td><td className="px-3 py-2 text-center font-mono">80</td></tr>
                <tr><td className="px-4 py-2">Moderate decline (−0.015 to −0.03/yr)</td><td className="px-3 py-2 text-center font-mono">50</td></tr>
                <tr><td className="px-4 py-2">Mild decline (−0.005 to −0.015/yr)</td><td className="px-3 py-2 text-center font-mono">25</td></tr>
                <tr><td className="px-4 py-2">Stable or improving</td><td className="px-3 py-2 text-center font-mono">0</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-300 mt-3">
            A moisture-stress bonus (0 to 20 points) is added when the well pad shows drying out compared to baseline,
            a sign of salt contamination or brine spill around the wellhead.
          </p>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">detect_surface_anomalies.py</code>
          </p>
        </Section>

        {/* 7 · Terrain */}
        <Section id="terrain" title="7 · Terrain — 5%">
          <p>
            Well pads are often deliberately flattened to create safe working space. This score detects signs of
            artificial grading by comparing the immediate terrain around the well (330 ft radius) to the surrounding
            landscape (1,300 ft radius). Natural hills and valleys don't create sharp flat spots; unnatural flatness
            suggests a human-made pad.
          </p>
          <p className="text-xs text-gray-500">
            Source: USGS 3DEP elevation map (33 ft resolution).
          </p>
          <Formula>{`slope_ratio = average slope in 330 ft ring / average slope in 1,300 ft ring
is_artificially_flat = background slope > 1° AND ratio < 0.4`}</Formula>
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Slope ratio</th>
                  <th className="px-3 py-2 text-center font-medium">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr><td className="px-4 py-2">Below 0.25 (extreme grading)</td><td className="px-3 py-2 text-center font-mono">100</td></tr>
                <tr><td className="px-4 py-2">Below 0.4</td><td className="px-3 py-2 text-center font-mono">70</td></tr>
                <tr><td className="px-4 py-2">Below 0.6</td><td className="px-3 py-2 text-center font-mono">40</td></tr>
                <tr><td className="px-4 py-2">Below 0.8</td><td className="px-3 py-2 text-center font-mono">15</td></tr>
                <tr><td className="px-4 py-2">No artificial flatness detected</td><td className="px-3 py-2 text-center font-mono">0</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">score_terrain.py</code>
          </p>
        </Section>

        {/* 8 · Inactivity */}
        <Section id="inactivity" title="8 · Inactivity — 20%">
          <p>
            The longer a well has been inactive (no recorded production), the more likely it's an orphan candidate
            needing plugging. This score measures years since the well last produced oil or gas, using production
            records or the well's completion date as a fallback.
          </p>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">backfill_production_years.py</code>
          </p>
          <Formula>{`inactivity_score = function of years_inactive
  0 for currently producing (with recent production)
  Increases toward 100 as years without production rise`}</Formula>
          <p className="text-xs text-gray-300 mt-3">
            <strong>Reporting lag adjustment:</strong> Oil and gas production reports arrive 12–18 months late. A well
            that was actually producing in late 2024 may appear inactive in mid-2026 purely because 2025 data isn't in
            yet. To absorb this lag, wells with recorded production within the last 2 years score 0 for inactivity,
            even if technically inactive-looking in the current snapshot.
          </p>
          <p className="text-xs text-gray-300">
            Old wells with no production record and no plug date are assumed to have been abandoned decades ago and score high
            for inactivity (typically 80–100).
          </p>
          <p className="text-xs text-gray-500">
            Source: <code className="text-gray-400">backfill_production_years.py</code>
          </p>
        </Section>

        {/* 9 · Flags */}
        <Section id="flags" title="9 · Auxiliary flags">
          <p>
            In addition to the six scored dimensions, the map exposes binary flags that can be used
            to filter and explore wells. Flags are not part of the composite score — they are independent signals
            for diving deeper into specific hypotheses.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <p className="font-semibold text-white mb-1">Clustered (≥ 2 neighbors)</p>
              <p className="text-xs text-gray-300">
                Well has 2 or more other wells very close by (within 100 ft) — typical of old infill drilling campaigns
                or modern multi-lateral (side-by-side) well pads.
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

        {/* 10 · Scoring policies */}
        <Section id="policies" title="10 · Scoring policies">
          <p>
            In addition to the six scored dimensions, two policy rules shape the final priority tier.
          </p>

          <h3 className="text-sm font-semibold text-white mt-4">1. Historic-owner floor</h3>
          <p className="text-xs text-gray-300">
            When RBDMS lists "HISTORIC OWNER" (the original owner is lost to time), the well is presumed orphaned.
            These wells are floored to <Pill color="#eab308">medium</Pill> priority even if their raw composite score falls below 25.
            This recognizes that orphan candidates with zero remote-sensing signals (vegetation, emissions, terrain) would
            otherwise sink into the green-dot pool. However, wells with a composite of 35+ still bucket to <Pill color="#f97316">high</Pill> or
            <Pill color="#ef4444">critical</Pill>, following their natural score.
          </p>

          <h3 className="text-sm font-semibold text-white mt-6">2. Operator status is informational</h3>
          <p className="text-xs text-gray-300">
            The database tracks whether a well has a named operator on file. This is useful for filtering
            (the "Orphans only" flag excludes wells with active named operators) but does <strong>not</strong> cap
            priority. A producing well with a high composite score stays high or critical, because high environmental risk
            exists regardless of who is nominally on the operator line.
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
                  <td className="px-3 py-2 text-center text-gray-300">Any priority by score</td>
                </tr>
                <tr>
                  <td className="px-4 py-2"><code className="text-gray-400">historic_owner</code></td>
                  <td className="px-4 py-2">RBDMS lists "HISTORIC OWNER"</td>
                  <td className="px-3 py-2 text-center text-green-400">Yes (floored to medium)</td>
                </tr>
                <tr>
                  <td className="px-4 py-2"><code className="text-gray-400">orphan_program</code></td>
                  <td className="px-4 py-2">Enrolled in Ohio Orphan Well Program</td>
                  <td className="px-3 py-2 text-center text-green-400">Yes</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        {/* 11 · Caveats */}
        <Section id="caveats" title="11 · Known caveats">
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
              <p className="font-semibold text-white mb-1">Vegetation coverage is partial.</p>
              <p className="text-xs text-gray-400">
                Only ≈ 5,000 of the ~104,000 scored wells have been analyzed by the Sentinel-2
                satellite vegetation pipeline so far. Wells without vegetation data are excluded from that factor
                (they don't get penalized — the composite just normalizes without it). The "Vegetation loss" filter
                therefore only matches a small subset of wells with confirmed detection.
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
              <p className="font-semibold text-white mb-1">Aircraft flyovers have limited coverage.</p>
              <p className="text-xs text-gray-400">
                CarbonMapper and MethaneAIR detections come from aircraft campaigns that cover Ohio intermittently.
                A well with no detected plume nearby may still be leaking — it just hasn&apos;t been overflown yet,
                or its leak rate is below the detection threshold (typically ~10–50 kg/hr methane). Thermal imagery
                (Landsat 9) covers every well but only detects heat anomalies from active venting, not slow leaks.
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
        <p>Methodology last reviewed 2026-05. Scoring scripts live in the Oil_Well_Scripts repository.</p>
      </footer>
    </div>
  );
}
