const storageKeys = { snapshot: 'asbSnapshot', saved: 'asbWatchCrns', alerts: 'asbAlerts' };
const snapshotFile = document.querySelector('#snapshot-file');
const importButton = document.querySelector('#import-snapshot');
const removeButton = document.querySelector('#clear-snapshot');
const snapshotStatus = document.querySelector('#snapshot-status');
const searchInput = document.querySelector('#section-search');
const maxSnapshotBytes = 5 * 1024 * 1024;
let pendingSnapshot = null;
let searchTimer = 0;
let searchSequence = 0;
let current = {
  connected: false,
  summary: null,
  sections: new Map(),
  snapshot: null,
  saved: [],
  alerts: [],
  results: [],
  query: ''
};

function text(value, max = 240) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function numeric(value, minimum, maximum) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function normalizedFlag(value) {
  return value === 'Y' || value === 'N' ? value : '';
}

function cleanSnapshot(value) {
  if (!value || value.format !== 'asb-plus-schedule-overlay' || value.version !== 1) {
    throw Error('Choose an ASB+ schedule overlay snapshot.');
  }
  if (!Array.isArray(value.sections) || !Array.isArray(value.rules)) throw Error('Snapshot sections or rules are missing.');
  if (value.sections.length > 5000 || value.rules.length > 500) throw Error('Snapshot is too large to import.');
  const seen = new Set();
  const sections = value.sections.map(item => {
    if (!item || !/^\d{5}$/.test(String(item.crn || ''))) throw Error('A section has an invalid CRN.');
    const crn = String(item.crn);
    if (seen.has(crn)) throw Error(`CRN ${crn} appears more than once.`);
    seen.add(crn);
    if (typeof item.courseCode !== 'string' || !/^[A-Z]{2,8}\s+[A-Z0-9]{2,5}$/i.test(item.courseCode)) throw Error(`CRN ${crn} has an invalid course code.`);
    const meetings = Array.isArray(item.meetings) ? item.meetings.flatMap(meeting => {
      const days = text(meeting?.days, 16).toUpperCase();
      const start = numeric(meeting?.start, 0, 1440);
      const end = numeric(meeting?.end, 0, 1440);
      if (!days || !/^[MTWRFSU]+$/.test(days) || start == null || end == null || end <= start) return [];
      return [{ days, start, end, building: text(meeting.building, 80), room: text(meeting.room, 40), type: text(meeting.type, 60) }];
    }) : [];
    const historical = item.historical && typeof item.historical === 'object' ? item.historical : {};
    return {
      crn, term: text(item.term, 24), courseCode: text(item.courseCode, 24), section: text(item.section, 24),
      title: text(item.title, 180), scheduleType: text(item.scheduleType, 80), attributes: text(item.attributes, 500),
      openFlag: normalizedFlag(item.openFlag), source: text(item.source, 100), updatedAt: numeric(item.updatedAt, 0, 9999999999),
      meetings, unknownMeetingBlocks: Math.max(0, Math.min(100, Number(item.unknownMeetingBlocks) || 0)),
      historical: {
        averageGpa: numeric(historical.averageGpa, 0, 4), abRate: numeric(historical.abRate, 0, 100),
        records: Math.max(0, Math.min(100000, Number(historical.records) || 0)),
        sources: Array.isArray(historical.sources) ? historical.sources.map(source => text(source, 60)).filter(Boolean).slice(0, 20) : [],
        updatedAt: numeric(historical.updatedAt, 0, 9999999999)
      },
      professors: Array.isArray(item.professors) ? item.professors.slice(0, 30).map(professor => ({
        name: text(professor?.name, 120), records: Math.max(0, Math.min(100000, Number(professor?.records) || 0)),
        averageGpa: numeric(professor?.averageGpa, 0, 4)
      })).filter(professor => professor.name) : [],
      requirementFits: Array.isArray(item.requirementFits) ? item.requirementFits.slice(0, 100).map(rule => ({
        name: text(rule?.name, 160), kind: text(rule?.kind, 80), track: text(rule?.track, 120),
        matches: rule?.matches === true, reason: text(rule?.reason, 500)
      })).filter(rule => rule.name) : []
    };
  });
  const rules = value.rules.map(rule => {
    if (!rule || typeof rule.name !== 'string' || !Array.isArray(rule.courseCodes)) throw Error('A requirement rule is invalid.');
    return {
      name: text(rule.name, 160), kind: text(rule.kind, 80),
      courseCodes: rule.courseCodes.map(code => text(code, 24)).filter(Boolean).slice(0, 100),
      sectionRange: text(rule.sectionRange, 100), attribute: text(rule.attribute, 160), track: text(rule.track, 120),
      minimumGrade: text(rule.minimumGrade, 8), prerequisites: text(rule.prerequisites, 300),
      catalogYear: text(rule.catalogYear, 40), source: text(rule.source, 300)
    };
  });
  return {
    format: value.format, version: 1, exportedAt: text(value.exportedAt, 40), term: text(value.term, 24),
    note: text(value.note, 500), sections, rules
  };
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

function dayLabel(days) {
  const labels = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat', U: 'Sun' };
  return [...new Set(days)].map(day => labels[day] || day).join(' ');
}

function clockLabel(minutes) {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function meetingLabel(section) {
  if (!section.meetings.length) {
    return section.unknownMeetingBlocks
      ? 'Some meeting times are missing from ASB+. Confirm them in Schedule Builder.'
      : 'No meeting times are listed in ASB+.';
  }
  const meetings = section.meetings.map(meeting => {
    const place = [meeting.building, meeting.room].filter(Boolean).join(' ');
    const kind = meeting.type ? `${meeting.type}: ` : '';
    return `${kind}${dayLabel(meeting.days)} ${clockLabel(meeting.start)}–${clockLabel(meeting.end)}${place ? ` · ${place}` : ''}`;
  });
  if (section.unknownMeetingBlocks) meetings.push('Other meeting times are not listed');
  return meetings.join(' | ');
}

function timeConflicts(left, right) {
  return Boolean(left.days && right.days && left.start < right.end && right.start < left.end &&
    [...left.days].some(day => right.days.includes(day)));
}

function conflictSummary(section, savedSections) {
  const others = savedSections.filter(item => item.crn !== section.crn);
  if (!others.length) return { text: 'No other saved sections to compare.', className: 'quiet' };
  const conflicts = [];
  let incomplete = section.unknownMeetingBlocks > 0 || !section.meetings.length;
  for (const other of others) {
    if (other.unknownMeetingBlocks > 0 || !other.meetings.length) incomplete = true;
    if (section.meetings.some(left => other.meetings.some(right => timeConflicts(left, right)))) conflicts.push(other.crn);
  }
  if (conflicts.length) return { text: `Time conflict with saved CRN ${conflicts.join(', ')}.`, className: 'conflict' };
  if (incomplete) return { text: 'No known overlap, but some saved meeting times are missing. Confirm manually.', className: 'caution' };
  return { text: `No meeting-time overlap with ${others.length} other saved section${others.length === 1 ? '' : 's'}.`, className: 'fit-match' };
}

function timeLabel(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return 'time not listed';
  return new Date(value * 1000).toLocaleString();
}

function rmpName(name) {
  return String(name || '').replace(/\s*\([^)]*\)/g, '').trim();
}

function rmpUrl(name) {
  const url = new URL('https://www.ratemyprofessors.com/search/professors/1003');
  url.searchParams.set('q', rmpName(name));
  return url.toString();
}

function addLink(parent, name) {
  const link = element('a', 'rmp-link', `Search RMP for ${rmpName(name)}`);
  link.href = rmpUrl(name);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  parent.append(link);
}

function addTextLine(parent, className, content) {
  if (content) parent.append(element('p', className, content));
}

function createCard(section, savedCrns, savedSections) {
  const card = element('article', 'section-card');
  const top = element('div', 'section-top');
  const heading = element('h3', '', `${section.courseCode} · Section ${section.section || 'not listed'}`);
  const statusText = section.openFlag === 'Y' ? 'Public flag: open' : section.openFlag === 'N' ? 'Public flag: closed' : 'Public flag not reported';
  top.append(heading, element('span', `flag ${section.openFlag === 'Y' ? 'flag-open' : section.openFlag === 'N' ? 'flag-closed' : ''}`, statusText));
  card.append(top);
  addTextLine(card, 'title', section.title);
  addTextLine(card, 'meta', `CRN ${section.crn}${section.scheduleType ? ` · ${section.scheduleType}` : ''}`);
  addTextLine(card, 'meeting', meetingLabel(section));
  const publicFreshness = section.updatedAt ? ` · updated ${timeLabel(section.updatedAt)}` : '';
  addTextLine(card, 'source', `Public section data${section.source ? ` · ${section.source}` : ''}${publicFreshness}. This is not a seat count.`);

  const history = section.historical || {};
  const gradeBits = [];
  if (Number.isFinite(history.averageGpa)) gradeBits.push(`mean GPA ${history.averageGpa.toFixed(2)}`);
  if (Number.isFinite(history.abRate)) gradeBits.push(`${history.abRate.toFixed(1)}% A/B`);
  if (history.records) gradeBits.push(`${history.records} reported grade records`);
  if (gradeBits.length) {
    const sources = history.sources?.length ? ` · sources: ${history.sources.join(', ')}` : '';
    const updated = history.updatedAt ? ` · updated ${timeLabel(history.updatedAt)}` : '';
    addTextLine(card, 'history', `Historical course grades: ${gradeBits.join(' · ')}${sources}${updated}.`);
  } else {
    addTextLine(card, 'history quiet', 'No historical course-grade summary is available.');
  }

  if (section.professors.length) {
    const instructorList = element('ul', 'instructors');
    for (const professor of section.professors) {
      const item = element('li', 'instructor');
      const stats = professor.averageGpa == null
        ? `${professor.name}: no exact-name historical grade match.`
        : `${professor.name}: historical GPA ${professor.averageGpa.toFixed(2)} across ${professor.records} exact-name grade records.`;
      item.append(element('span', '', stats));
      addLink(item, professor.name);
      instructorList.append(item);
    }
    card.append(instructorList);
  } else {
    addTextLine(card, 'quiet', 'Instructor names are not listed in ASB+.');
  }

  for (const fit of section.requirementFits) {
    addTextLine(card, fit.matches ? 'requirement fit-match' : 'requirement caution',
      `${fit.matches ? 'Potential requirement fit' : 'Does not match'}: ${fit.name}${fit.kind ? ` · ${fit.kind}` : ''}${fit.track ? ` · ${fit.track}` : ''}. ${fit.reason}`);
  }
  if (savedCrns.length) {
    const assessment = conflictSummary(section, savedSections);
    addTextLine(card, assessment.className, assessment.text);
  }

  const actions = element('div', 'card-actions');
  const saveButton = element('button', savedCrns.includes(section.crn) ? 'secondary' : '', savedCrns.includes(section.crn) ? 'Remove saved section' : 'Save section');
  saveButton.type = 'button';
  saveButton.setAttribute('aria-pressed', String(savedCrns.includes(section.crn)));
  saveButton.addEventListener('click', () => toggleSaved(section.crn));
  actions.append(saveButton);
  card.append(actions);
  return card;
}

function matchesSearch(section, query) {
  const normalized = query.toLocaleLowerCase().trim();
  if (!normalized) return false;
  const compact = normalized.replace(/\s+/g, '');
  const values = [section.courseCode, section.title, section.crn, section.section, ...section.professors.map(professor => professor.name)];
  return values.some(value => {
    const candidate = String(value || '').toLocaleLowerCase();
    return candidate.includes(normalized) || candidate.replace(/\s+/g, '').includes(compact);
  });
}

function snapshotSection(crn) {
  return current.snapshot?.sections?.find(section => section.crn === String(crn)) || null;
}

function savedSectionList() {
  return current.saved.map(crn => current.sections.get(crn) || snapshotSection(crn)).filter(Boolean);
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError;
      if (error) reject(Error(error.message));
      else if (!response) reject(Error('The ASB+ background worker did not respond.'));
      else if (response.ok === false) reject(Error(response.error || 'The ASB+ request failed.'));
      else resolve(response);
    });
  });
}

