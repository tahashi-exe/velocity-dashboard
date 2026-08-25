/* ---------- v2 prototype: calendar grid ----------
   PRD.md §4.9 — day boxes showing runs per day. Shared by Variant A (behind
   a toggle) and Variant B (the primary view), since the two variants differ
   in *where this lives*, not in what a day cell contains.
   Recurring runs render on every matching weekday in the visible range —
   the concrete expression of "permanent weekly slot" (PRD.md §4.6). */

const Calendar = (() => {
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

  function miniCardHtml(run) {
    const visual = Velocity.pinVisual(run);
    const rsvp = Velocity.getRsvp(run.id);
    const highlighted = rsvp === 'going' || rsvp === 'interested';
    return `
      <button type="button" class="cal-card${highlighted ? ' cal-card-highlight' : ''}" data-run-id="${run.id}">
        <span class="cal-dot color-${visual.base}${visual.ring ? ' has-ring' : ''}"></span>
        <span class="cal-card-name">${run.name}</span>
        <span class="cal-card-time">${Velocity.formatTime(run.time)}</span>
      </button>
    `;
  }

  // Returns a DOM node: a scrollable row of day columns (week) or a wrapped
  // grid of week-rows (month) — a rolling N-day window either way, not a
  // Jan/Feb calendar-month grid, to match the This Week/Month scope filter.
  function buildGrid(runs, scope, onSelectRun) {
    const days = visibleDays(scope);
    const el = document.createElement('div');
    el.className = `cal-grid cal-grid-${scope}`;
    el.innerHTML = days.map(day => {
      const dayRuns = runsForDay(runs, day);
      const isToday = dateKey(day) === dateKey(new Date());
      return `
        <div class="cal-day${isToday ? ' cal-day-today' : ''}">
          <div class="cal-day-header">
            <span class="cal-day-name">${day.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
            <span class="cal-day-num">${day.getDate()}</span>
          </div>
          <div class="cal-day-body">
            ${dayRuns.length ? dayRuns.map(miniCardHtml).join('') : '<div class="cal-day-empty">—</div>'}
          </div>
        </div>
      `;
    }).join('');

    el.querySelectorAll('.cal-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const run = runs.find(r => r.id === btn.dataset.runId);
        if (run) onSelectRun(run);
      });
    });
    return el;
  }

  // A week-at-a-glance density rail: one chip per day, bar height ~ run count.
  function buildWeekRail(runs) {
    const days = visibleDays('week');
    const counts = days.map(d => runsForDay(runs, d).length);
    const max = Math.max(1, ...counts);
    const el = document.createElement('div');
    el.className = 'week-rail';
    el.innerHTML = days.map((d, i) => `
      <div class="day-chip${dateKey(d) === dateKey(new Date()) ? ' day-chip-today' : ''}">
        <div class="day-chip-bar" style="height:${8 + (counts[i] / max) * 28}px"></div>
        <div class="day-chip-label">${d.toLocaleDateString('en-GB', { weekday: 'narrow' })}</div>
      </div>
    `).join('');
    return el;
  }

  return { buildGrid, buildWeekRail, visibleDays, runsForDay };
})();
