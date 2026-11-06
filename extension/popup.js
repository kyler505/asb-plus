const storageKeys = { snapshot: 'asbSnapshot', saved: 'asbWatchCrns', alerts: 'asbAlerts' };
const snapshotFile = document.querySelector('#snapshot-file');
const importButton = document.querySelector('#import-snapshot');
const removeButton = document.querySelector('#clear-snapshot');
const snapshotStatus = document.querySelector('#snapshot-status');
const searchInput = document.querySelector('#section-search');
const maxSnapshotBytes = 5 * 1024 * 1024;
let pendingSnapshot = null;
let current = { snapshot: null, saved: [], alerts: [] };

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
      ? 'Some meeting times are missing from the imported data. Confirm them in Schedule Builder.'
      : 'No meeting times are listed in the imported data.';
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

function rmpUrl(name) {
  const url = new URL('https://www.ratemyprofessors.com/search/professors/1003');
  url.searchParams.set('q', name);
  return url.toString();
}

function addLink(parent, name) {
  const link = element('a', 'rmp-link', `Search RMP for ${name}`);
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
    addTextLine(card, 'quiet', 'Instructor names are not listed in the imported data.');
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

function renderBrowse() {
  const results = document.querySelector('#section-results');
  const status = document.querySelector('#browse-status');
  results.replaceChildren();
  const snapshot = current.snapshot;
  const query = searchInput.value;
  if (!snapshot) {
    status.textContent = 'Import a local section snapshot to search courses, grades, instructors, and requirement matches.';
    return;
  }
  if (!query.trim()) {
    status.textContent = `${snapshot.sections.length} sections are ready. Search by course, instructor, title, or 5-digit CRN.`;
    return;
  }
  const matches = snapshot.sections.filter(section => matchesSearch(section, query));
  const ordered = matches.sort((left, right) => left.courseCode.localeCompare(right.courseCode) || left.section.localeCompare(right.section));
  const limit = 40;
  status.textContent = ordered.length > limit
    ? `Showing the first ${limit} of ${ordered.length} matches. Add a course number, instructor, or CRN to narrow results.`
    : `${ordered.length} section${ordered.length === 1 ? '' : 's'} found.`;
  const saved = savedSections();
  for (const section of ordered.slice(0, limit)) results.append(createCard(section, current.saved, saved));
}

function savedSections() {
  const byCrn = new Map((current.snapshot?.sections || []).map(section => [section.crn, section]));
  return current.saved.map(crn => byCrn.get(crn)).filter(Boolean);
}

function renderSaved() {
  const list = document.querySelector('#saved-list');
  const summary = document.querySelector('#saved-summary');
  list.replaceChildren();
  const sections = savedSections();
  const missing = current.saved.filter(crn => !current.snapshot?.sections.some(section => section.crn === crn));
  if (!current.saved.length) {
    summary.textContent = 'Save a section from Find sections or from a visible Schedule Builder row.';
    list.append(element('p', 'empty-state', 'Your course list will appear here with meeting times, grade history, and conflict checks.'));
    return;
  }
  const compared = sections.length;
  const meetingMissing = sections.filter(section => section.unknownMeetingBlocks || !section.meetings.length).length;
  summary.textContent = `${current.saved.length} saved CRN${current.saved.length === 1 ? '' : 's'} · ${compared} found in this snapshot${meetingMissing ? ` · meeting times incomplete for ${meetingMissing}` : ''}${missing.length ? ` · data missing for ${missing.join(', ')}` : ''}.`;
  for (const crn of missing) {
    const missingCard = element('article', 'section-card missing-card');
    missingCard.append(element('h3', '', `CRN ${crn}`));
    addTextLine(missingCard, 'quiet', 'This section is not in the imported snapshot. Export a fresh snapshot that includes its course, or remove it from Saved sections.');
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

async function loadState() {
  const saved = await chrome.storage.local.get({ [storageKeys.snapshot]: null, [storageKeys.saved]: [], [storageKeys.alerts]: [] });
  current = {
    snapshot: saved[storageKeys.snapshot],
    saved: [...new Set((Array.isArray(saved[storageKeys.saved]) ? saved[storageKeys.saved] : []).map(String))].sort(),
    alerts: Array.isArray(saved[storageKeys.alerts]) ? saved[storageKeys.alerts] : []
  };
  const snapshot = current.snapshot;
  document.querySelector('#term-label').textContent = snapshot ? `${snapshot.term || 'Term not listed'} · ${snapshot.sections.length} sections` : 'No section data';
  document.querySelector('#snapshot-info').textContent = snapshot
    ? `Imported ${snapshot.sections.length} sections · ${snapshot.rules.length} rules · term ${snapshot.term || 'not listed'} · exported ${snapshot.exportedAt || 'time not listed'}.`
    : '';
  document.querySelector('#saved-count').textContent = String(current.saved.length);
  removeButton.disabled = !snapshot;
  renderBrowse();
  renderSaved();
  renderAlerts();
}

async function toggleSaved(crn) {
  try {
    const saved = new Set(current.saved);
    if (saved.has(crn)) saved.delete(crn);
    else saved.add(crn);
    await chrome.storage.local.set({ [storageKeys.saved]: [...saved].sort() });
    document.querySelector('#workspace-status').textContent = saved.has(crn) ? `Saved CRN ${crn}.` : `Removed CRN ${crn} from Saved sections.`;
    await loadState();
  } catch (error) {
    document.querySelector('#workspace-status').textContent = `Unable to save this section locally: ${error.message}`;
  }
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
searchInput.addEventListener('input', renderBrowse);

document.querySelector('#alerts-details').addEventListener('toggle', event => {
  if (event.currentTarget.open) renderAlerts();
});

document.querySelector('#clear-alerts').addEventListener('click', async () => {
  try {
    await chrome.storage.local.remove(storageKeys.alerts);
    document.querySelector('#workspace-status').textContent = 'Availability changes cleared.';
    await loadState();
  } catch (error) {
    document.querySelector('#workspace-status').textContent = `Unable to clear changes: ${error.message}`;
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
    snapshotStatus.textContent = `Ready to import ${pendingSnapshot.sections.length} sections and ${pendingSnapshot.rules.length} requirement rules. No degree plan or audit data is included.`;
  } catch (error) {
    snapshotStatus.textContent = `Unable to read snapshot: ${error.message}`;
  }
});

importButton.addEventListener('click', async () => {
  if (!pendingSnapshot) return;
  importButton.disabled = true;
  try {
    const previous = await chrome.storage.local.get({ [storageKeys.snapshot]: null, [storageKeys.saved]: [], [storageKeys.alerts]: [] });
    const oldFlags = new Map((previous[storageKeys.snapshot]?.sections || []).map(section => [String(section.crn), section.openFlag]));
    const watched = new Set((Array.isArray(previous[storageKeys.saved]) ? previous[storageKeys.saved] : []).map(String));
    const newAlerts = pendingSnapshot.sections.flatMap(section => {
      const from = oldFlags.get(section.crn), to = section.openFlag;
      if (!watched.has(section.crn) || !['Y', 'N'].includes(from) || !['Y', 'N'].includes(to) || from === to) return [];
      return [{
        id: `${Date.now()}-${section.crn}-${Math.random().toString(16).slice(2)}`, kind: 'public-transition', crn: section.crn,
        message: `Public Howdy flag changed from ${from === 'Y' ? 'open' : 'closed'} to ${to === 'Y' ? 'open' : 'closed'} for saved CRN ${section.crn}. This is not a seat count.`,
        observedAt: new Date().toLocaleString()
      }];
    });
    const alerts = [...(Array.isArray(previous[storageKeys.alerts]) ? previous[storageKeys.alerts] : []), ...newAlerts].slice(-50);
    await chrome.storage.local.set({ [storageKeys.snapshot]: pendingSnapshot, [storageKeys.alerts]: alerts });
    snapshotStatus.textContent = newAlerts.length
      ? `${newAlerts.length} saved public availability change${newAlerts.length === 1 ? '' : 's'} detected. See Availability changes.`
      : `Imported ${pendingSnapshot.sections.length} sections. No saved public availability change was found.`;
    document.querySelector('#workspace-status').textContent = 'Section data updated in this browser.';
    pendingSnapshot = null;
    snapshotFile.value = '';
    await loadState();
  } catch (error) {
    snapshotStatus.textContent = `Unable to save snapshot locally: ${error.message}`;
  } finally {
    importButton.disabled = !pendingSnapshot;
  }
});

document.querySelector('#clear-snapshot').addEventListener('click', async () => {
  if (!confirm('Remove imported section data from this browser? Saved CRNs and availability changes will stay.')) return;
  try {
    await chrome.storage.local.remove(storageKeys.snapshot);
    snapshotStatus.textContent = 'Imported section data removed. Saved CRNs and availability changes remain.';
    document.querySelector('#workspace-status').textContent = 'Local section data removed.';
    await loadState();
  } catch (error) {
    snapshotStatus.textContent = `Unable to remove local data: ${error.message}`;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && Object.keys(storageKeys).some(key => changes[storageKeys[key]])) {
    loadState().catch(error => {
      document.querySelector('#workspace-status').textContent = `Unable to refresh local data: ${error.message}`;
    });
  }
});

loadState().catch(error => {
  document.querySelector('#workspace-status').textContent = `Unable to open local extension storage: ${error.message}`;
  snapshotStatus.textContent = 'Reload the extension and try again.';
});