function setWorkspaceStatus(message) {
  document.querySelector('#workspace-status').textContent = message;
}

function setBrowseStatus(message) {
  document.querySelector('#browse-status').textContent = message;
}

async function connect() {
  try {
    const response = await send({ type: 'asb-connect' });
    current.connected = true;
    current.summary = response.summary;
    document.querySelector('#term-label').textContent = `${response.summary.termLabel} · ${response.summary.sections.toLocaleString()} sections`;
    document.querySelector('#backend-status').textContent = `Connected to ${response.base} · ${response.summary.sections.toLocaleString()} sections and ${response.summary.courses.toLocaleString()} courses · data updated ${timeLabel(response.summary.lastUpdated)}.`;
    if (!current.query) setBrowseStatus(`Search ${response.summary.sections.toLocaleString()} live sections from ${response.summary.termLabel}.`);
  } catch (error) {
    current.connected = false;
    current.summary = null;
    document.querySelector('#term-label').textContent = 'Backend offline';
    document.querySelector('#backend-status').textContent = `${error.message} Start the ASB+ app on hp and keep the localhost:8000 tunnel open.`;
    if (!current.query) {
      setBrowseStatus(current.snapshot
        ? 'ASB+ backend is offline. Showing imported planner data until the tunnel is back.'
        : 'ASB+ backend is offline. Start the app on hp and keep the localhost:8000 tunnel open.');
    }
  }
}

