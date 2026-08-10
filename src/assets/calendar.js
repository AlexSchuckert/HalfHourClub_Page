/* Month-view calendar with a blue dot on days a half hour club happened.
 *
 * Data comes from an inline <script type="application/json"> in the page, not
 * from a fetched file — see the comment in src/index.njk. Shape:
 *
 *   { "YYYY-MM-DD": [{ title: "…", url: "/clubs/…/" }] }
 *
 * (Kept deliberately generic: no real club text belongs in this repo, so that
 * grepping the published output for a club's words finds nothing.)
 *
 * Clicking a dotted day goes straight to that club. If a day holds more than
 * one, the calendar shows a small chooser underneath instead of guessing.
 */
(function () {
  const root = document.getElementById('calendar');
  const dataElement = document.getElementById('calendar-data');
  if (!root || !dataElement) return;

  let days = {};
  try {
    days = JSON.parse(dataElement.textContent) || {};
  } catch (error) {
    console.error('Calendar data could not be read', error);
    return;
  }

  const monthLabel = root.querySelector('[data-calendar-month]');
  const grid = root.querySelector('[data-calendar-grid]');
  const choices = root.querySelector('[data-calendar-choices]');
  const prevButton = root.querySelector('[data-calendar-prev]');
  const nextButton = root.querySelector('[data-calendar-next]');

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const pad = (n) => String(n).padStart(2, '0');
  const key = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;

  const clubMonths = Object.keys(days)
    .map((date) => date.slice(0, 7))
    .sort();
  const firstMonth = clubMonths[0] ?? null;
  const lastMonth = clubMonths[clubMonths.length - 1] ?? null;

  const today = new Date();
  const todayKey = key(today.getFullYear(), today.getMonth(), today.getDate());

  /* Open on the month of the most recent club, falling back to today — so the
     page lands somewhere with content rather than on an empty month. */
  const startMonth = root.dataset.latestMonth || todayKey.slice(0, 7);
  let year = Number(startMonth.slice(0, 4));
  let month = Number(startMonth.slice(5, 7)) - 1;

  function monthName(y, m) {
    return new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  function makeDay(className, label) {
    const cell = document.createElement(className === 'calendar__day--empty' ? 'div' : 'button');
    if (cell.tagName === 'BUTTON') cell.type = 'button';
    cell.className = `calendar__day ${className}`.trim();
    if (label !== undefined) cell.append(document.createTextNode(String(label)));
    return cell;
  }

  function showChoices(clubsOnDay, dateKey) {
    choices.textContent = '';
    const heading = document.createElement('p');
    heading.className = 'calendar__empty';
    heading.textContent = `${clubsOnDay.length} clubs on this day — pick one:`;
    if (clubsOnDay.length > 1) choices.append(heading);
    for (const club of clubsOnDay) {
      const link = document.createElement('a');
      link.className = 'calendar__choice';
      link.href = club.url;
      link.textContent = club.title;
      choices.append(link);
    }
  }

  function render() {
    monthLabel.textContent = monthName(year, month);
    grid.textContent = '';
    choices.textContent = '';

    for (const weekday of WEEKDAYS) {
      const head = document.createElement('div');
      head.className = 'calendar__weekday';
      head.textContent = weekday;
      grid.append(head);
    }

    /* getUTCDay() is 0 for Sunday; the grid starts on Monday. */
    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const leadingBlanks = (firstOfMonth.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    for (let i = 0; i < leadingBlanks; i += 1) {
      grid.append(makeDay('calendar__day--empty'));
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = key(year, month, day);
      const clubsOnDay = days[dateKey];
      const cell = makeDay(clubsOnDay ? 'calendar__day--has-club' : '', day);

      if (dateKey === todayKey) cell.classList.add('calendar__day--today');

      if (clubsOnDay) {
        const dot = document.createElement('span');
        dot.className = 'calendar__dot';
        cell.append(dot);
        cell.setAttribute(
          'aria-label',
          `${day} ${monthName(year, month)} — ${clubsOnDay.map((c) => c.title).join(', ')}`
        );
        cell.addEventListener('click', () => {
          if (clubsOnDay.length === 1) {
            window.location.href = clubsOnDay[0].url;
          } else {
            showChoices(clubsOnDay, dateKey);
          }
        });
      } else {
        cell.disabled = true;
      }

      grid.append(cell);
    }

    /* Don't let anyone wander off into empty years in either direction. */
    const current = `${year}-${pad(month + 1)}`;
    prevButton.disabled = !firstMonth || current <= firstMonth;
    nextButton.disabled = !lastMonth || current >= lastMonth;
  }

  function shift(delta) {
    month += delta;
    if (month < 0) {
      month = 11;
      year -= 1;
    } else if (month > 11) {
      month = 0;
      year += 1;
    }
    render();
  }

  prevButton.addEventListener('click', () => shift(-1));
  nextButton.addEventListener('click', () => shift(1));

  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' && !prevButton.disabled) {
      shift(-1);
      event.preventDefault();
    }
    if (event.key === 'ArrowRight' && !nextButton.disabled) {
      shift(1);
      event.preventDefault();
    }
  });

  render();
})();
