const scheduleState = { baseline: [], results: [], compared: [], shown: 25, cancelled: false, run: 0 };
const scheduleElement = selector => document.querySelector(selector);
const scheduleEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const dayOrder = 'MTWRFSU';
const scheduleStorageKey = 'asb-existing-schedule';
const preferenceStorageKey = 'asb-schedule-preferences';

function parseClock(value) {
  if (value == null) return null;
  const text = String(value).trim().toUpperCase();
  const match = text.match(/^(\d{1,2}):?(\d{2})(?::\d{2})?\s*(AM|PM)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    if (match[3] === 'AM') hour %= 12;
    else if (hour !== 12) hour += 12;
  } else if (hour > 23) return null;
  return hour * 60 + minute;
}

function displayClock(minutes) {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour = hour24 % 12 || 12;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function normalizeDays(value) {
  const codes = {
    MONDAY: 'M', MON: 'M', MO: 'M', TUESDAY: 'T', TUE: 'T', TU: 'T',
    WEDNESDAY: 'W', WED: 'W', WE: 'W', THURSDAY: 'R', THU: 'R', TH: 'R',
    FRIDAY: 'F', FRI: 'F', FR: 'F', SATURDAY: 'S', SAT: 'S', SA: 'S',
    SUNDAY: 'U', SUN: 'U', SU: 'U', M: 'M', T: 'T', W: 'W', R: 'R', F: 'F', S: 'S', U: 'U'
  };
  const tokens = String(value || '').toUpperCase().match(/MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY|MON|TUE|WED|THU|FRI|SAT|SUN|MO|TU|WE|TH|FR|SA|SU|[MTWRFSU]/g) || [];
  return [...new Set(tokens.map(token => codes[token]).filter(Boolean))].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b)).join('');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(value.trim()); value = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(value.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = []; value = '';
    } else {
      value += character;
    }
  }
  if (quoted) throw Error('CSV has an unfinished quoted value.');
  row.push(value.trim());
  if (row.some(cell => cell !== '')) rows.push(row);
  return rows;
}

function csvBlocks(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw Error('No schedule rows were found.');
  const header = rows[0].map(cell => cell.toLowerCase().replace(/[_-]+/g, ' ').trim());
  const headerIndex = names => header.findIndex(cell => names.includes(cell));
  const hasHeader = header.some(cell => ['days', 'day', 'start', 'start time', 'begin', 'end', 'end time'].includes(cell));
  const columns = hasHeader ? {
    name: headerIndex(['course', 'class', 'name', 'title', 'description']),
    days: headerIndex(['days', 'day', 'weekday']),
    start: headerIndex(['start', 'start time', 'begin', 'begin time']),
    end: headerIndex(['end', 'end time', 'finish']),
    building: headerIndex(['building', 'location', 'room'])
  } : { name: 0, days: 1, start: 2, end: 3, building: 4 };
  if (columns.days < 0 || columns.start < 0 || columns.end < 0) {
    throw Error('CSV needs day, start, and end columns. Optional columns are course and building.');
  }
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const blocks = dataRows.map((cells, index) => {
    const days = normalizeDays(cells[columns.days]);
    const start = parseClock(cells[columns.start]);
    const end = parseClock(cells[columns.end]);
    if (!days || start == null || end == null || end <= start) {
      throw Error(`Schedule row ${index + (hasHeader ? 2 : 1)} needs valid days and a start/end time.`);
    }
    return {
      name: columns.name >= 0 ? (cells[columns.name] || 'Imported class') : 'Imported class',
      days, start, end,
      building: columns.building >= 0 ? (cells[columns.building] || '') : ''
    };
  });
  if (!blocks.length) throw Error('No schedule rows were found after the CSV header.');
  return { blocks, skipped: 0 };
}

function icsProperty(lines, key) {
  return lines.find(line => line.toUpperCase().startsWith(`${key}:`) || line.toUpperCase().startsWith(`${key};`)) || '';
}

