'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Grouped nav — primary data exploration · analysis · meta · states.
// Visual gap between groups is rendered with a spacer div below.
const NAV_GROUPS: { href: string; label: string }[][] = [
  [
    { href: '/',          label: 'Map' },
    { href: '/table',     label: 'Table' },
    { href: '/counties',  label: 'Counties' },
    { href: '/operators', label: 'Operators' },
    { href: '/anomalies', label: 'Anomalies' },
  ],
  [
    { href: '/facts',    label: 'Facts' },
    { href: '/stranded', label: 'Stranded' },
  ],
  [
    { href: '/methodology', label: 'Methodology' },
    { href: '/about',       label: 'About' },
  ],
];

interface Props {
  /**
   * Optional page title — rendered as a breadcrumb-style second label after the brand.
   * Omit on the home page if the map itself is the primary context.
   */
  title?: string;
  /**
   * Optional small subtitle under the title (e.g. "37 matching of 855").
   */
  subtitle?: string;
  /**
   * Slot on the left side of the nav for page-specific status text
   * (e.g. filter counts, timestamps).
   */
  leftExtra?: React.ReactNode;
  /**
   * Slot on the right side of the nav for page-specific buttons
   * (e.g. Excel export on /table, Print to PDF on county brief).
   */
  rightExtra?: React.ReactNode;
  /**
   * Whether the header should stick to the top of the viewport on scroll.
   * On long scrollable pages (/about, /methodology, /counties/[county]) → true.
   * On full-viewport pages (/, /table, /counties) → false.
   */
  sticky?: boolean;
}

export default function SiteHeader({ title, subtitle, leftExtra, rightExtra, sticky = false }: Props) {
  const pathname = usePathname() ?? '/';

  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/';
    // Treat /counties and /counties/HOCKING as both active for the "Counties" link.
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <header
      className={`${sticky ? 'sticky top-0 z-20' : ''} flex items-center justify-between gap-4 px-5 py-2.5 bg-gray-900/95 backdrop-blur border-b border-gray-800 shrink-0 print:hidden`}
    >
      {/* ── Brand + title + left extras ─────────────────────────────── */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 group"
          aria-label="Ohio Well Risk — home"
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" aria-hidden />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" aria-hidden />
          </span>
          <span className="text-sm font-semibold tracking-tight text-white group-hover:text-red-200 transition-colors whitespace-nowrap">
            OH Well Risk
          </span>
        </Link>

        {title && (
          <>
            <span className="text-gray-700 shrink-0" aria-hidden>/</span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-200 truncate" title={title}>{title}</div>
              {subtitle && <div className="text-[10px] text-gray-500 truncate">{subtitle}</div>}
            </div>
          </>
        )}

        {leftExtra && <div className="ml-2 min-w-0 flex items-center text-xs text-gray-500">{leftExtra}</div>}
      </div>

      {/* ── Nav links (grouped) + right extras ──────────────────────── */}
      <nav className="flex items-center gap-1 shrink-0">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className="flex items-center gap-0.5">
            {gi > 0 && <span className="mx-1.5 h-4 w-px bg-gray-800" aria-hidden />}
            {group.map(link => {
              const active = isActive(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-xs px-2 py-1 rounded transition-colors select-none whitespace-nowrap ${
                    active
                      ? 'text-white bg-gray-800 font-semibold'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        ))}

        {rightExtra && (
          <>
            <span className="mx-2 h-4 w-px bg-gray-800" aria-hidden />
            <div className="flex items-center gap-2">{rightExtra}</div>
          </>
        )}
      </nav>
    </header>
  );
}
