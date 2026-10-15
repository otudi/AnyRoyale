/**
 * AnyRoyale brand graphics, drawn in code (see docs/BRAND.md): the crest logo, the wordmark, the
 * menu backdrop and the brand glyphs. All SVG, so they stay crisp at any size and need no files.
 */

let uid = 0;

/**
 * The crest: a shield split into the two team colours under a gold rim and crown, with an "A"
 * monogram whose crossbar is a sword guard.
 */
export function crest(size = 120, cls = ''): string {
  const k = `cr${++uid}`;
  const shield = 'M60 22C79 22 97 25 106 31V66C106 96 86 116 60 128C34 116 14 96 14 66V31C23 25 41 22 60 22Z';
  return `<svg class="crest ${cls}" width="${size}" height="${Math.round(size * 1.1)}" viewBox="0 0 120 132" aria-hidden="true">
  <defs>
    <linearGradient id="${k}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a3"/><stop offset=".45" stop-color="#ffc23d"/><stop offset="1" stop-color="#c9800e"/></linearGradient>
    <linearGradient id="${k}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5aa2ff"/><stop offset="1" stop-color="#1f4fc0"/></linearGradient>
    <linearGradient id="${k}r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b74"/><stop offset="1" stop-color="#b8212e"/></linearGradient>
    <clipPath id="${k}c"><path d="${shield}"/></clipPath>
  </defs>
  <path d="${shield}" fill="#0b1030" stroke="#0b1030" stroke-width="14" stroke-linejoin="round"/>
  <g clip-path="url(#${k}c)">
    <rect x="0" y="0" width="120" height="132" fill="url(#${k}r)"/>
    <path d="M0 0H84L36 132H0Z" fill="url(#${k}b)"/>
    <path d="M84 0L36 132" stroke="#0b1030" stroke-opacity=".35" stroke-width="3"/>
    <path d="M14 22H106V40C80 34 40 34 14 40Z" fill="#fff" opacity=".16"/>
  </g>
  <path d="${shield}" fill="none" stroke="url(#${k}g)" stroke-width="7" stroke-linejoin="round"/>
  <path d="M60 44L84 104H71.5L67.4 93H52.6L48.5 104H36ZM60 64L55.6 81H64.4Z" fill="#fff6e0" fill-rule="evenodd" stroke="#0b1030" stroke-width="4" stroke-linejoin="round" paint-order="stroke"/>
  <rect x="38" y="80" width="44" height="7" rx="3.5" fill="url(#${k}g)" stroke="#0b1030" stroke-width="2.5"/>
  <circle cx="38" cy="83.5" r="4.5" fill="url(#${k}g)" stroke="#0b1030" stroke-width="2.5"/>
  <circle cx="82" cy="83.5" r="4.5" fill="url(#${k}g)" stroke="#0b1030" stroke-width="2.5"/>
  <path d="M33 30L36 6L48 17L60 0L72 17L84 6L87 30Z" fill="url(#${k}g)" stroke="#0b1030" stroke-width="4" stroke-linejoin="round"/>
  <circle cx="60" cy="20" r="4" fill="#ff4d5a" stroke="#0b1030" stroke-width="2"/>
  <circle cx="45" cy="23" r="3" fill="#3d8bff" stroke="#0b1030" stroke-width="2"/>
  <circle cx="75" cy="23" r="3" fill="#3d8bff" stroke="#0b1030" stroke-width="2"/>
</svg>`;
}

/** "AnyRoyale" in gold with a navy outline and drop (SVG text keeps the outline clean). */
export function wordmark(width = 260): string {
  const k = `wm${++uid}`;
  return `<svg class="wordmark" width="${width}" height="${Math.round(width * 0.27)}" viewBox="0 0 300 80" role="img" aria-label="AnyRoyale">
  <defs><linearGradient id="${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#ffc23d"/><stop offset="1" stop-color="#e2900f"/></linearGradient></defs>
  <g font-family="'Baloo Bhaijaan 2', system-ui, sans-serif" font-weight="800" font-size="58" text-anchor="middle" direction="ltr">
    <text x="150" y="61" fill="#0b1030" stroke="#0b1030" stroke-width="10" stroke-linejoin="round">AnyRoyale</text>
    <text x="150" y="56" fill="url(#${k})" stroke="#0b1030" stroke-width="7" stroke-linejoin="round" paint-order="stroke">AnyRoyale</text>
  </g>
</svg>`;
}