async function refreshSavedFlags() {
  if (!current.saved.length) return;
  try {
    await resolveSavedSections();
    if (!current.connected) return;
    const response = await send({ type: 'asb-refresh-saved', crns: current.saved });
    for (const section of response.sections || []) current.sections.set(section.crn, section);
    if (response.changed?.length) {
      const observedAt = new Date().toLocaleString();
      const additions = response.changed.map(change => ({
        id: `${Date.now()}-${change.crn}-${Math.random().toString(16).slice(2)}`,
        kind: 'public-transition',
        crn: change.crn,
        message: `Public Howdy flag changed from ${change.from === 'Y' ? 'open' : 'closed'} to ${change.to === 'Y' ? 'open' : 'closed'} for saved CRN ${change.crn}. This is not a seat count.`,
        observedAt
      }));
      current.alerts = [...current.alerts, ...additions].slice(-50);
      await chrome.storage.local.set({ [storageKeys.alerts]: current.alerts });
    }
    renderSaved();
  } catch {
    // Keep cached saved data when the backend is unavailable.
  }
}

async function resolveSavedSections() {
  const missing = current.saved.filter(crn => !current.sections.has(crn));
  if (missing.length && current.connected) {
    try {
      const response = await send({ type: 'asb-sections', crns: missing });
      for (const section of response.sections || []) current.sections.set(section.crn, section);
    } catch {
      // Fall back to the optional planner snapshot.
    }
  }
  for (const crn of current.saved) {
    if (!current.sections.has(crn)) {
      const section = snapshotSection(crn);
      if (section) current.sections.set(crn, section);
    }
  }
}