function parseIcsDate(property) {
  if (!property) return null;
  const colon = property.indexOf(':');
  if (colon < 0) return null;
  const parameters = property.slice(0, colon);
  const value = property.slice(colon + 1).trim();
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!match) return null;
  const [, year, month, date, rawHour, rawMinute, , utc] = match;
  const dayIndex = new Date(Date.UTC(Number(year), Number(month) - 1, Number(date))).getUTCDay();
  const weekdays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  let minutes = Number(rawHour) * 60 + Number(rawMinute);
  let day = weekdays[dayIndex];
  if (utc) {
    const instant = new Date(Date.UTC(Number(year), Number(month) - 1, Number(date), Number(rawHour), Number(rawMinute)));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(instant);
    const part = name => parts.find(item => item.type === name)?.value;
    day = ({ Sun: 'SU', Mon: 'MO', Tue: 'TU', Wed: 'WE', Thu: 'TH', Fri: 'FR', Sat: 'SA' })[part('weekday')];
    minutes = Number(part('hour')) * 60 + Number(part('minute'));
  } else if (/TZID=UTC/i.test(parameters)) {
    const instant = new Date(Date.UTC(Number(year), Number(month) - 1, Number(date), Number(rawHour), Number(rawMinute)));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(instant);
    const part = name => parts.find(item => item.type === name)?.value;
    day = ({ Sun: 'SU', Mon: 'MO', Tue: 'TU', Wed: 'WE', Thu: 'TH', Fri: 'FR', Sat: 'SA' })[part('weekday')];
    minutes = Number(part('hour')) * 60 + Number(part('minute'));
  }
  return { day, minutes };
}

function icsBlocks(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const events = unfolded.split(/BEGIN:VEVENT/i).slice(1).map(event => event.split(/END:VEVENT/i)[0]);
  const blocks = [];
  let skipped = 0;
  for (const event of events) {
    const lines = event.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const rule = icsProperty(lines, 'RRULE');
    if (!/FREQ=WEEKLY/i.test(rule)) { skipped++; continue; }
    const start = parseIcsDate(icsProperty(lines, 'DTSTART'));
    const end = parseIcsDate(icsProperty(lines, 'DTEND'));
    if (!start || !end || end.minutes <= start.minutes) { skipped++; continue; }
    const byday = (rule.match(/(?:^|[;:])BYDAY=([^;]+)/i)?.[1] || '')
      .split(',').map(value => value.replace(/^[+-]?\d+/, '').toUpperCase()).filter(Boolean);
    const days = normalizeDays(byday.length ? byday.map(value => ({ MO: 'MON', TU: 'TUE', WE: 'WED', TH: 'THU', FR: 'FRI', SA: 'SAT', SU: 'SUN' })[value] || '').join(' ') : start.day);
    if (!days) { skipped++; continue; }
    const summary = icsProperty(lines, 'SUMMARY');
    const name = summary.includes(':') ? summary.slice(summary.indexOf(':') + 1).replace(/\\,/g, ',').replace(/\\n/gi, ' ').trim() : 'Imported class';
    blocks.push({ name: name || 'Imported class', days, start: start.minutes, end: end.minutes, building: '' });
  }
  if (!blocks.length) throw Error(`No weekly class meetings were found${skipped ? `; skipped ${skipped} non-weekly or unreadable events` : ''}.`);
  return { blocks, skipped };
}

function parseImportedSchedule(text, filename = '') {
  const isIcs = /\.ics$/i.test(filename) || /BEGIN:VCALENDAR/i.test(text);
  return isIcs ? icsBlocks(text) : csvBlocks(text);
}

function baselineFromStorage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(scheduleStorageKey) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(block => block && typeof block.days === 'string' && Number.isInteger(block.start) && Number.isInteger(block.end) && block.end > block.start);
  } catch {
    return [];
  }
}

function saveBaseline(blocks) {
  scheduleState.baseline = blocks;
  localStorage.setItem(scheduleStorageKey, JSON.stringify(blocks));
  renderBaseline();
}

