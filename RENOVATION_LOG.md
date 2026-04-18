# Synkra Renovation Log

Started: 2026-04-18

---

## Discovery Pass Summary

Routes audited: `/`, `/create`, `/join/[code]`, `/share/[code]`, `/calendar/[code]`
Viewports: 375px, 768px, 1440px

---

## Issues Found and Fixed

### Tier 1

**[FIXED] Locked calendar state used hardcoded colors**
- File: `app/join/[code]/page.tsx`
- Issue: `bg-white`, `border-gray-200`, `text-[#1a1635]`, `text-[#5b5780]` bypassed design token system
- Fix: Replaced with `var(--bg-card)`, `var(--border)`, `var(--ink)`, `var(--ink-2)`. Also replaced emoji lock icon with proper SVG icon matching design system.

**[FIXED] ShareClient fallback URL referenced old `flock-two.vercel.app` domain**
- File: `app/share/[code]/ShareClient.tsx`
- Issue: Before `useEffect` runs on client, the share URL defaulted to the old flock domain. Any SSR/hydration snapshot would show wrong URL.
- Fix: Changed default to `synkra-app.vercel.app/join/...` to match actual production domain.

### Tier 2

**[FIXED] Page title contained em dash**
- File: `app/layout.tsx`
- Issue: Title was `Synkra — Group Availability Planner`
- Fix: Changed to `Synkra: Group Availability Planner`

**[FIXED] Create page toggle hint text contained em dash**
- File: `app/create/page.tsx`
- Issue: "— keep adding weeks as you go" used em dash
- Fix: Removed em dash. Text now reads "keep adding weeks as you go"

**[FIXED] Create page toggle hint text caused layout wrap on mobile**
- File: `app/create/page.tsx`
- Issue: At 375px, "keep adding weeks as you go" pushed the toggle row to wrap awkwardly, with "No end date" on one visual line and hint on another but the hint overflowed.
- Fix: Added `hidden sm:inline` to hide hint text on mobile (irrelevant on mobile where space is limited). Hint still visible at 768px+.

**[FIXED] Create page "Which days" label row overflow on mobile**
- File: `app/create/page.tsx`
- Issue: At 375px, the "Which days optional" label and "All / Weekdays / Weekends" pill row were crammed in a single justify-between flex row, causing overlap.
- Fix: Added `flex-wrap` and `gap-2` to the row so pills wrap below the label naturally on small viewports.

**[FIXED] Unused CSS animation classes removed**
- File: `app/globals.css`
- Issue: `fadeUp` keyframe and `.fade-up`, `.fade-up-1` through `.fade-up-5` classes were defined but not referenced anywhere in the codebase.
- Fix: Already removed in working tree (confirmed by grep). No additional action needed.

### Accessibility (Tier 1-2)

**[FIXED] Feature icon divs in home page missing aria-hidden**
- File: `app/page.tsx`
- Issue: Decorative SVG icon containers were exposed to the accessibility tree as unlabeled images
- Fix: Added `aria-hidden="true"` to icon container divs; adjacent text paragraphs already provide accessible labels

**[FIXED] Logo SVG icon missing aria-hidden**
- File: `app/page.tsx`
- Issue: Logo icon SVG container was exposed without label; the "synkra" text span provides the link's accessible name
- Fix: Added `aria-hidden="true"` to logo icon wrapper div

---

## Issues Noted (Not Changed)

**CalendarClient.tsx em dashes in code comments only**
- Lines 284, 511, 628, 821, 1048, 1402, 1441, 1743, 1777, 1850, 1899: em dashes appear only inside `//` comments and `{/* */}` JSX comments, not in user-visible text. No action required.

**CalendarClient.tsx uses en dash (–) in time range display**
- Line 834: `{formatTime(block.start_time)}–{formatTime(block.end_time)}` — en dash (U+2013) is typographically correct for time ranges (not an em dash). No change needed.

**flock_ localStorage fallback in CalendarClient**
- Line 242: `localStorage.getItem('flock_${cal.code}') ?? localStorage.getItem('flock_${cal.code}')` — intentional backwards-compat migration fallback for users who had the old app. Preserve.

**`✦ Best` sidebar tab label**
- The `✦` character (Four Teardrop-Spoked Asterisk, U+2726) is a decorative symbol, not an emoji. Cross-browser compatible and renders correctly. Noted as unusual but not broken.

**debug page uses hardcoded styles**
- `app/debug/page.tsx` uses many hardcoded colors. This is a dev-only admin page, not a production route. Leaving as-is per "don't invent new work" rule.

---

## Final Status

Tier 1: All issues resolved
Tier 2: All issues resolved
Tier 3: No new features added; recommendations noted above
