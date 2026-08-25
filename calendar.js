/* ---------- v2 prototype: calendar grid ----------
   PRD.md §4.9 — day boxes showing runs per day, opened from Variant A's
   narrow side panel (always rendered "compact"). Redesigned per
   calendar.webp: vertically stacked day bands in a deterministic
   per-weekday pastel palette, big bold date numerals, and runs as dark
   pill chips — replacing the earlier horizontal grid of small bordered
   tiles.
   Recurring runs render on every matching weekday in the visible range —
   the concrete expression of "permanent weekly slot" (PRD.md §4.6). */

const Calendar = (() => {
  // One fixed color per weekday (not random) so the palette reads as a
  // designed system across weeks, matching the reference image's approach.
  const DAY_PALETTE = [
    { bg: '#F3EFD9', text: '#7A6A1D' }, // sunday — sand
    { bg: '#E7E1FB', text: '#4C3B9E' }, // monday — lavender
    { bg: '#F7DEE3', text: '#9C3B57' }, // tuesday — dusty rose
    { bg: '#DCEFE8', text: '#1F6B57' }, // wednesday — sage
    { bg: '#DCE6FA', text: '#33518E' }, // thursday — periwinkle
    { bg: '#FBE7D3', text: '#9C5A1F' }, // friday — apricot
    { bg: '#DFF2E1', text: '#2C7A3D' }, // saturday — mint
  ];

  function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  function visibleDays(scope) {
    const days = scope === 'month' ? 31 : 7;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      return d;
    });
  }

  function runsForDay(runs, day) {
    const key = dateKey(day);
    const weekday = Velocity.DAYS[day.getDay()];
    return runs.filter(r => {
      if (r.kind === 'one_off') return r.event_date === key;
      return r.day_of_week === weekday;
    });
  }

  function chipHtml(run) {
    const visual = Velocity.pinVisual(run);
    const rsvp = Velocity.getRsvp(run.id);
    const highlighted = rsvp === 'going' || rsvp === 'interested';
    return `
      <button type="button" class="cal-chip${highlighted ? ' cal-chip-highlight' : ''}" data-run-id="${run.id}">
        <span class="cal-chip-dot color-${visual.base}${visual.ring ? ' has-ring' : ''}"></span>
        <span class="cal-chip-name">${run.name}</span>
        <span class="cal-chip-time">${Velocity.formatTime(run.time)}</span>
      </button>
    `;
  }

  function bandHtml(day, dayRuns, compact) {
    const pal = DAY_PALETTE[day.getDay()];
    const isToday = dateKey(day) === dateKey(new Date());
    const dayName = day.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();

    if (!dayRuns.length) {
      return `
        <div class="cal-band cal-band-empty${isToday ? ' cal-band-today' : ''}">
          <span class="cal-band-empty-date">${dayName} ${day.getDate()}</span>
          <span class="cal-band-empty-text">No runs</span>
        </div>
      `;
    }

    return `
      <div class="cal-band${compact ? ' cal-band-compact' : ''}${isToday ? ' cal-band-today' : ''}" style="background:${pal.bg};color:${pal.text}">
        <div class="cal-band-date">
          <span class="cal-band-dayname">${dayName}</span>
          <span class="cal-band-num">${day.getDate()}</span>
        </div>
        <div class="cal-band-chips">
          ${dayRuns.map(chipHtml).join('')}
        </div>
      </div>
    `;
  }

  // Returns a DOM node: vertically stacked day bands over a rolling N-day
  // window (not a Jan/Feb calendar-month grid) to match the This Week/Month
  // scope filter. `compact` narrows the layout for Variant A's side panel.
  function buildGrid(runs, scope, onSelectRun, compact) {
    const days = visibleDays(scope);
    const el = document.createElement('div');
    el.className = `cal-stack${compact ? ' cal-stack-compact' : ''}`;
    el.innerHTML = days.map(day => bandHtml(day, runsForDay(runs, day), compact)).join('');

    el.querySelectorAll('.cal-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const run = runs.find(r => r.id === btn.dataset.runId);
        if (run) onSelectRun(run);
      });
    });
    return el;
  }

  return { buildGrid, visibleDays, runsForDay };
})();