function renderBrowse() {
  const results = document.querySelector('#section-results');
  results.replaceChildren();
  const query = current.query.trim();
  if (!query) return;
  const matches = current.results;
  if (!matches.length) return;
  const ordered = [...matches].sort((left, right) => left.courseCode.localeCompare(right.courseCode) || left.section.localeCompare(right.section));
  const limit = 40;
  const saved = savedSectionList();
  for (const section of ordered.slice(0, limit)) results.append(createCard(section, current.saved, saved));
}

function renderSaved() {
  const list = document.querySelector('#saved-list');
  const summary = document.querySelector('#saved-summary');
  list.replaceChildren();
  const sections = savedSectionList();
  const missing = current.saved.filter(crn => !current.sections.has(crn) && !snapshotSection(crn));
  if (!current.saved.length) {
    summary.textContent = 'Save a section from Find sections or from a visible Schedule Builder row.';
    list.append(element('p', 'empty-state', 'Your course list will appear here with meeting times, grade history, and conflict checks.'));
    return;
  }
  const meetingMissing = sections.filter(section => section.unknownMeetingBlocks || !section.meetings.length).length;
  summary.textContent = `${current.saved.length} saved CRN${current.saved.length === 1 ? '' : 's'} · ${sections.length} loaded${meetingMissing ? ` · meeting times incomplete for ${meetingMissing}` : ''}${missing.length ? ` · data missing for ${missing.join(', ')}` : ''}.`;
  for (const crn of missing) {
    const missingCard = element('article', 'section-card missing-card');
    missingCard.append(element('h3', '', `CRN ${crn}`));
    addTextLine(missingCard, 'quiet', 'ASB+ has no section data for this CRN in the selected term. Check this term in Schedule Builder or remove it from Saved sections.');
    const button = element('button', 'secondary', 'Remove saved section');
    button.type = 'button';
    button.addEventListener('click', () => toggleSaved(crn));
    missingCard.append(button);
    list.append(missingCard);
  }
  for (const section of sections) list.append(createCard(section, current.saved, sections));
}

