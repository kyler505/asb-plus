const snapshotFile = document.querySelector('#snapshot-file');
const importButton = document.querySelector('#import-snapshot');
const statusNode = document.querySelector('#snapshot-status');
let pendingSnapshot = null;
const maxSnapshotBytes = 5 * 1024 * 1024;

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
        name: text(rule?.name, 160), kind: text(rule?.kind, 80), track: text(rule?.track, 120), matches: rule?.matches === true, reason: text(rule?.reason, 500)
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

function addListItem(list, message, buttonLabel, onClick, className = '') {
  const item = document.createElement('li');
  item.className = className;
  const label = document.createElement('span');
  label.textContent = message;
  item.append(label);
  if (buttonLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary small';
    button.textContent = buttonLabel;
    button.addEventListener('click', onClick);
    item.append(button);
  }
  list.append(item);
}

async function render() {
  const saved = await chrome.storage.local.get({ asbSnapshot: null, asbWatchCrns: [], asbAlerts: [] });
  const snapshot = saved.asbSnapshot;
  const info = document.querySelector('#snapshot-info');
  const watchList = document.querySelector('#watch-list');
  const alertList = document.querySelector('#alert-list');
  info.textContent = snapshot ? `${snapshot.sections.length} sections · ${snapshot.rules.length} rules · term ${snapshot.term || 'not listed'} · exported ${snapshot.exportedAt || 'time not listed'}. ${snapshot.note || ''}` : '';
  watchList.replaceChildren();
  const watched = [...new Set((Array.isArray(saved.asbWatchCrns) ? saved.asbWatchCrns : []).map(String))].sort();
  if (!watched.length) addListItem(watchList, 'No sections tracked.');
  for (const crn of watched) {
    addListItem(watchList, `CRN ${crn}`, 'Remove', async () => {
      const current = await chrome.storage.local.get({ asbWatchCrns: [] });
      await chrome.storage.local.set({ asbWatchCrns: current.asbWatchCrns.filter(value => String(value) !== crn) });
      await render();
    });
  }
  alertList.replaceChildren();
  const alerts = (Array.isArray(saved.asbAlerts) ? saved.asbAlerts : []).slice(-10).reverse();
  if (!alerts.length) addListItem(alertList, 'No alerts recorded.');
  for (const alert of alerts) addListItem(alertList, `${alert.message || 'Availability changed.'} ${alert.observedAt || ''}`);
}

snapshotFile.addEventListener('change', async () => {
  pendingSnapshot = null;
  importButton.disabled = true;
  const file = snapshotFile.files[0];
  if (!file) return;
  if (file.size > maxSnapshotBytes) {
    statusNode.textContent = 'Snapshot is larger than 5 MB.';
    return;
  }
  try {
    pendingSnapshot = cleanSnapshot(JSON.parse(await file.text()));
    importButton.disabled = false;
    statusNode.textContent = `Ready to import ${pendingSnapshot.sections.length} public sections and ${pendingSnapshot.rules.length} requirement rules. No plan or audit data is included.`;
  } catch (error) {
    statusNode.textContent = `Unable to read snapshot: ${error.message}`;
  }
});

importButton.addEventListener('click', async () => {
  if (!pendingSnapshot) return;
  importButton.disabled = true;
  try {
    const previous = await chrome.storage.local.get({ asbSnapshot: null, asbWatchCrns: [], asbAlerts: [] });
    const oldFlags = new Map((previous.asbSnapshot?.sections || []).map(section => [String(section.crn), section.openFlag]));
    const watched = new Set((Array.isArray(previous.asbWatchCrns) ? previous.asbWatchCrns : []).map(String));
    const newAlerts = pendingSnapshot.sections.flatMap(section => {
      const from = oldFlags.get(section.crn), to = section.openFlag;
      if (!watched.has(section.crn) || !['Y', 'N'].includes(from) || !['Y', 'N'].includes(to) || from === to) return [];
      return [{
        id: `${Date.now()}-${section.crn}-${Math.random().toString(16).slice(2)}`, kind: 'public-transition', crn: section.crn,
        message: `Public Howdy open flag changed from ${from === 'Y' ? 'open' : 'closed'} to ${to === 'Y' ? 'open' : 'closed'} for tracked CRN ${section.crn} after importing a refreshed snapshot. This is not a seat count.`,
        observedAt: new Date().toISOString()
      }];
    });
    const alerts = [...(Array.isArray(previous.asbAlerts) ? previous.asbAlerts : []), ...newAlerts].slice(-50);
    await chrome.storage.local.set({ asbSnapshot: pendingSnapshot, asbAlerts: alerts });
    statusNode.textContent = newAlerts.length
      ? `${newAlerts.length} tracked public availability change(s) detected. See Recent alerts.`
      : `Imported ${pendingSnapshot.sections.length} public sections. No watched public availability change was found.`;
    pendingSnapshot = null;
    snapshotFile.value = '';
    await render();
  } catch (error) {
    statusNode.textContent = `Unable to save snapshot locally: ${error.message}`;
  } finally {
    importButton.disabled = !pendingSnapshot;
  }
});

document.querySelector('#clear-snapshot').addEventListener('click', async () => {
  await chrome.storage.local.remove('asbSnapshot');
  statusNode.textContent = 'Imported snapshot removed from this browser.';
  await render();
});

document.querySelector('#clear-alerts').addEventListener('click', async () => {
  await chrome.storage.local.remove('asbAlerts');
  await render();
});

render().catch(error => { statusNode.textContent = `Unable to open local extension storage: ${error.message}`; });