/**
 * The menu backdrop: night (or day) sky, distant hills and the two castles with their team
 * banners. Colours come from CSS variables so the same scene serves both themes.
 */
export function backdrop(): string {
  const stars = [
    [40, 60, 1.4], [92, 120, 1], [150, 40, 1.2], [214, 92, 1.6], [270, 50, 1], [330, 110, 1.3], [370, 30, 1],
    [60, 190, 1], [300, 200, 1.2], [180, 160, 0.9], [120, 240, 1], [350, 260, 1.1], [24, 300, 0.9],
  ]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`)
    .join('');
  const castle = (x: number, flip: boolean, team: 'blue' | 'red') => {
    const s = flip ? -1 : 1;
    return `<g transform="translate(${x} 0) scale(${s} 1)">
      <path class="bd-castle" d="M-70 1010V650h14v-14h12v14h14v-14h12v14h14V620h-6v-12h10v-14h10v14h10v12h-6v30h14v-14h12v14h14v-14h12v14h14v360Z"/>
      <path class="bd-castle" d="M-20 600V540l-8-8 22-30 22 30-8 8v60Z"/>
      <rect class="bd-window" x="-12" y="560" width="8" height="14" rx="4"/>
      <rect class="bd-window" x="-48" y="700" width="8" height="14" rx="4"/>
      <rect class="bd-window" x="30" y="700" width="8" height="14" rx="4"/>
      <path d="M-6 500V462" class="bd-pole"/>
      <path class="bd-banner ${team}" d="M-6 464h30l-7 9 7 9h-30Z"/>
    </g>`;
  };
  return `<svg class="mm-backdrop" viewBox="0 0 400 860" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs>
    <linearGradient id="bdsky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:var(--bd-sky-top)"/><stop offset=".65" style="stop-color:var(--bd-sky-mid)"/><stop offset="1" style="stop-color:var(--bd-sky-low)"/>
    </linearGradient>
    <radialGradient id="bdglow" cx=".5" cy=".3" r=".55"><stop offset="0" style="stop-color:var(--bd-glow)"/><stop offset="1" style="stop-color:var(--bd-glow)" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="400" height="860" fill="url(#bdsky)"/>
  <rect width="400" height="860" fill="url(#bdglow)"/>
  <g class="bd-stars">${stars}</g>
  <path class="bd-far" d="M0 690C60 640 110 660 160 630S260 600 300 640 370 650 400 620V860H0Z"/>
  <path class="bd-mid" d="M0 740C70 700 130 720 200 700S320 690 400 720V860H0Z"/>
  <g transform="translate(0 -170)">${castle(64, false, 'blue')}${castle(336, true, 'red')}</g>
  <path class="bd-ground" d="M0 800C100 780 300 780 400 800V860H0Z"/>
</svg>`;
}

/** Brand glyphs (inherit the text colour). */
export const glyph = {
  swords: `<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><g fill="currentColor" stroke="#0b1030" stroke-width="2.5" stroke-linejoin="round"><path d="M8 4l4 0 22 22-4 4L8 8z"/><path d="M40 4l-4 0-22 22 4 4L40 8z"/><path d="M10 30l8 8-3 3-3-3-4 4-3-3 4-4-3-3z"/><path d="M38 30l-8 8 3 3 3-3 4 4 3-3-4-4 3-3z"/></g></svg>`,
  crown: `<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M6 36L4 12l11 9 9-15 9 15 11-9-2 24z" fill="currentColor" stroke="#0b1030" stroke-width="2.5" stroke-linejoin="round"/><rect x="6" y="36" width="36" height="6" rx="2" fill="currentColor" stroke="#0b1030" stroke-width="2.5"/></svg>`,
  shield: `<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4c8 0 15 2 18 4v14c0 12-8 19-18 24C14 41 6 34 6 22V8c3-2 10-4 18-4z" fill="currentColor" stroke="#0b1030" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  deck: `<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><g stroke="#0b1030" stroke-width="2.5" stroke-linejoin="round"><rect x="6" y="10" width="22" height="30" rx="4" transform="rotate(-12 17 25)" fill="currentColor" opacity=".7"/><rect x="18" y="8" width="22" height="30" rx="4" transform="rotate(8 29 23)" fill="currentColor"/></g></svg>`,
  target: `<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="5"><circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="8"/></g><circle cx="24" cy="24" r="3" fill="currentColor"/></svg>`,
};