function renderAlerts() {
  const list = document.querySelector('#alert-list');
  list.replaceChildren();
  const alerts = current.alerts.slice(-10).reverse();
  document.querySelector('#alert-count').textContent = String(current.alerts.length);
  if (!alerts.length) list.append(element('li', 'quiet', 'No availability changes recorded.'));
  for (const alert of alerts) {
    const item = element('li', '', `${alert.message || 'Availability changed.'}${alert.observedAt ? ` · ${alert.observedAt}` : ''}`);
    list.append(item);
  }
}

function updateSnapshotInfo() {
  const snapshot = current.snapshot;
  document.querySelector('#snapshot-info').textContent = snapshot
    ? `Planning data: ${snapshot.rules.length} requirement rules from term ${snapshot.term || 'not listed'} · exported ${snapshot.exportedAt || 'time not listed'}.`
    : '';
  snapshotStatus.textContent = snapshot
    ? `Imported ${snapshot.rules.length} requirement rules. Section data still comes live from ASB+.`
    : 'No planning data imported. Requirement matches will not appear.';
}

async function loadLocal() {
  const saved = await chrome.storage.local.get({ [storageKeys.snapshot]: null, [storageKeys.saved]: [], [storageKeys.alerts]: [] });
  current.snapshot = saved[storageKeys.snapshot];
  current.saved = [...new Set((Array.isArray(saved[storageKeys.saved]) ? saved[storageKeys.saved] : []).map(String))].sort();
  current.alerts = Array.isArray(saved[storageKeys.alerts]) ? saved[storageKeys.alerts] : [];
  document.querySelector('#saved-count').textContent = String(current.saved.length);
  removeButton.disabled = !current.snapshot;
  updateSnapshotInfo();
  renderAlerts();
  await resolveSavedSections();
  renderSaved();
  renderBrowse();
}

async function loadState() {
  await loadLocal();
  await connect();
  await loadLocal();
  refreshSavedFlags().catch(() => {});
}

async function runSearch(query) {
  const sequence = ++searchSequence;
  if (!query.trim()) {
    current.results = [];
    renderBrowse();
    setBrowseStatus(current.connected && current.summary
      ? `Search ${current.summary.sections.toLocaleString()} live sections from ${current.summary.termLabel}.`
      : 'ASB+ backend is offline. Start the app on hp and keep the localhost:8000 tunnel open.');
    return;
  }
  setBrowseStatus(`Searching ASB+ for ${query.trim()}...`);
  if (!current.connected) {
    if (current.snapshot?.sections?.length) {
      const matches = current.snapshot.sections.filter(section => matchesSearch(section, query)).slice(0, 40);
      current.results = matches;
      setBrowseStatus(`ASB+ backend is offline. Showing ${matches.length} match${matches.length === 1 ? '' : 'es'} from imported planner data.`);
      renderBrowse();
    } else {
      current.results = [];
      setBrowseStatus('ASB+ backend is offline. Start the app on hp and keep the localhost:8000 tunnel open.');
      renderBrowse();
    }
    return;
  }
  try {
    const response = await send({ type: 'asb-search', query, term: current.summary?.term });
    if (sequence !== searchSequence) return;
    current.results = response.sections || [];
    for (const section of current.results) current.sections.set(section.crn, section);
    const count = current.results.length;
    const limit = 40;
    setBrowseStatus(count > limit
      ? `Showing the first ${limit} of ${count} live matches. Add a course number, instructor, or CRN to narrow results.`
      : `${count} live section${count === 1 ? '' : 's'} found.`);
    renderBrowse();
    renderSaved();
  } catch (error) {
    if (sequence !== searchSequence) return;
    if (current.snapshot?.sections?.length) {
      current.results = current.snapshot.sections.filter(section => matchesSearch(section, query)).slice(0, 40);
      setBrowseStatus(`${error.message} Showing imported planner data instead.`);
    } else {
      current.results = [];
      setBrowseStatus(error.message);
    }
    renderBrowse();
  }
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  const query = searchInput.value;
  current.query = query;
  searchTimer = setTimeout(() => runSearch(query), 220);
}