function renderBaseline() {
  const target = scheduleElement('#existing-schedule');
  if (!scheduleState.baseline.length) {
    target.innerHTML = '<p>No existing schedule is stored. The generator will not use a fit constraint.</p>';
    scheduleElement('#existing-schedule-status').textContent = 'Schedule files and typed blocks stay in this browser. They are not sent to the local server.';
    return;
  }
  target.innerHTML = `<p>${scheduleState.baseline.length} weekly meeting blocks stored in this browser.</p><div class="grade-table-wrap"><table><thead><tr><th>Class</th><th>Days</th><th>Time</th><th>Location</th></tr></thead><tbody>${scheduleState.baseline.map(block => `<tr><td>${scheduleEscape(block.name)}</td><td>${scheduleEscape(block.days)}</td><td>${displayClock(block.start)}-${displayClock(block.end)}</td><td>${scheduleEscape(block.building || 'Not listed')}</td></tr>`).join('')}</tbody></table></div>`;
  scheduleElement('#existing-schedule-status').textContent = 'Existing schedule blocks are stored only in browser local storage and are applied as fit constraints.';
}

function loadPreferences() {
  try {
    const preferences = JSON.parse(localStorage.getItem(preferenceStorageKey) || '{}');
    if (preferences.start) scheduleElement('#preferred-start').value = preferences.start;
    if (preferences.end) scheduleElement('#preferred-end').value = preferences.end;
  } catch { }
}

function savePreferences() {
  localStorage.setItem(preferenceStorageKey, JSON.stringify({
    start: scheduleElement('#preferred-start').value,
    end: scheduleElement('#preferred-end').value
  }));
}

function parseMeetingBlocks(section) {
  return (section.meetings || []).map(meeting => ({
    days: normalizeDays(meeting.days),
    start: parseClock(meeting.begin),
    end: parseClock(meeting.end),
    building: meeting.building || '',
    room: meeting.room || '',
    type: meeting.type || ''
  })).filter(meeting => meeting.days && meeting.start != null && meeting.end != null && meeting.end > meeting.start);
}

function meetingsOverlap(left, right) {
  if (left.start == null || left.end == null || right.start == null || right.end == null) return false;
  if (left.start >= right.end || right.start >= left.end) return false;
  return [...left.days].some(day => right.days.includes(day));
}

function internallyValid(section) {
  for (let left = 0; left < section.meetings.length; left++) {
    for (let right = left + 1; right < section.meetings.length; right++) {
      if (meetingsOverlap(section.meetings[left], section.meetings[right])) return false;
    }
  }
  return true;
}

function conflictsWith(section, meetings) {
  return section.meetings.some(candidate => meetings.some(existing => meetingsOverlap(candidate, existing)));
}

