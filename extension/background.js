const DEFAULT_BACKEND = 'http://localhost:8000';
const backendKey = 'asbBackendUrl';
const cacheKey = 'asbSectionCache';
const snapshotKey = 'asbSnapshot';
const observedKey = 'asbObservedFlags';
const maxCacheEntries = 800;
const gradeCacheMs = 10 * 60 * 1000;

const gradeCache = new Map();
let cacheWrite = Promise.resolve();

function loopbackBase(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_BACKEND;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return DEFAULT_BACKEND;
    return url.origin;
  } catch {
    return DEFAULT_BACKEND;
  }
}

async function backendBase() {
  const stored = await chrome.storage.local.get({ [backendKey]: DEFAULT_BACKEND });
  return loopbackBase(stored[backendKey]);
}

async function api(path, params) {
  const base = await backendBase();
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Error(body.error || `ASB+ backend returned ${response.status}.`);
    }
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw Error(`ASB+ backend at ${base} did not respond.`);
    if (error instanceof TypeError) throw Error(`ASB+ backend is not reachable at ${base}.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

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

function normalizeDays(value) {
  const codes = {
    MONDAY: 'M', MON: 'M', MO: 'M', TUESDAY: 'T', TUE: 'T', TU: 'T',
    WEDNESDAY: 'W', WED: 'W', WE: 'W', THURSDAY: 'R', THU: 'R', TH: 'R',
    FRIDAY: 'F', FRI: 'F', FR: 'F', SATURDAY: 'S', SAT: 'S', SA: 'S',
    SUNDAY: 'U', SUN: 'U', SU: 'U', M: 'M', T: 'T', W: 'W', R: 'R', F: 'F', S: 'S', U: 'U'
  };
  const compact = String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!compact) return '';
  if (/^[MTWRFSU]+$/.test(compact)) return compact;
  const tokens = String(value || '').toUpperCase().match(/[A-Z]+/g) || [];
  const mapped = tokens.map(token => codes[token]).filter(Boolean);
  if (mapped.length) return [...new Set(mapped.join(''))].join('');
  return codes[compact] || '';
}

function normalizeMeetings(raw) {
  const seen = new Set();
  const unique = (raw || []).filter(meeting => {
    const key = JSON.stringify([meeting?.days, meeting?.begin, meeting?.end, meeting?.building, meeting?.room, meeting?.type]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const meetings = unique.map(meeting => ({
    days: normalizeDays(meeting?.days),
    start: parseClock(meeting?.begin),
    end: parseClock(meeting?.end),
    building: String(meeting?.building || '').slice(0, 80),
    room: String(meeting?.room || '').slice(0, 40),
    type: String(meeting?.type || '').slice(0, 60)
  })).filter(meeting => meeting.days && meeting.start != null && meeting.end != null && meeting.end > meeting.start);
  return { meetings, unknownMeetingBlocks: Math.max(0, unique.length - meetings.length) };
}

function nameKey(value) {
  return String(value || '').replace(/\s*\([^)]*\)/g, '').replace(/[.,]/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

function instructorSummary(name, rows) {
  const key = nameKey(name);
  const matches = rows.filter(row => nameKey(row.instructor) === key);
  const gpas = matches.map(row => row.gpa == null || row.gpa === '' ? NaN : Number(row.gpa)).filter(value => Number.isFinite(value) && value >= 0 && value <= 4);
  return { name, records: matches.length, averageGpa: gpas.length ? gpas.reduce((sum, value) => sum + value, 0) / gpas.length : null };
}

function parseSectionRange(range) {
  return String(range || '').split(',').map(part => {
    const match = part.trim().match(/^(\d{1,4})(?:\s*-\s*(\d{1,4}))?$/);
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] == null ? start : Number(match[2]);
    return end >= start ? { start, end } : null;
  }).filter(Boolean);
}

function sectionInRange(section, range) {
  if (!range) return true;
  const parts = parseSectionRange(range);
  const number = Number.parseInt(String(section || '').match(/^\d{1,4}/)?.[0] || '', 10);
  return parts.length > 0 && Number.isFinite(number) && parts.some(part => number >= part.start && number <= part.end);
}

function requirementFits(section, rules) {
  return (rules || []).filter(rule => Array.isArray(rule.courseCodes) && rule.courseCodes.includes(section.courseCode)).map(rule => {
    const reasons = [`Course code ${section.courseCode} matches.`];
    let matches = true;
    if (rule.sectionRange) {
      const valid = sectionInRange(section.section, rule.sectionRange);
      reasons.push(valid ? `Section ${section.section} matches ${rule.sectionRange}.` : `Section ${section.section} does not match ${rule.sectionRange}.`);
      matches &&= valid;
    }
    if (rule.attribute) {
      const valid = String(section.attributes || '').toLowerCase().includes(String(rule.attribute).toLowerCase());
      reasons.push(valid ? `Section attributes include ${rule.attribute}.` : `Section attributes do not include ${rule.attribute}.`);
      matches &&= valid;
    }
    const review = [rule.minimumGrade ? `minimum grade ${rule.minimumGrade}` : '', rule.prerequisites ? `prerequisites: ${rule.prerequisites}` : ''].filter(Boolean);
    if (review.length) reasons.push(`Review ${review.join(' and ')} separately; they are not checked automatically.`);
    return { name: String(rule.name || '').slice(0, 160), kind: String(rule.kind || '').slice(0, 80), track: String(rule.track || '').slice(0, 120), matches, reason: reasons.join(' ').slice(0, 500) };
  }).filter(fit => fit.name);
}

function normalizeSection(raw, gradeRows, rules) {
  const courseCode = `${raw.subject || ''} ${raw.course || ''}`.trim();
  const { meetings, unknownMeetingBlocks } = normalizeMeetings(raw.meetings);
  const sources = [...new Set((gradeRows || []).map(row => row.source).filter(Boolean))].sort();
  const gradeUpdatedAt = (gradeRows || []).reduce((latest, row) => Math.max(latest, Number(row.fetched_at) || 0), 0) || null;
  const section = {
    crn: String(raw.crn || ''),
    term: String(raw.term || ''),
    courseCode,
    section: String(raw.section || ''),
    title: String(raw.title || ''),
    scheduleType: String(raw.schedule_type || ''),
    attributes: String(raw.attributes || ''),
    openFlag: raw.open_flag === 'Y' || raw.open_flag === 'N' ? raw.open_flag : '',
    source: String(raw.source || ''),
    updatedAt: Number(raw.updated_at) || null,
    meetings,
    unknownMeetingBlocks,
    historical: {
      averageGpa: Number.isFinite(Number(raw.average_gpa)) && raw.average_gpa != null ? Number(raw.average_gpa) : null,
      abRate: Number.isFinite(Number(raw.ab_rate)) && raw.ab_rate != null ? Number(raw.ab_rate) : null,
      records: Number(raw.grade_sections) || 0,
      sources,
      updatedAt: gradeUpdatedAt
    },
    professors: (Array.isArray(raw.instructors) ? raw.instructors : []).slice(0, 30).map(name => instructorSummary(name, gradeRows || [])),
    requirementFits: requirementFits({ ...raw, courseCode }, rules)
  };
  return section;
}

async function readRules() {
  const stored = await chrome.storage.local.get({ [snapshotKey]: null });
  const rules = stored[snapshotKey]?.rules;
  return Array.isArray(rules) ? rules : [];
}

async function gradesFor(subject, course) {
  const key = `${subject} ${course}`.toUpperCase();
  const cached = gradeCache.get(key);
  if (cached && Date.now() - cached.at < gradeCacheMs) return cached.rows;
  const data = await api('/api/grades', { subject, course });
  const rows = Array.isArray(data.grades) ? data.grades : [];
  gradeCache.set(key, { rows, at: Date.now() });
  return rows;
}

async function enrich(rawSections) {
  const rules = await readRules();
  const codes = [...new Set(rawSections.map(raw => `${String(raw.subject || '').toUpperCase()} ${String(raw.course || '')}`.trim()))];
  const gradeEntries = await Promise.all(codes.map(async code => {
    const [subject, course] = code.split(' ');
    try {
      return [code, await gradesFor(subject, course)];
    } catch {
      return [code, []];
    }
  }));
  const gradesByCode = new Map(gradeEntries);
  return rawSections.map(raw => normalizeSection(raw, gradesByCode.get(`${String(raw.subject || '').toUpperCase()} ${String(raw.course || '')}`.trim()) || [], rules));
}

async function cacheSections(sections) {
  if (!sections.length) return;
  cacheWrite = cacheWrite.then(async () => {
    const stored = await chrome.storage.local.get({ [cacheKey]: {} });
    const cache = stored[cacheKey] && typeof stored[cacheKey] === 'object' ? stored[cacheKey] : {};
    const now = Date.now();
    for (const section of sections) if (section?.crn) cache[section.crn] = { section, at: now };
    const kept = Object.entries(cache).sort((left, right) => (right[1]?.at || 0) - (left[1]?.at || 0)).slice(0, maxCacheEntries);
    await chrome.storage.local.set({ [cacheKey]: Object.fromEntries(kept) });
  }).catch(() => {});
  return cacheWrite;
}

async function cachedSections(crns) {
  const stored = await chrome.storage.local.get({ [cacheKey]: {} });
  const cache = stored[cacheKey] || {};
  const found = new Map();
  for (const crn of crns) {
    const entry = cache[String(crn)];
    if (entry?.section) found.set(String(crn), entry.section);
  }
  return found;
}

async function fetchMissing(crns, term) {
  const wanted = [...new Set(crns.map(String).filter(crn => /^\d{5}$/.test(crn)))];
  if (!wanted.length) return [];
  const results = await Promise.all(wanted.map(async crn => {
    try {
      const data = await api('/api/sections', { term, q: crn, limit: 10 });
      return (data.sections || []).find(section => String(section.crn) === crn) || null;
    } catch {
      return null;
    }
  }));
  const raw = results.filter(Boolean);
  const sections = await enrich(raw);
  await cacheSections(sections);
  return sections;
}

async function latestTerm() {
  const data = await api('/api/summary');
  return data?.latest_term ? String(data.latest_term) : '';
}

async function connection() {
  const [summary, terms] = await Promise.all([api('/api/summary'), api('/api/terms').catch(() => ({ terms: [] }))]);
  const term = summary?.latest_term ? String(summary.latest_term) : '';
  const label = (terms.terms || []).find(item => String(item.term) === term)?.label || term || 'term not listed';
  return {
    ok: true,
    base: await backendBase(),
    summary: {
      courses: Number(summary?.courses) || 0,
      sections: Number(summary?.sections) || 0,
      lastUpdated: Number(summary?.last_updated) || null,
      term,
      termLabel: label
    }
  };
}

async function searchSections(message) {
  const query = String(message.query || '').trim().slice(0, 120);
  if (!query) return { ok: true, sections: [], term: await latestTerm() };
  const term = message.term || await latestTerm();
  const params = { term, limit: Math.min(60, Math.max(1, Number(message.limit) || 40)) };
  const code = query.match(/^([A-Za-z]{2,8})\s*(\d{2,5})$/);
  if (code) {
    params.subject = code[1].toUpperCase();
    params.course = code[2];
  } else if (/^\d{5}$/.test(query)) {
    params.q = query;
  } else if (/^[A-Za-z]{2,8}$/.test(query) && message.subject) {
    params.subject = query.toUpperCase();
  } else {
    params.q = query;
  }
  const data = await api('/api/sections', params);
  const sections = await enrich(Array.isArray(data.sections) ? data.sections : []);
  await cacheSections(sections);
  return { ok: true, sections, term, query };
}

async function sectionsFor(crns) {
  const wanted = [...new Set((crns || []).map(String))];
  const cached = await cachedSections(wanted);
  const missing = wanted.filter(crn => !cached.has(crn));
  if (missing.length) {
    const term = await latestTerm().catch(() => '');
    const fetched = await fetchMissing(missing, term);
    for (const section of fetched) cached.set(section.crn, section);
  }
  const rules = await readRules();
  const sections = [...cached.values()].map(section => ({ ...section, requirementFits: requirementFits(section, rules) }));
  return { ok: true, sections };
}

async function refreshSaved(crns) {
  const wanted = [...new Set((crns || []).map(String))];
  const before = await cachedSections(wanted);
  const observedStore = await chrome.storage.local.get({ [observedKey]: {} });
  const observed = observedStore[observedKey] && typeof observedStore[observedKey] === 'object' ? { ...observedStore[observedKey] } : {};
  const term = await latestTerm().catch(() => '');
  const fetched = await fetchMissing(wanted, term);
  const after = new Map(before);
  for (const section of fetched) after.set(section.crn, section);
  const changed = [];
  for (const [crn, section] of after) {
    const previous = observed[crn];
    if (previous && section.openFlag && previous !== section.openFlag) {
      changed.push({ crn, from: previous, to: section.openFlag });
    }
    if (section.openFlag) observed[crn] = section.openFlag;
  }
  await chrome.storage.local.set({ [observedKey]: observed });
  return { ok: true, sections: [...after.values()], changed };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'asb-connect':
        return connection();
      case 'asb-search':
        return searchSections(message);
      case 'asb-sections':
        return sectionsFor(message.crns);
      case 'asb-refresh-saved':
        return refreshSaved(message.crns);
      case 'asb-clear-cache':
        await chrome.storage.local.remove(cacheKey);
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown ASB+ request.' };
    }
  })().then(sendResponse, error => sendResponse({ ok: false, error: error?.message || 'ASB+ backend request failed.' }));
  return true;
});