let saveChain = Promise.resolve();

function toggleSaved(crn) {
  saveChain = saveChain.then(() => mutateSaved(crn)).catch(error => {
    setWorkspaceStatus(`Unable to save this section locally: ${error.message}`);
  });
  return saveChain;
}

async function mutateSaved(crn) {
  const stored = await chrome.storage.local.get({ [storageKeys.saved]: [] });
  const saved = new Set((Array.isArray(stored[storageKeys.saved]) ? stored[storageKeys.saved] : []).map(String));
  const saving = !saved.has(crn);
  if (saving) saved.add(crn); else saved.delete(crn);
  await chrome.storage.local.set({ [storageKeys.saved]: [...saved].sort() });
  current.saved = [...saved].sort();
  document.querySelector('#saved-count').textContent = String(current.saved.length);
  if (saving && !current.sections.has(crn) && current.connected) {
    try {
      const response = await send({ type: 'asb-sections', crns: [crn] });
      for (const section of response.sections || []) current.sections.set(section.crn, section);
    } catch {
      // The missing-card path covers an unavailable backend.
    }
  }
  setWorkspaceStatus(saving ? `Saved CRN ${crn}.` : `Removed CRN ${crn} from Saved sections.`);
  renderBrowse();
  renderSaved();
}

function switchView(view) {
  const browse = view === 'browse';
  document.querySelector('#browse-view').hidden = !browse;
  document.querySelector('#saved-view').hidden = browse;
  document.querySelector('#browse-tab').setAttribute('aria-pressed', String(browse));
  document.querySelector('#saved-tab').setAttribute('aria-pressed', String(!browse));
  if (!browse) renderSaved();
}

document.querySelector('#browse-tab').addEventListener('click', () => switchView('browse'));
document.querySelector('#saved-tab').addEventListener('click', () => switchView('saved'));
searchInput.addEventListener('input', scheduleSearch);
document.querySelector('#refresh-backend').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  setWorkspaceStatus('Refreshing public section data from ASB+...');
  try {
    await loadState();
    setWorkspaceStatus('ASB+ data refreshed.');
  } finally {
    event.currentTarget.disabled = false;
  }
});

document.querySelector('#detect-schedule-builder').addEventListener('click', async () => {
  const status = document.querySelector('#detect-status');
  const output = document.querySelector('#detect-output');
  status.textContent = '';
  output.hidden = true;
  output.textContent = '';
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const active = tabs[0];
    if (!active || !/^https:\/\/tamu\.collegescheduler\.com\//.test(active.url || '')) {
      status.textContent = 'Open the Schedule Builder tab first.';
      return;
    }
    chrome.tabs.sendMessage(active.id, { type: 'asb-detect' }, response => {
      const error = chrome.runtime.lastError;
      if (error || !response?.ok) {
        status.textContent = 'The ASB+ overlay is not loaded on this page. Reload the Schedule Builder tab.';
        return;
      }
      status.textContent = `${response.count} visible row${response.count === 1 ? '' : 's'} with a 5-digit CRN · ${response.overlayCount} overlay panel${response.overlayCount === 1 ? '' : 's'} · ${response.bodyCrns} distinct 5-digit number${response.bodyCrns === 1 ? '' : 's'} in page text${response.hasCrnLabel ? ' · CRN label visible' : ' · no CRN label in page text'}.`;
      output.hidden = false;
      output.textContent = response.rows.map(row => `CRN ${row.crn}${row.status ? ` · ${row.status}` : ''} · ${row.tag}${row.classes ? `.${row.classes.replace(/\s+/g, '.')}` : ''} · ${row.text}`).join('\n') ||
        'No visible row with a 5-digit CRN was found. Schedule Builder may hide CRNs or use another structure.';
    });
  } catch (error) {
    status.textContent = `Unable to check the active tab: ${error.message}`;
  }
});