async function fetchCourseSections(term, code) {
  const match = code.match(/^([A-Z]{2,8})\s+([A-Z0-9]+)$/);
  if (!match) throw Error(`Use subject and course number for ${code}, such as CSCE 482.`);
  const sections = [];
  const pageSize = 250;
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ term, subject: match[1], course: match[2], limit: String(pageSize), offset: String(offset) });
    if (document.querySelector('#campus').checked) params.set('campus', 'College Station');
    const response = await fetch(`/api/sections?${params}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Error(body.error || `Unable to load ${code} sections (${response.status}).`);
    }
    const page = (await response.json()).sections || [];
    sections.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return sections.map(section => {
    const seen = new Set();
    const meetings = (section.meetings || []).filter(meeting => {
      const key = JSON.stringify([meeting.days, meeting.begin, meeting.end, meeting.building, meeting.room, meeting.type]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const parsedMeetings = parseMeetingBlocks({ ...section, meetings });
    return { ...section, meetings: parsedMeetings, unknownMeetingBlocks: meetings.length - parsedMeetings.length };
  });
}

function rankSchedule(sections, preferences) {
  const gpas = sections.map(section => section.average_gpa).filter(value => value != null).map(Number).filter(value => Number.isFinite(value) && value >= 0 && value <= 4);
  const abRates = sections.map(section => section.ab_rate).filter(value => value != null).map(Number).filter(value => Number.isFinite(value) && value >= 0 && value <= 100);
  const gpa = gpas.length ? gpas.reduce((sum, value) => sum + value, 0) / gpas.length : null;
  const abRate = abRates.length ? abRates.reduce((sum, value) => sum + value, 0) / abRates.length : null;
  const meetings = sections.flatMap(section => section.meetings);
  const startsBefore = preferences.start == null ? 0 : meetings.filter(meeting => meeting.start < preferences.start).reduce((sum, meeting) => sum + (preferences.start - meeting.start) / 60, 0);
  const endsAfter = preferences.end == null ? 0 : meetings.filter(meeting => meeting.end > preferences.end).reduce((sum, meeting) => sum + (meeting.end - preferences.end) / 60, 0);
  const open = sections.filter(section => section.open_flag === 'Y').length;
  const closed = sections.filter(section => section.open_flag === 'N').length;
  const unknownTime = sections.reduce((sum, section) => sum + (section.unknownMeetingBlocks || (!section.meetings.length ? 1 : 0)), 0);
  const gpaPoints = gpa == null ? 0 : gpa * 2;
  const abPoints = abRate == null ? 0 : abRate / 25;
  const availabilityPoints = open - closed;
  const timePenalty = startsBefore + endsAfter;
  const score = gpaPoints + abPoints + availabilityPoints - timePenalty;
  const crnKey = sections.map(section => section.crn).sort().join(',');
  return { sections, score, crnKey, gpa, gpaCount: gpas.length, abRate, abCount: abRates.length, open, closed, unknownTime, startsBefore, endsAfter, timePenalty };
}

function formatDelta(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function scheduleExplanation(schedule) {
  const gpa = schedule.gpa == null ? 'GPA not reported' : `GPA +${(schedule.gpa * 2).toFixed(1)} (${schedule.gpaCount}/${schedule.sections.length} courses)`;
  const ab = schedule.abRate == null ? 'A/B not reported' : `A/B +${(schedule.abRate / 25).toFixed(1)} (${schedule.abCount}/${schedule.sections.length} courses)`;
  const status = `public status ${formatDelta(schedule.open - schedule.closed)} (${schedule.open} open, ${schedule.closed} closed)`;
  const time = schedule.timePenalty ? `time -${schedule.timePenalty.toFixed(1)} (${schedule.startsBefore.toFixed(1)} early hours, ${schedule.endsAfter.toFixed(1)} late hours)` : 'time preference met';
  const unknown = schedule.unknownTime ? ` · ${schedule.unknownTime} meeting block(s) have no times and were not conflict checked` : '';
  return `${gpa} · ${ab} · ${status} · ${time}${unknown}`;
}

function renderScheduleResults() {
  const results = scheduleState.results;
  const showing = Math.min(scheduleState.shown, results.length);
  scheduleElement('#schedule-result-count').textContent = `Showing ${showing} of ${results.length} conflict-free schedules. All results are ranked; use Load more to view the next page.`;
  scheduleElement('#schedule-results').innerHTML = results.slice(0, showing).map((result, index) => {
    const selected = scheduleState.compared.includes(index);
    const classes = result.sections.map(section => {
      const meetings = (section.meetings || []).map(meeting => {
        const place = [meeting.building, meeting.room].filter(Boolean).join(' ');
        return `${meeting.days || 'Days not listed'} ${displayClock(meeting.start)}-${displayClock(meeting.end)}${place ? ` · ${place}` : ''}${meeting.type ? ` · ${meeting.type}` : ''}`;
      });
      if (!meetings.length) meetings.push('Time not listed (no time conflict can be checked)');
      const publicStatus = section.open_flag === 'Y' ? 'Open flag' : section.open_flag === 'N' ? 'Closed flag' : 'Unknown';
      const updated = section.updated_at ? new Date(section.updated_at * 1000).toLocaleString() : 'time unknown';
      return `<tr><td>${scheduleEscape(`${section.subject} ${section.course} · ${section.section}`)}</td><td>${scheduleEscape(section.crn)}</td><td>${scheduleEscape(meetings.join(' · '))}</td><td>${scheduleEscape((section.instructors || []).join(', ') || 'Not listed')}</td><td>${publicStatus} · no numeric seats · ${scheduleEscape(section.source)} · updated ${scheduleEscape(updated)}</td></tr>`;
    }).join('');
    return `<article class="schedule-option"><div class="schedule-option-head"><h3>Schedule ${index + 1} · score ${result.score.toFixed(2)}</h3><button class="button secondary compare-schedule" type="button" data-index="${index}">${selected ? 'Remove from comparison' : 'Compare this schedule'}</button></div><p class="subtext">${scheduleEscape(scheduleExplanation(result))}</p><div class="grade-table-wrap"><table><thead><tr><th>Course</th><th>CRN</th><th>Meeting blocks</th><th>Instructor</th><th>Public status</th></tr></thead><tbody>${classes}</tbody></table></div></article>`;
  }).join('');
  scheduleElement('#schedule-more').hidden = showing >= results.length;
  renderScheduleComparison();
}

function renderScheduleComparison() {
  const choices = scheduleState.compared.map(index => scheduleState.results[index]).filter(Boolean);
  if (!choices.length) {
    scheduleElement('#schedule-comparison').innerHTML = '';
    return;
  }
  const rows = [
    ['Score', item => item.score.toFixed(2)],
    ['Mean historical GPA', item => item.gpa == null ? 'Not reported' : `${item.gpa.toFixed(2)} (${item.gpaCount} courses)`],
    ['Mean historical A/B share', item => item.abRate == null ? 'Not reported' : `${item.abRate.toFixed(1)}% (${item.abCount} courses)`],
    ['Public open/closed flags', item => `${item.open} open, ${item.closed} closed`],
    ['Time penalty', item => item.timePenalty.toFixed(1)],
    ['CRNs', item => item.sections.map(section => section.crn).join(', ')]
  ];
  scheduleElement('#schedule-comparison').innerHTML = `<h3>Schedule comparison</h3><div class="grade-table-wrap"><table class="compare-table"><thead><tr><th>Measure</th>${choices.map((_, index) => `<th>Option ${index + 1}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, value]) => `<tr><th>${scheduleEscape(label)}</th>${choices.map(item => `<td>${scheduleEscape(value(item))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

async function generateSchedules() {
  const codes = [...new Set(scheduleElement('#schedule-courses').value.split(/[\n,]/).map(code => code.trim().toUpperCase()).filter(Boolean))];
  if (!codes.length) { scheduleElement('#schedule-status').textContent = 'Enter at least one course code.'; return; }
  const start = parseClock(scheduleElement('#preferred-start').value);
  const end = parseClock(scheduleElement('#preferred-end').value);
  if (scheduleElement('#preferred-start').value && start == null || scheduleElement('#preferred-end').value && end == null) {
    scheduleElement('#schedule-status').textContent = 'Enter a valid time preference.'; return;
  }
  if (start != null && end != null && start > end) {
    scheduleElement('#schedule-status').textContent = 'The preferred start must be before the preferred end.';
    return;
  }
  const run = ++scheduleState.run;
  scheduleState.cancelled = false;
  scheduleState.results = [];
  scheduleState.compared = [];
  scheduleState.shown = 25;
  scheduleElement('#schedule-results').innerHTML = '';
  scheduleElement('#schedule-result-count').textContent = '';
  scheduleElement('#schedule-results').setAttribute('aria-busy', 'true');
  scheduleElement('#schedule-comparison').innerHTML = '';
  scheduleElement('#schedule-more').hidden = true;
  scheduleElement('#generate-schedules').disabled = true;
  scheduleElement('#cancel-schedules').hidden = false;
  scheduleElement('#schedule-status').textContent = 'Loading every section choice for the selected courses...';
  try {
    const courseGroups = await Promise.all(codes.map(async code => ({ code, sections: await fetchCourseSections(scheduleElement('#term').value, code) })));
    if (run !== scheduleState.run) return;
    if (scheduleState.cancelled) {
      scheduleElement('#schedule-status').textContent = 'Generation cancelled before schedule enumeration.';
      return;
    }
    const missing = courseGroups.filter(group => !group.sections.length).map(group => group.code);
    if (missing.length) {
      scheduleElement('#schedule-status').textContent = `No sections found for: ${missing.join(', ')}.`;
      return;
    }
    const invalidSections = courseGroups.flatMap(group => group.sections.filter(section => !internallyValid(section)).map(section => `${group.code} ${section.section}`));
    const baseline = scheduleState.baseline;
    const options = courseGroups.map(group => group.sections.filter(section => internallyValid(section) && !conflictsWith(section, baseline)));
    const empty = courseGroups.filter((group, index) => !options[index].length).map(group => group.code);
    if (empty.length) {
      const message = baseline.length ? 'No sections fit around the stored schedule for' : 'No usable section options for';
      scheduleElement('#schedule-status').textContent = `${message}: ${empty.join(', ')}.`;
      return;
    }
    const results = [];
    const selected = [];
    let visited = 0;
    const preferences = { start, end };
    async function visit(level) {
      if (scheduleState.cancelled || run !== scheduleState.run) return;
      if (level === options.length) {
        results.push(rankSchedule(selected.slice(), preferences));
        return;
      }
      for (const section of options[level]) {
        if (selected.some(existing => conflictsWith(section, existing.meetings))) continue;
        selected.push(section);
        await visit(level + 1);
        selected.pop();
        if (scheduleState.cancelled || run !== scheduleState.run) return;
        visited++;
        if (visited % 2500 === 0) {
          scheduleElement('#schedule-status').textContent = `Checked ${visited.toLocaleString()} partial combinations; collecting every conflict-free result...`;
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }
    await visit(0);
    if (scheduleState.cancelled || run !== scheduleState.run) {
      scheduleElement('#schedule-status').textContent = 'Generation cancelled. Partial results were discarded; run again for a complete ranked set.';
      return;
    }
    results.sort((left, right) => right.score - left.score || (left.crnKey < right.crnKey ? -1 : left.crnKey > right.crnKey ? 1 : 0));
    scheduleState.results = results;
    scheduleElement('#schedule-status').textContent = results.length ? `${results.length.toLocaleString()} complete conflict-free schedules ranked. ${invalidSections.length ? `${invalidSections.length} section(s) with internally overlapping blocks were excluded. ` : ''}Any imported classes stayed in this browser.` : 'No conflict-free schedules fit these course choices and stored classes.';
    renderScheduleResults();
  } catch (error) {
    if (run === scheduleState.run) scheduleElement('#schedule-status').textContent = `Unable to generate schedules: ${error.message}`;
  } finally {
    if (run === scheduleState.run) {
      scheduleElement('#schedule-results').setAttribute('aria-busy', 'false');
      scheduleElement('#generate-schedules').disabled = false;
      scheduleElement('#cancel-schedules').hidden = true;
    }
  }
}

scheduleElement('#schedule-file').addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const parsed = parseImportedSchedule(await file.text(), file.name);
    saveBaseline(parsed.blocks);
    scheduleElement('#existing-schedule-status').textContent = `${parsed.blocks.length} weekly meeting blocks imported from ${file.name} and saved only in this browser.${parsed.skipped ? ` Skipped ${parsed.skipped} non-weekly or unreadable events.` : ''}`;
  } catch (error) {
    scheduleElement('#existing-schedule-status').textContent = `Import failed: ${error.message} Existing saved schedule was kept.`;
  } finally {
    input.value = '';
  }
});

scheduleElement('#save-typed-schedule').addEventListener('click', () => {
  try {
    const parsed = csvBlocks(scheduleElement('#typed-schedule').value);
    saveBaseline(parsed.blocks);
    scheduleElement('#existing-schedule-status').textContent = `${parsed.blocks.length} typed weekly meeting blocks saved only in this browser.`;
  } catch (error) {
    scheduleElement('#existing-schedule-status').textContent = `Schedule not saved: ${error.message}`;
  }
});

scheduleElement('#clear-existing-schedule').addEventListener('click', () => {
  localStorage.removeItem(scheduleStorageKey);
  scheduleState.baseline = [];
  renderBaseline();
});

scheduleElement('#preferred-start').addEventListener('change', savePreferences);
scheduleElement('#preferred-end').addEventListener('change', savePreferences);
scheduleElement('#generate-schedules').addEventListener('click', generateSchedules);
scheduleElement('#cancel-schedules').addEventListener('click', () => { scheduleState.cancelled = true; });
scheduleElement('#schedule-more').addEventListener('click', () => {
  scheduleState.shown += 25;
  renderScheduleResults();
});
scheduleElement('#schedule-results').addEventListener('click', event => {
  const button = event.target.closest('.compare-schedule');
  if (!button) return;
  const index = Number(button.dataset.index);
  scheduleState.compared = scheduleState.compared.includes(index)
    ? scheduleState.compared.filter(value => value !== index)
    : scheduleState.compared.length < 3 ? [...scheduleState.compared, index] : scheduleState.compared;
  renderScheduleResults();
});

scheduleState.baseline = baselineFromStorage();
renderBaseline();
loadPreferences();