document.querySelector('#alerts-details').addEventListener('toggle', event => {
  if (event.currentTarget.open) renderAlerts();
});

document.querySelector('#clear-alerts').addEventListener('click', async () => {
  try {
    await chrome.storage.local.remove(storageKeys.alerts);
    current.alerts = [];
    setWorkspaceStatus('Availability changes cleared.');
    renderAlerts();
  } catch (error) {
    setWorkspaceStatus(`Unable to clear changes: ${error.message}`);
  }
});

snapshotFile.addEventListener('change', async () => {
  pendingSnapshot = null;
  importButton.disabled = true;
  const file = snapshotFile.files[0];
  if (!file) return;
  if (file.size > maxSnapshotBytes) {
    snapshotStatus.textContent = 'Snapshot is larger than 5 MB.';
    return;
  }
  try {
    pendingSnapshot = cleanSnapshot(JSON.parse(await file.text()));
    importButton.disabled = false;
    snapshotStatus.textContent = `Ready to import ${pendingSnapshot.rules.length} requirement rules. Live section data is not replaced.`;
  } catch (error) {
    snapshotStatus.textContent = `Unable to read snapshot: ${error.message}`;
  }
});

importButton.addEventListener('click', async () => {
  if (!pendingSnapshot) return;
  importButton.disabled = true;
  try {
    const planningData = { ...pendingSnapshot, sections: [] };
    await chrome.storage.local.set({ [storageKeys.snapshot]: planningData });
    current.snapshot = planningData;
    snapshotStatus.textContent = `Imported ${planningData.rules.length} requirement rules. Refresh a search to recompute requirement matches.`;
    setWorkspaceStatus('Planning data updated in this browser.');
    pendingSnapshot = null;
    snapshotFile.value = '';
    updateSnapshotInfo();
    if (current.saved.length && current.connected) {
      try {
        const response = await send({ type: 'asb-sections', crns: current.saved });
        for (const section of response.sections || []) current.sections.set(section.crn, section);
      } catch {
        // Saved cards keep their previous requirement context.
      }
    }
    if (current.query) runSearch(current.query);
    else renderSaved();
  } catch (error) {
    snapshotStatus.textContent = `Unable to save planning data locally: ${error.message}`;
  } finally {
    importButton.disabled = !pendingSnapshot;
  }
});

document.querySelector('#clear-snapshot').addEventListener('click', async () => {
  if (!confirm('Remove imported planning data from this browser? Saved CRNs and availability changes will stay.')) return;
  try {
    await chrome.storage.local.remove(storageKeys.snapshot);
    current.snapshot = null;
    snapshotStatus.textContent = 'Planning data removed. Saved CRNs and availability changes remain.';
    setWorkspaceStatus('Local planning data removed.');
    updateSnapshotInfo();
    removeButton.disabled = true;
    renderSaved();
  } catch (error) {
    snapshotStatus.textContent = `Unable to remove local data: ${error.message}`;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[storageKeys.saved] || changes[storageKeys.snapshot]) {
    loadLocal().catch(error => setWorkspaceStatus(`Unable to refresh local data: ${error.message}`));
  }
  if (changes[storageKeys.alerts]) {
    current.alerts = changes[storageKeys.alerts].newValue || [];
    renderAlerts();
  }
});

loadState().catch(error => {
  setWorkspaceStatus(`Unable to open the ASB+ workspace: ${error.message}`);
  snapshotStatus.textContent = 'Reload the extension and try again.';
});
