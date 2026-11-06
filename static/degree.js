const degreeElement = selector => document.querySelector(selector);
const degreeEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const degreeDbName = 'asb-degree-workspace';
const degreeDbVersion = 1;
const degreeStoreName = 'workspace';
const degreeKinds = ['Core / UCC', 'Major', 'Tracked elective', 'Track coverage', 'Writing / UCRT', 'High-impact', 'Emphasis / minor', 'Prerequisite', 'Minimum grade', 'Other'];
const planStatuses = ['Planned', 'In progress', 'Completed', 'Transfer credit', 'Do not count'];
const auditStatuses = ['Needs review', 'Met', 'Not met', 'In progress', 'Unknown'];
const degreeState = { db: null, data: null, rulePreview: [], planPreview: null, auditPreview: null, pdfjs: null, pickerRun: 0 };

function newDegreeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyDegreeWorkspace() {
  return {
    schemaVersion: 1,
    profile: { program: '', catalogYear: '', catalogSource: '' },
    rules: [],
    plan: { status: 'draft', locked: false, courses: [], approvedCourses: [], pending: null, source: '', importedAt: null },
    audit: { courses: [], history: [], source: '', importedAt: null }
  };
}

function normalizeDegreeWorkspace(value) {
  const base = emptyDegreeWorkspace();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const plan = value.plan && typeof value.plan === 'object' ? value.plan : {};
  const audit = value.audit && typeof value.audit === 'object' ? value.audit : {};
  return {
    ...base,
    ...value,
    profile: { ...base.profile, ...(value.profile || {}) },
    rules: Array.isArray(value.rules) ? value.rules : [],
    plan: {
      ...base.plan,
      ...plan,
      courses: Array.isArray(plan.courses) ? plan.courses : [],
      approvedCourses: Array.isArray(plan.approvedCourses) ? plan.approvedCourses : [],
      pending: plan.pending && typeof plan.pending === 'object' ? plan.pending : null
    },
    audit: {
      ...base.audit,
      ...audit,
      courses: Array.isArray(audit.courses) ? audit.courses : [],
      history: Array.isArray(audit.history) ? audit.history : []
    }
  };
}

function openDegreeDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(degreeDbName, degreeDbVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(degreeStoreName)) request.result.createObjectStore(degreeStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('Browser storage could not be opened.'));
    request.onblocked = () => reject(Error('Close another ASB+ tab before opening degree-plan storage.'));
  });
}

function degreeRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('Browser storage request failed.'));
  });
}

async function loadDegreeWorkspace() {
  const transaction = degreeState.db.transaction(degreeStoreName, 'readonly');
  return normalizeDegreeWorkspace(await degreeRequest(transaction.objectStore(degreeStoreName).get('active')));
}

async function saveDegreeWorkspace(message = 'Degree data saved in this browser only.') {
  const transaction = degreeState.db.transaction(degreeStoreName, 'readwrite');
  transaction.objectStore(degreeStoreName).put(degreeState.data, 'active');
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || Error('Private browser storage could not be saved.'));
    transaction.onabort = () => reject(transaction.error || Error('Private browser storage save was cancelled.'));
  });
  degreeElement('#degree-status').textContent = message;
}

function updateDegreeStatus(message) {
  degreeElement('#degree-status').textContent = message;
}

function normalizeCourseCode(value) {
  const text = String(value || '').toUpperCase().replace(/[\u2013\u2014]/g, '-');
  const match = text.match(/\b([A-Z]{2,8})[\s-]+(\d{3,4}[A-Z]?)\b/);
  if (!match || /^(SPRING|SUMMER|WINTER|FALL|REQUEST|HOURS|TOTAL|GPA|YEAR)$/.test(match[1])) return '';
  return `${match[1]} ${match[2]}`;
}

function courseCodes(value) {
  const parts = String(value || '').split(/[;,\n]+/).map(part => normalizeCourseCode(part)).filter(Boolean);
  return [...new Set(parts)];
}

function readDelimited(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim()); cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index++;
      row.push(cell.trim());
      if (row.some(value => value)) rows.push(row);
      row = []; cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some(value => value)) rows.push(row);
  return rows;
}

function headerKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findColumn(headers, names) {
  return headers.findIndex(header => names.includes(headerKey(header)));
}

function statusFromText(text, mode) {
  const value = String(text || '').toLowerCase();
  if (mode === 'audit') {
    if (/\bnot\s+met\b|\bnot\s+satisfied\b|\bincomplete\b|\bunsatisfied\b/.test(value)) return 'Not met';
    if (/\bmet\b|\bsatisfied\b|\bcomplete\b/.test(value)) return 'Met';
    if (/\bin\s+progress\b|\bin-progress\b/.test(value)) return 'In progress';
    return 'Needs review';
  }
  if (/\btransfer(?:red)?\b/.test(value)) return 'Transfer credit';
  if (/\bin\s+progress\b|\bin-progress\b/.test(value)) return 'In progress';
  if (/\bnot\s+completed?\b|\bincomplete\b|\bnot\s+satisfied\b/.test(value)) return 'Do not count';
  if (/\bcompleted\b|\bcomplete\b/.test(value)) return 'Completed';
  if (/\bplanned\b|\bplan\b/.test(value)) return 'Planned';
  return 'Planned';
}

function parseDocumentRows(text, mode) {
  const rows = readDelimited(text);
  const headers = rows[0] || [];
  const hasHeader = headers.some(header => ['course', 'course code', 'subject', 'course number', 'catalog number', 'status', 'requirement', 'degree req', 'degree requirement'].includes(headerKey(header)));
  const parsed = [];
  if (hasHeader && rows.length > 1) {
    const subjectColumn = findColumn(headers, ['subject', 'department', 'dept', 'prefix']);
    const numberColumn = findColumn(headers, ['course number', 'catalog number', 'number', 'course no']);
    const courseColumn = findColumn(headers, ['course', 'course code', 'class', 'course name']);
    const titleColumn = findColumn(headers, ['title', 'course title', 'name']);
    const statusColumn = findColumn(headers, ['status', 'result', 'evaluation', 'audit status', 'completion', 'done', 'done status']);
    const termColumn = findColumn(headers, ['term', 'semester', 'planned term']);
    const sectionColumn = findColumn(headers, ['section', 'section number', 'class section']);
    const gradeColumn = findColumn(headers, ['grade', 'final grade']);
    const requirementColumn = findColumn(headers, ['requirement', 'bucket', 'degree requirement', 'degree req', 'degree req tag', 'requirement tag', 'category']);
    const attributeColumn = findColumn(headers, ['attribute', 'section attribute']);
    for (const values of rows.slice(1)) {
      const raw = values.join(' | ');
      const courseValue = courseColumn >= 0 ? values[courseColumn] : '';
      const code = normalizeCourseCode(courseValue) || normalizeCourseCode(`${subjectColumn >= 0 ? values[subjectColumn] : ''} ${courseValue || (numberColumn >= 0 ? values[numberColumn] : '')}`) || normalizeCourseCode(raw);
      const statusValue = statusColumn >= 0 ? values[statusColumn] : raw;
      let inferredStatus = statusFromText(statusValue, mode);
      const statusHeader = statusColumn >= 0 ? headerKey(headers[statusColumn]) : '';
      if (mode === 'plan' && ['done', 'done status'].includes(statusHeader)) {
        if (/^(yes|true|y|1|done|complete|completed)$/i.test(statusValue.trim())) inferredStatus = 'Completed';
        else if (/^(no|false|n|0|not done)$/i.test(statusValue.trim())) inferredStatus = 'Planned';
      }
      const requirement = requirementColumn >= 0 ? values[requirementColumn] : '';
      if (code) {
        parsed.push({
          id: newDegreeId(), code, label: titleColumn >= 0 ? values[titleColumn] : '',
          term: termColumn >= 0 ? values[termColumn] : '', section: sectionColumn >= 0 ? values[sectionColumn] : '',
          grade: gradeColumn >= 0 ? values[gradeColumn] : '', attribute: attributeColumn >= 0 ? values[attributeColumn] : '',
          requirementLabel: requirement, status: inferredStatus, raw
        });
      } else if (mode === 'audit' && requirement && inferredStatus !== 'Needs review') {
        parsed.push({ id: newDegreeId(), code: '', label: requirement, term: '', section: '', grade: '', attribute: '', requirementLabel: requirement, status: inferredStatus, raw });
      }
    }
  } else {
    for (const line of String(text || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
      const codes = [...line.toUpperCase().matchAll(/\b([A-Z]{2,8})[\s-]+(\d{3,4}[A-Z]?)\b/g)]
        .map(match => normalizeCourseCode(`${match[1]} ${match[2]}`)).filter(Boolean)
        .filter(code => !/^(SPRING|SUMMER|WINTER|FALL|REQUEST|HOURS|TOTAL|GPA|YEAR)\b/.test(code));
      const uniqueCodes = [...new Set(codes)];
      const status = statusFromText(line, mode);
      if (uniqueCodes.length) {
        for (const code of uniqueCodes) parsed.push({ id: newDegreeId(), code, label: '', term: '', section: '', grade: '', attribute: '', requirementLabel: '', status, raw: line });
      } else if (mode === 'audit' && status !== 'Needs review' && /\b(requirement|hours|elective|core|major|writing|track|minor|degree)\b/i.test(line)) {
        parsed.push({ id: newDegreeId(), code: '', label: line, term: '', section: '', grade: '', attribute: '', requirementLabel: line, status, raw: line });
      }
    }
  }
  if (!parsed.length) throw Error('No course or audit rows were detected. Use a text PDF, paste readable text, or import CSV/TSV with course columns.');
  if (parsed.length > 500) throw Error('This import contains more than 500 detected rows. Split it into smaller files and review each part.');
  return parsed;
}

async function pdfText(file) {
  if (file.size > 25 * 1024 * 1024) throw Error('PDF is larger than 25 MB. Split it into smaller files.');
  if (!degreeState.pdfjs) {
    degreeState.pdfjs = import('/vendor/pdfjs/pdf.mjs').then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('/vendor/pdfjs/pdf.worker.mjs', location.href).href;
      return pdfjs;
    });
  }
  const pdfjs = await degreeState.pdfjs;
  const documentTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  const document = await documentTask.promise;
  if (document.numPages > 300) { await document.destroy(); throw Error('PDF has more than 300 pages. Split it into smaller files.'); }
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.filter(item => typeof item.str === 'string' && item.str.trim())
        .map(item => ({ text: item.str.trim(), x: item.transform?.[4] || 0, y: item.transform?.[5] || 0 }))
        .sort((left, right) => right.y - left.y || left.x - right.x);
      const lines = [];
      for (const item of items) {
        let line = lines.at(-1);
        if (!line || Math.abs(line.y - item.y) > 2) {
          line = { y: item.y, items: [] };
          lines.push(line);
        }
        line.items.push(item);
      }
      pages.push(lines.map(line => line.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ')).join('\n'));
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  const text = pages.join('\n');
  if (!text.trim()) throw Error('This PDF has no extractable text. Use an unlocked text PDF or paste text from an OCR copy.');
  return text;
}

async function getImportText(kind) {
  const file = degreeElement(`#degree-${kind}-file`).files[0];
  if (file) {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return { text: await pdfText(file), source: file.name };
    if (!/\.(txt|csv|tsv)$/i.test(file.name) && !/^(text\/plain|text\/csv|text\/tab-separated-values)$/.test(file.type)) {
      throw Error('Choose a PDF, text, CSV, or TSV file.');
    }
    if (file.size > 10 * 1024 * 1024) throw Error('File is larger than 10 MB. Split it into smaller files.');
    return { text: await file.text(), source: file.name };
  }
  const text = degreeElement(`#degree-${kind}-text`).value;
  if (!text.trim()) throw Error('Choose a local file or paste text first.');
  return { text, source: 'Pasted text' };
}

function ruleCodes(rule) {
  return Array.isArray(rule.courseCodes) ? rule.courseCodes : [];
}

function suggestedRules(row) {
  const matches = new Map();
  for (const rule of degreeState.data.rules) {
    if (row.code && ruleCodes(rule).includes(row.code)) matches.set(rule.id, rule);
    const tag = String(row.requirementLabel || '').trim().toLowerCase();
    if (tag && `${rule.name} ${rule.kind}`.toLowerCase().includes(tag)) matches.set(rule.id, rule);
  }
  return [...matches.values()];
}


function ruleChoices(row, prefix) {
  const matches = suggestedRules(row);
  if (!matches.length) return '<p class="degree-rule-summary">No exact rule suggestion. You can save the row without a rule or assign one after import.</p>';
  return `<fieldset><legend>Suggestions from course code or imported tag. Check only the matches you confirm.</legend>${matches.map(rule => `<label class="check"><input type="checkbox" data-${prefix}-rule="${degreeEscape(row.id)}" value="${degreeEscape(rule.id)}"> <span>${degreeEscape(rule.name)} · ${degreeEscape(rule.kind)}${rule.sectionRange || rule.attribute ? ' · section details need review' : ''}</span></label>`).join('')}</fieldset>`;
}

function statusOptions(values, selected) {
  return values.map(value => `<option value="${degreeEscape(value)}" ${selected === value ? 'selected' : ''}>${degreeEscape(value)}</option>`).join('');
}

function renderImportPreview(kind, preview) {
  const root = degreeElement(`#degree-${kind}-preview`);
  const confirm = degreeElement(`#confirm-degree-${kind}`);
  confirm.hidden = false;
  confirm.textContent = kind === 'plan' ? 'Save confirmed plan rows' : 'Save confirmed audit rows';
  root.innerHTML = `<p class="degree-rule-summary">${preview.rows.length} rows detected from ${degreeEscape(preview.source)}. Source text stays in memory only. Select and correct each row you want to save.</p>${preview.rows.map((row, index) => {
    const statuses = kind === 'plan' ? planStatuses : auditStatuses;
    const defaultStatus = statuses.includes(row.status) ? row.status : statuses[0];
    const id = (field, suffix = '') => `degree-${kind}-${field}-${index}${suffix}`;
    return `<article class="degree-import-row" data-degree-import-row="${index}">
      <label class="check"><input type="checkbox" data-degree-include> <span>Confirm and include this row</span></label>
      <div class="degree-grid">
        <div class="field"><label for="${id('code')}">Course code</label><input id="${id('code')}" data-degree-code value="${degreeEscape(row.code)}" placeholder="Optional for audit requirement rows"></div>
        <div class="field"><label for="${id('term')}">Term</label><input id="${id('term')}" data-degree-term value="${degreeEscape(row.term)}"></div>
        <div class="field"><label for="${id('section')}">Section number</label><input id="${id('section')}" data-degree-section value="${degreeEscape(row.section)}"></div>
        <div class="field"><label for="${id('status')}">${kind === 'plan' ? 'Plan state' : 'Audit result'}</label><select id="${id('status')}" data-degree-status>${statusOptions(statuses, defaultStatus)}</select></div>
        <div class="field"><label for="${id('grade')}">Grade, if shown</label><input id="${id('grade')}" data-degree-grade value="${degreeEscape(row.grade)}"></div>
        <div class="field"><label for="${id('attribute')}">Section attribute, if shown</label><input id="${id('attribute')}" data-degree-attribute value="${degreeEscape(row.attribute)}"></div>
        <div class="field"><label for="${id('label')}">Course title or requirement</label><input id="${id('label')}" data-degree-label value="${degreeEscape(row.label || row.requirementLabel)}"></div>
        <div class="field"><label for="${id('requirement-label')}">Imported requirement tag</label><input id="${id('requirement-label')}" data-degree-requirement-label value="${degreeEscape(row.requirementLabel)}"></div>
      </div>
      ${ruleChoices(row, kind)}<p class="degree-rule-summary">Detected source line: ${degreeEscape(row.raw.slice(0, 420))}${row.raw.length > 420 ? '…' : ''}</p>
    </article>`;
  }).join('')}`;
}

async function previewAcademicImport(kind) {
  const button = degreeElement(`#preview-degree-${kind}`);
  const status = degreeElement('#degree-status');
  button.disabled = true;
  status.textContent = `Reading ${kind} locally for review...`;
  try {
    const imported = await getImportText(kind);
    const preview = { ...imported, rows: parseDocumentRows(imported.text, kind), createdAt: new Date().toISOString() };
    degreeState[`${kind}Preview`] = preview;
    renderImportPreview(kind, preview);
    status.textContent = `${preview.rows.length} ${kind} rows detected locally. Confirm each row before it is saved.`;
  } catch (error) {
    status.textContent = `Unable to preview ${kind}: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

function selectedPreviewRows(kind) {
  const preview = degreeState[`${kind}Preview`];
  if (!preview) return [];
  return [...degreeElement(`#degree-${kind}-preview`).querySelectorAll('[data-degree-import-row]')].flatMap(node => {
    if (!node.querySelector('[data-degree-include]').checked) return [];
    const code = normalizeCourseCode(node.querySelector('[data-degree-code]').value);
    if (kind === 'plan' && !code) return [];
    const requirementIds = [...node.querySelectorAll(`[data-${kind}-rule]:checked`)].map(input => input.value);
    return [{
      id: newDegreeId(), code, label: node.querySelector('[data-degree-label]').value.trim(),
      requirementLabel: node.querySelector('[data-degree-requirement-label]').value.trim(),
      term: node.querySelector('[data-degree-term]').value.trim(), section: node.querySelector('[data-degree-section]').value.trim(),
      grade: node.querySelector('[data-degree-grade]').value.trim(), attribute: node.querySelector('[data-degree-attribute]').value.trim(),
      status: node.querySelector('[data-degree-status]').value, requirementIds, confirmed: true
    }];
  });
}

async function confirmAcademicImport(kind) {
  const rows = selectedPreviewRows(kind);
  if (!rows.length) {
    updateDegreeStatus('Select at least one row and confirm its contents before saving. Plan rows need a course code.');
    return;
  }
  const preview = degreeState[`${kind}Preview`];
  if (kind === 'plan') {
    const plan = degreeState.data.plan;
    const imported = { courses: rows, source: preview.source, importedAt: new Date().toISOString() };
    if (plan.locked) {
      plan.pending = imported;
      updateDegreeStatus('Confirmed rows are saved as a revision draft. The locked plan and its approval record are unchanged.');
    } else {
      plan.courses = imported.courses;
      plan.source = imported.source;
      plan.importedAt = imported.importedAt;
      plan.status = plan.approvedCourses.length ? 'revision-required' : 'draft';
      plan.pending = null;
      updateDegreeStatus(plan.approvedCourses.length ? 'Plan rows updated. Reapproval is required; the previous approved copy is retained.' : 'Confirmed plan rows saved locally. The plan is still a draft.');
    }
  } else {
    const audit = degreeState.data.audit;
    if (audit.courses.length) audit.history.unshift({ courses: audit.courses, source: audit.source, importedAt: audit.importedAt });
    audit.history = audit.history.slice(0, 5);
    audit.courses = rows;
    audit.source = preview.source;
    audit.importedAt = new Date().toISOString();
    updateDegreeStatus('Confirmed audit rows saved as a separate local snapshot. The degree plan was not changed.');
  }
  degreeState[`${kind}Preview`] = null;
  degreeElement(`#degree-${kind}-preview`).replaceChildren();
  degreeElement(`#confirm-degree-${kind}`).hidden = true;
  try {
    await saveDegreeWorkspace(degreeElement('#degree-status').textContent);
    renderPlan(); renderAudit(); renderRules();
  } catch (error) {
    updateDegreeStatus(`Unable to save locally: ${error.message}`);
  }
}

function validHttpUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function ruleSourceMarkup(value) {
  const url = validHttpUrl(value);
  return url ? `<a href="${degreeEscape(url)}" target="_blank" rel="noopener noreferrer">Open entered source</a>` : 'No source URL entered';
}

function gradeValue(grade) {
  const match = String(grade || '').trim().toUpperCase().match(/^[A-F][+-]?$/);
  if (!match) return null;
  const ranks = { A: 4, B: 3, C: 2, D: 1, F: 0 };
  return ranks[match[0][0]];
}

function auditItemCountsForRule(item, rule) {
  if (item.status !== 'Met' || !item.requirementIds?.includes(rule.id)) return false;
  if (item.code && !ruleCodes(rule).includes(item.code)) return false;
  if (rule.sectionRange && !sectionInRange(item.section, rule.sectionRange)) return false;
  if (rule.attribute && !String(item.attribute || '').toLowerCase().includes(rule.attribute.toLowerCase())) return false;
  if (rule.minimumGrade) {
    const grade = gradeValue(item.grade), minimum = gradeValue(rule.minimumGrade);
    if (grade == null || minimum == null || grade < minimum) return false;
  }
  return true;
}

function matchingAuditItems(rule) {
  return degreeState.data.audit.courses.filter(item => auditItemCountsForRule(item, rule));
}

function renderRules() {
  const root = degreeElement('#degree-rules');
  const rules = degreeState.data.rules;
  const picker = degreeElement('#degree-picker-rule');
  const selectedRule = picker.value;
  picker.innerHTML = rules.length
    ? `<option value="">Choose a requirement</option>${rules.map(rule => `<option value="${degreeEscape(rule.id)}">${degreeEscape(rule.name)} · ${degreeEscape((rule.courseCodes || []).join(', '))}</option>`).join('')}`
    : '<option value="">Add a rule first</option>';
  if (rules.some(rule => rule.id === selectedRule)) picker.value = selectedRule;
  if (!rules.length) {
    root.innerHTML = '<p class="empty">No requirement rules are saved. Add rules from a catalog/advising source, or import a reviewed CSV/TSV.</p>';
    return;
  }
  const groupMap = new Map();
  for (const rule of rules) {
    if (!rule.track) continue;
    const group = groupMap.get(rule.track) || { rules: [], target: 1 };
    group.rules.push(rule);
    group.target = Math.max(group.target, Number(rule.trackTarget) || 1);
    groupMap.set(rule.track, group);
  }
  const groups = [...groupMap].map(([name, group]) => {
    const metTracks = group.rules.filter(rule => matchingAuditItems(rule).length).length;
    return `<p class="degree-rule-summary"><strong>${degreeEscape(name)} coverage:</strong> ${metTracks} of ${group.target} required track buckets show a confirmed audit match. This is based only on rows you imported and mapped.</p>`;
  }).join('');
  root.innerHTML = `<h4>Saved rules for ${degreeEscape(degreeState.data.profile.catalogYear || 'unspecified catalog year')}</h4>${groups}${rules.map(rule => {
    const met = matchingAuditItems(rule);
    const mismatch = degreeState.data.profile.catalogYear && rule.catalogYear && rule.catalogYear !== degreeState.data.profile.catalogYear;
    const status = !degreeState.data.audit.importedAt ? 'No audit snapshot imported' : met.length ? `${met.length} confirmed audit row(s) marked Met and matching the entered rule conditions` : 'No confirmed Met row matches this rule’s entered conditions';
    const constraints = [rule.sectionRange ? `Section ${rule.sectionRange}` : '', rule.attribute ? `Attribute: ${rule.attribute}` : '', rule.minimumGrade ? `Minimum grade ${rule.minimumGrade}` : '', rule.prerequisites ? `Prerequisite note: ${rule.prerequisites}` : ''].filter(Boolean).join(' · ') || 'No section-specific condition entered';
    return `<article class="degree-rule-card"><h4>${degreeEscape(rule.name)} <span class="degree-badge">${degreeEscape(rule.kind)}</span></h4><p class="degree-rule-summary">Courses: ${degreeEscape(rule.courseCodes.join(', '))} · ${degreeEscape(constraints)}</p><p class="degree-rule-summary">Catalog year: ${degreeEscape(rule.catalogYear || 'not set')}${mismatch ? ' · Does not match current program catalog year' : ''} · Source: ${ruleSourceMarkup(rule.source)}</p><p>${degreeEscape(status)}. ${rule.track ? `Track group: ${degreeEscape(rule.track)}.` : ''}</p><button class="button secondary remove-degree-rule" type="button" data-rule-id="${degreeEscape(rule.id)}" aria-label="Remove requirement rule ${degreeEscape(rule.name)}">Remove rule</button></article>`;
  }).join('')}`;
}

function renderPlan() {
  const plan = degreeState.data.plan;
  const controls = degreeElement('#degree-plan-controls');
  const rows = degreeElement('#degree-plan-courses');
  const statusText = plan.locked ? 'User-marked approved and locked' : plan.status === 'revision-required' ? 'Revision draft; reapproval is required' : 'Draft; not marked approved';
  controls.innerHTML = `<p><strong>Plan state:</strong> ${degreeEscape(statusText)}${plan.source ? ` · Source: ${degreeEscape(plan.source)}` : ''}${plan.importedAt ? ` · Imported ${degreeEscape(new Date(plan.importedAt).toLocaleString())}` : ''}</p><p class="degree-rule-summary">An approval mark is your local note, not a Howdy verification. Previous approved rows are retained when a revision starts.</p><div class="degree-actions">${plan.locked ? '<button class="button secondary" id="start-degree-revision" type="button">Start a revision</button>' : '<button class="button" id="mark-degree-approved" type="button">Mark this plan approved and lock it</button>'}${plan.pending ? '<button class="button" id="apply-degree-revision" type="button">Apply confirmed revision draft</button>' : ''}${plan.approvedCourses.length && !plan.locked ? '<button class="button secondary" id="restore-approved-degree-plan" type="button">Restore prior approved plan</button>' : ''}</div>${plan.pending ? `<p class="degree-rule-summary">${plan.pending.courses.length} confirmed revision rows are waiting to apply. ${degreeEscape(plan.pending.source)}. The current plan remains unchanged until you apply.</p>` : ''}`;
  if (!plan.courses.length) {
    rows.innerHTML = '<p class="empty">No plan rows are saved. Import a local plan, then review and confirm each row.</p>';
    return;
  }
  rows.innerHTML = `<h4>Current plan rows (${plan.courses.length})</h4>${plan.courses.map(item => {
    const requirementNames = (item.requirementIds || []).map(id => degreeState.data.rules.find(rule => rule.id === id)?.name).filter(Boolean);
    return `<article class="degree-rule-card degree-plan-card"><h4>${degreeEscape(item.code)}${item.section ? ` · Section ${degreeEscape(item.section)}` : ''}${item.term ? ` · ${degreeEscape(item.term)}` : ''}</h4><p>${degreeEscape(item.label || 'Title not listed')} · Imported plan state is not audit completion.</p>${item.requirementLabel ? `<p class="degree-rule-summary">Imported requirement tag: ${degreeEscape(item.requirementLabel)}</p>` : ''}<p class="degree-rule-summary">Confirmed rule links: ${degreeEscape(requirementNames.join(', ') || 'None')} · Grade: ${degreeEscape(item.grade || 'Not listed')}</p><div class="degree-inline"><label>Plan state <select data-plan-status="${degreeEscape(item.id)}" ${plan.locked ? 'disabled' : ''}>${statusOptions(planStatuses, item.status)}</select></label>${plan.locked ? '' : `<button class="button secondary remove-plan-course" type="button" data-plan-id="${degreeEscape(item.id)}" aria-label="Remove ${degreeEscape(item.code)} from the local plan">Remove row</button>`}</div></article>`;
  }).join('')}`;
}

function renderAudit() {
  const audit = degreeState.data.audit;
  const root = degreeElement('#degree-audit-state');
  if (!audit.importedAt || !audit.courses.length) {
    root.innerHTML = '<p class="empty">No audit snapshot is saved. Importing an audit will not change the plan or any registration holds.</p>';
    return;
  }
  root.innerHTML = `<h4>Current audit snapshot (${audit.courses.length} confirmed rows)</h4><p class="degree-rule-summary">${degreeEscape(audit.source)} · Imported ${degreeEscape(new Date(audit.importedAt).toLocaleString())} · ${audit.history.length} prior local snapshot(s) retained. Only rows marked Met, mapped to a rule, and matching its entered course, section, attribute, and grade conditions count toward its display.</p>${audit.courses.map(item => {
    const id = degreeEscape(item.id);
    return `<article class="degree-rule-card" data-audit-item="${id}">
      <h4>${degreeEscape(item.code || item.label || 'Requirement row')}${item.section ? ` · Section ${degreeEscape(item.section)}` : ''}${item.term ? ` · ${degreeEscape(item.term)}` : ''}</h4>
      <p>${degreeEscape(item.label || 'No title or requirement text listed')}</p>
      ${item.requirementLabel ? `<p class="degree-rule-summary">Imported requirement tag: ${degreeEscape(item.requirementLabel)}</p>` : ''}
      <div class="degree-grid">
        <div class="field"><label for="audit-status-${id}">Audit result</label><select id="audit-status-${id}" data-audit-status="${id}">${statusOptions(auditStatuses, auditStatuses.includes(item.status) ? item.status : 'Needs review')}</select></div>
        <div class="field"><label for="audit-grade-${id}">Grade, if shown</label><input id="audit-grade-${id}" data-audit-grade="${id}" value="${degreeEscape(item.grade)}"></div>
        <div class="field"><label for="audit-section-${id}">Section, if shown</label><input id="audit-section-${id}" data-audit-section="${id}" value="${degreeEscape(item.section)}"></div>
        <div class="field"><label for="audit-attribute-${id}">Section attribute, if shown</label><input id="audit-attribute-${id}" data-audit-attribute="${id}" value="${degreeEscape(item.attribute)}"></div>
      </div>
      ${degreeState.data.rules.length ? `<fieldset><legend>Requirement links (confirm each; double-count only when the source permits it)</legend>${degreeState.data.rules.map(rule => `<label class="check"><input type="checkbox" data-audit-rule="${id}" value="${degreeEscape(rule.id)}" ${(item.requirementIds || []).includes(rule.id) ? 'checked' : ''}> <span>${degreeEscape(rule.name)} · ${degreeEscape(rule.kind)}</span></label>`).join('')}</fieldset>` : '<p class="degree-rule-summary">Add requirement rules to map this audit row.</p>'}
    </article>`;
  }).join('')}`;
}

function parseSectionRange(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  return text.split(',').map(part => part.trim()).map(part => {
    const match = part.match(/^(\d{1,4}[A-Z]?)(?:\s*-\s*(\d{1,4}[A-Z]?))?$/i);
    if (!match) return null;
    const start = Number.parseInt(match[1], 10);
    const end = Number.parseInt(match[2] || match[1], 10);
    return end >= start ? { start, end } : null;
  });
}

function sectionInRange(section, range) {
  if (!range) return true;
  const parts = parseSectionRange(range);
  if (!parts.length || parts.some(part => !part)) return false;
  const number = Number.parseInt(String(section || '').match(/^\d{1,4}/)?.[0] || '', 10);
  return Number.isFinite(number) && parts.some(part => number >= part.start && number <= part.end);
}

function createRule(values) {
  const codes = courseCodes(values.courseCodes);
  if (!values.name.trim()) throw Error('Enter a requirement or bucket name.');
  if (!codes.length) throw Error('Enter at least one valid course code, such as SUBJ 101.');
  if (values.sectionRange && parseSectionRange(values.sectionRange).some(part => !part)) throw Error('Section ranges must use numbers such as 501-505, separated by commas.');
  const source = values.source.trim();
  if (source && !validHttpUrl(source)) throw Error('Rule source must be an http or https URL.');
  const minimumGrade = values.minimumGrade.toUpperCase();
  if (minimumGrade && !['A', 'B', 'C', 'D'].includes(minimumGrade)) throw Error('Choose a valid minimum grade.');
  return {
    id: newDegreeId(), name: values.name.trim(), kind: degreeKinds.includes(values.kind) ? values.kind : 'Other',
    courseCodes: codes, sectionRange: values.sectionRange.trim(), attribute: values.attribute.trim(),
    track: values.track.trim(), trackTarget: Math.max(1, Number(values.trackTarget) || 1), minimumGrade,
    prerequisites: values.prerequisites.trim(), source, catalogYear: values.catalogYear || '', createdAt: new Date().toISOString()
  };
}

function manualRuleFromForm() {
  return createRule({
    name: degreeElement('#degree-rule-name').value, kind: degreeElement('#degree-rule-kind').value,
    courseCodes: degreeElement('#degree-rule-codes').value, sectionRange: degreeElement('#degree-rule-section-range').value,
    attribute: degreeElement('#degree-rule-attribute').value, track: degreeElement('#degree-rule-track').value,
    trackTarget: degreeElement('#degree-rule-target').value, minimumGrade: degreeElement('#degree-rule-min-grade').value,
    prerequisites: degreeElement('#degree-rule-prerequisite').value, source: degreeElement('#degree-rule-source').value,
    catalogYear: degreeState.data.profile.catalogYear
  });
}

function parseRuleSheet(text) {
  const rows = readDelimited(text);
  if (rows.length < 2) throw Error('Use a CSV or TSV with a header row and at least one rule.');
  const headers = rows[0];
  const col = names => findColumn(headers, names);
  const nameCol = col(['name', 'requirement', 'bucket', 'rule name']);
  const kindCol = col(['kind', 'type', 'requirement type']);
  const codesCol = col(['courses', 'course codes', 'course', 'codes']);
  if (nameCol < 0 || codesCol < 0) throw Error('Rule sheet needs name and courses columns.');
  return rows.slice(1).map((values, index) => {
    const valueAt = names => { const i = col(names); return i < 0 ? '' : (values[i] || ''); };
    const raw = values.join(' | ');
    try {
      const rule = createRule({
        name: values[nameCol] || '', kind: kindCol >= 0 ? values[kindCol] : 'Other', courseCodes: values[codesCol] || '',
        sectionRange: valueAt(['section range', 'sections', 'section numbers']), attribute: valueAt(['required attribute', 'section attribute', 'attribute']),
        track: valueAt(['track', 'coverage group', 'group']), trackTarget: valueAt(['track target', 'required tracks', 'group target']) || 1,
        minimumGrade: valueAt(['minimum grade', 'min grade']), prerequisites: valueAt(['prerequisites', 'prerequisite', 'advisor note']),
        source: valueAt(['source', 'source url', 'catalog source']) || degreeState.data.profile.catalogSource,
        catalogYear: valueAt(['catalog year', 'year']) || degreeState.data.profile.catalogYear
      });
      return { id: `rule-${index}`, rule, raw, error: '' };
    } catch (error) {
      return { id: `rule-${index}`, rule: null, raw, error: error.message };
    }
  });
}

function renderRulePreview() {
  const root = degreeElement('#degree-rules-preview');
  degreeElement('#confirm-degree-rules').hidden = !degreeState.rulePreview.length;
  root.innerHTML = degreeState.rulePreview.map((item, index) => `<article class="degree-import-row"><label class="check"><input type="checkbox" data-rule-include="${index}" ${item.error ? 'disabled' : ''}> <span>Confirm and add this rule</span></label><h4>${degreeEscape(item.rule?.name || 'Rule row needs correction')}</h4><p class="degree-rule-summary">${degreeEscape(item.rule ? `${item.rule.kind} · ${item.rule.courseCodes.join(', ')} · catalog year ${item.rule.catalogYear || 'not set'}` : item.error)}</p><p class="degree-rule-summary">${degreeEscape(item.raw)}</p></article>`).join('');
}

function addRuleFromSheet() {
  const selected = [...degreeElement('#degree-rules-preview').querySelectorAll('[data-rule-include]:checked')];
  if (!selected.length) { updateDegreeStatus('Select and confirm at least one valid rule row.'); return; }
  for (const checkbox of selected) {
    const item = degreeState.rulePreview[Number(checkbox.dataset.ruleInclude)];
    if (item?.rule) degreeState.data.rules.push(item.rule);
  }
  degreeState.rulePreview = [];
  degreeElement('#degree-rules-preview').replaceChildren();
  degreeElement('#confirm-degree-rules').hidden = true;
  saveDegreeWorkspace().then(() => renderRules()).catch(error => updateDegreeStatus(`Unable to save rules: ${error.message}`));
}


async function renderDegreeSections() {
  const run = ++degreeState.pickerRun;
  const rule = degreeState.data.rules.find(item => item.id === degreeElement('#degree-picker-rule').value);
  const term = degreeElement('#term')?.value;
  const status = degreeElement('#degree-picker-status');
  const results = degreeElement('#degree-picker-results');
  if (!rule) { status.textContent = 'Choose a requirement rule first.'; return; }
  if (!term) { status.textContent = 'Choose one term in the course search controls first.'; return; }
  if (!rule.courseCodes.length) { status.textContent = 'This rule has no course codes. Add codes before searching sections.'; return; }
  status.textContent = 'Loading public sections for this requirement...';
  results.replaceChildren();
  try {
    const groups = await Promise.all(rule.courseCodes.map(async code => {
      const match = code.match(/^([A-Z]{2,8})\s+(\d{3,4}[A-Z]?)$/);
      const sections = [];
      let offset = 0;
      while (true) {
        const query = new URLSearchParams({ term, subject: match[1], course: match[2], campus: 'College Station', limit: '250', offset: String(offset) });
        const response = await fetch(`/api/sections?${query}`);
        if (!response.ok) throw Error(`Section lookup failed (${response.status}).`);
        const page = (await response.json()).sections || [];
        sections.push(...page);
        offset += page.length;
        if (page.length < 250) break;
      }
      return { code, sections };
    }));
    if (run !== degreeState.pickerRun) return;
    const all = groups.flatMap(group => group.sections.map(section => ({ code: group.code, section })));
    if (!all.length) {
      status.textContent = `No public College Station sections found for ${rule.courseCodes.join(', ')} in ${term}.`;
      return;
    }
    const rows = all.map(({ code, section }) => {
      const rangeOk = !rule.sectionRange || sectionInRange(section.section, rule.sectionRange);
      const attributeOk = !rule.attribute || String(section.attributes || '').toLowerCase().includes(rule.attribute.toLowerCase());
      const fits = rangeOk && attributeOk;
      const unchecked = [rule.minimumGrade ? `minimum grade ${rule.minimumGrade}` : '', rule.prerequisites ? `prerequisite note: ${rule.prerequisites}` : ''].filter(Boolean);
      const baseExplanation = fits
        ? rule.sectionRange || rule.attribute ? 'Course code and entered section constraints match. Confirm official applicability.' : 'Course code matches. Review catalog and advising details before relying on this rule.'
        : `Does not meet entered condition: ${!rangeOk ? `section must be ${rule.sectionRange}` : ''}${!rangeOk && !attributeOk ? '; ' : ''}${!attributeOk ? `attribute must include “${rule.attribute}”` : ''}.`;
      const explanation = `${baseExplanation}${unchecked.length ? ` Also check the rule's ${unchecked.join(' and ')} separately.` : ''}`;
      const meetings = (section.meetings || []).map(meeting => `${meeting.days || 'No day'} ${meeting.begin ? `${meeting.begin}-${meeting.end || ''}` : 'time not listed'}${meeting.building ? ` · ${meeting.building} ${meeting.room || ''}` : ''}`).join(' · ') || 'Meeting details not listed';
      const availability = section.open_flag === 'Y' ? 'Public open flag; no numeric seat count' : section.open_flag === 'N' ? 'Public closed flag; no numeric seat count' : 'Availability not reported';
      const selected = window.asbHasScheduleCrn?.(code, section.crn) || false;
      const choiceButton = fits ? `<button class="button secondary add-degree-course" type="button" data-course="${degreeEscape(code)}" data-crn="${degreeEscape(section.crn)}" aria-pressed="${selected}">${selected ? 'Remove this CRN from schedule choices' : 'Use this matching CRN in schedule choices'}</button>` : '<p class="degree-rule-summary">This section is not offered as a schedule choice because it does not match the entered rule constraints.</p>';
      return `<article class="degree-section-card"><h4>${degreeEscape(code)} · Section ${degreeEscape(section.section)} · CRN ${degreeEscape(section.crn)}</h4><p>${degreeEscape(section.title)} · ${degreeEscape(section.schedule_type || 'Type not listed')} · ${degreeEscape(section.instructors?.join(', ') || 'Instructor not listed')}</p><p>${degreeEscape(meetings)}</p><p class="degree-rule-summary">${degreeEscape(explanation)} Source: ${degreeEscape(section.source)} · Updated ${degreeEscape(section.updated_at ? new Date(section.updated_at * 1000).toLocaleString() : 'not listed')} · ${degreeEscape(availability)}</p>${choiceButton}</article>`;
    }).join('');
    results.innerHTML = rows;
    status.textContent = `${all.length} public sections found. Section matches are guidance, not an official audit or eligibility result.`;
  } catch (error) {
    if (run === degreeState.pickerRun) status.textContent = `Unable to load public sections: ${error.message}`;
  }
}

function renderAllDegree() {
  const profile = degreeState.data.profile;
  degreeElement('#degree-program').value = profile.program || '';
  degreeElement('#degree-catalog-year').value = profile.catalogYear || '';
  degreeElement('#degree-catalog-source').value = profile.catalogSource || '';
  renderRules(); renderPlan(); renderAudit();
}

function attachDegreeEvents() {
  degreeElement('#save-degree-profile').addEventListener('click', async () => {
    const profile = {
      program: degreeElement('#degree-program').value.trim(),
      catalogYear: degreeElement('#degree-catalog-year').value.trim(),
      catalogSource: degreeElement('#degree-catalog-source').value.trim()
    };
    if (profile.catalogSource && !validHttpUrl(profile.catalogSource)) {
      degreeElement('#degree-profile-status').textContent = 'Use an http or https catalog source URL.';
      degreeElement('#degree-catalog-source').focus(); return;
    }
    const changed = JSON.stringify(profile) !== JSON.stringify(degreeState.data.profile);
    degreeState.data.profile = profile;
    if (changed && degreeState.data.plan.locked) {
      degreeState.data.plan.locked = false;
      degreeState.data.plan.status = 'revision-required';
    }
    try {
      await saveDegreeWorkspace();
      degreeElement('#degree-profile-status').textContent = changed ? 'Program details saved. Review rule catalog years and the plan approval state.' : 'Program details saved in this browser.';
      renderPlan(); renderRules();
    } catch (error) { degreeElement('#degree-profile-status').textContent = `Unable to save locally: ${error.message}`; }
  });
  degreeElement('#add-degree-rule').addEventListener('click', async () => {
    try {
      degreeState.data.rules.push(manualRuleFromForm());
      await saveDegreeWorkspace();
      for (const id of ['degree-rule-name','degree-rule-codes','degree-rule-section-range','degree-rule-attribute','degree-rule-track','degree-rule-prerequisite','degree-rule-source']) degreeElement(`#${id}`).value = '';
      degreeElement('#degree-rule-min-grade').value = '';
      degreeElement('#degree-rule-target').value = '1';
      renderRules(); renderAudit();
    } catch (error) { updateDegreeStatus(`Unable to add rule: ${error.message}`); }
  });
  degreeElement('#degree-rules-file').addEventListener('change', async event => {
    const file = event.currentTarget.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { updateDegreeStatus('Rule sheet is larger than 5 MB.'); return; }
    degreeElement('#degree-rules-text').value = await file.text();
    updateDegreeStatus('Rule sheet loaded into this browser. Preview and confirm the rows you want to save.');
  });
  degreeElement('#preview-degree-rules').addEventListener('click', () => {
    try {
      degreeState.rulePreview = parseRuleSheet(degreeElement('#degree-rules-text').value);
      renderRulePreview();
      updateDegreeStatus(`${degreeState.rulePreview.length} requirement rows ready for review. No rules are saved until you confirm them.`);
    } catch (error) { updateDegreeStatus(`Unable to preview rules: ${error.message}`); }
  });
  degreeElement('#confirm-degree-rules').addEventListener('click', addRuleFromSheet);
  degreeElement('#degree-rules').addEventListener('click', async event => {
    const button = event.target.closest('.remove-degree-rule');
    if (!button) return;
    const rule = degreeState.data.rules.find(item => item.id === button.dataset.ruleId);
    if (!rule || !window.confirm(`Remove the rule “${rule.name}”? Existing plan and audit links will be kept but will no longer resolve.`)) return;
    degreeState.data.rules = degreeState.data.rules.filter(item => item.id !== rule.id);
    try { await saveDegreeWorkspace(); renderRules(); renderAudit(); degreeElement('#add-degree-rule').focus(); }
    catch (error) { updateDegreeStatus(`Unable to remove rule: ${error.message}`); }
  });
  degreeElement('#preview-degree-plan').addEventListener('click', () => previewAcademicImport('plan'));
  degreeElement('#preview-degree-audit').addEventListener('click', () => previewAcademicImport('audit'));
  degreeElement('#confirm-degree-plan').addEventListener('click', () => confirmAcademicImport('plan'));
  degreeElement('#confirm-degree-audit').addEventListener('click', () => confirmAcademicImport('audit'));
  degreeElement('#degree-plan-preview').addEventListener('input', event => {
    const row = event.target.closest('[data-degree-import-row]');
    if (!row) return;
    const index = Number(row.dataset.degreeImportRow);
    const preview = degreeState.planPreview;
    if (preview?.rows[index]) {
      preview.rows[index].code = row.querySelector('[data-degree-code]').value;
      preview.rows[index].label = row.querySelector('[data-degree-label]').value;
    }
  });
  degreeElement('#degree-audit-preview').addEventListener('input', event => {
    const row = event.target.closest('[data-degree-import-row]');
    if (!row) return;
    const index = Number(row.dataset.degreeImportRow);
    const preview = degreeState.auditPreview;
    if (preview?.rows[index]) {
      preview.rows[index].code = row.querySelector('[data-degree-code]').value;
      preview.rows[index].label = row.querySelector('[data-degree-label]').value;
    }
  });
  degreeElement('#degree-plan-controls').addEventListener('click', async event => {
    const plan = degreeState.data.plan;
    const id = event.target.id;
    if (id === 'start-degree-revision') {
      plan.locked = false; plan.status = 'revision-required';
    } else if (id === 'mark-degree-approved') {
      if (!plan.courses.length) { updateDegreeStatus('Add at least one confirmed plan row before marking it approved.'); return; }
      plan.approvedCourses = structuredClone(plan.courses); plan.locked = true; plan.status = 'approved';
    } else if (id === 'apply-degree-revision') {
      if (!plan.pending) return;
      plan.courses = plan.pending.courses; plan.source = plan.pending.source; plan.importedAt = plan.pending.importedAt; plan.pending = null;
      plan.locked = false; plan.status = plan.approvedCourses.length ? 'revision-required' : 'draft';
    } else if (id === 'restore-approved-degree-plan') {
      if (!plan.approvedCourses.length || !window.confirm('Restore the prior approved plan rows and discard the current revision?')) return;
      plan.courses = structuredClone(plan.approvedCourses); plan.pending = null; plan.locked = true; plan.status = 'approved';
    } else return;
    try { await saveDegreeWorkspace(); renderPlan(); }
    catch (error) { updateDegreeStatus(`Unable to save plan state: ${error.message}`); }
  });
  degreeElement('#degree-plan-courses').addEventListener('change', async event => {
    const id = event.target.dataset.planStatus;
    if (!id) return;
    const plan = degreeState.data.plan;
    const item = plan.courses.find(course => course.id === id);
    if (!item || plan.locked) return;
    item.status = event.target.value;
    if (plan.approvedCourses.length) plan.status = 'revision-required';
    try { await saveDegreeWorkspace(); renderRules(); }
    catch (error) { updateDegreeStatus(`Unable to save plan row: ${error.message}`); }
  });
  degreeElement('#degree-plan-courses').addEventListener('click', async event => {
    const button = event.target.closest('.remove-plan-course');
    if (!button || degreeState.data.plan.locked) return;
    const plan = degreeState.data.plan;
    plan.courses = plan.courses.filter(item => item.id !== button.dataset.planId);
    if (plan.approvedCourses.length) plan.status = 'revision-required';
    try { await saveDegreeWorkspace(); renderPlan(); renderRules(); }
    catch (error) { updateDegreeStatus(`Unable to remove plan row: ${error.message}`); }
  });
  degreeElement('#degree-audit-state').addEventListener('change', async event => {
    const audit = degreeState.data.audit;
    const itemId = event.target.dataset.auditStatus || event.target.dataset.auditGrade || event.target.dataset.auditSection || event.target.dataset.auditAttribute || event.target.dataset.auditRule;
    if (!itemId) return;
    const item = audit.courses.find(course => course.id === itemId);
    if (!item) return;
    if (event.target.dataset.auditStatus) item.status = event.target.value;
    if (event.target.dataset.auditGrade) item.grade = event.target.value.trim();
    if (event.target.dataset.auditSection) item.section = event.target.value.trim();
    if (event.target.dataset.auditAttribute) item.attribute = event.target.value.trim();
    if (event.target.dataset.auditRule) {
      const ids = new Set(item.requirementIds || []);
      event.target.checked ? ids.add(event.target.value) : ids.delete(event.target.value);
      item.requirementIds = [...ids];
    }
    try { await saveDegreeWorkspace(); renderRules(); }
    catch (error) { updateDegreeStatus(`Unable to save audit row: ${error.message}`); }
  });
  degreeElement('#find-degree-sections').addEventListener('click', renderDegreeSections);
  window.addEventListener('asb-schedule-section-choice-change', event => {
    const { code, crn, included } = event.detail || {};
    for (const button of degreeElement('#degree-picker-results').querySelectorAll('.add-degree-course')) {
      if (button.dataset.course !== code || button.dataset.crn !== crn) continue;
      button.setAttribute('aria-pressed', String(included));
      button.textContent = included ? 'Remove this CRN from schedule choices' : 'Use this matching CRN in schedule choices';
    }
  });
  degreeElement('#degree-picker-results').addEventListener('click', event => {
    const button = event.target.closest('.add-degree-course');
    if (!button || typeof window.asbToggleScheduleCrn !== 'function') return;
    const selected = window.asbToggleScheduleCrn(button.dataset.course, button.dataset.crn);
    button.setAttribute('aria-pressed', String(selected));
    button.textContent = selected ? 'Remove this CRN from schedule choices' : 'Use this matching CRN in schedule choices';
    degreeElement('#schedule-tools').scrollIntoView({ behavior: 'smooth', block: 'start' });
    degreeElement('#schedule-courses').focus();
  });
  degreeElement('#export-degree-data').addEventListener('click', () => {
    const payload = { format: 'asb-degree-workspace', schemaVersion: 1, exportedAt: new Date().toISOString(), state: degreeState.data };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `asb-degree-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    updateDegreeStatus('A local backup was exported. Keep it private; it contains your plan and audit data.');
  });
  degreeElement('#restore-degree-data').addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (backup.format !== 'asb-degree-workspace' || !backup.state) throw Error('This is not an ASB+ degree backup.');
      if (!window.confirm('Replace degree data stored in this browser with this backup?')) return;
      degreeState.data = normalizeDegreeWorkspace(backup.state);
      await saveDegreeWorkspace(); renderAllDegree();
      updateDegreeStatus('Local degree backup restored. Verify its program, rules, plan, and audit data.');
    } catch (error) { updateDegreeStatus(`Unable to restore backup: ${error.message}`); }
    finally { input.value = ''; }
  });
  degreeElement('#delete-degree-data').addEventListener('click', async () => {
    if (!window.confirm('Delete all degree rules, plan rows, audit snapshots, and program details stored in this browser? Export a backup first if you need one.')) return;
    degreeState.data = emptyDegreeWorkspace();
    try {
      const transaction = degreeState.db.transaction(degreeStoreName, 'readwrite');
      transaction.objectStore(degreeStoreName).delete('active');
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
      degreeState.planPreview = null; degreeState.auditPreview = null; degreeState.rulePreview = [];
      degreeElement('#degree-plan-preview').replaceChildren(); degreeElement('#degree-audit-preview').replaceChildren(); degreeElement('#degree-rules-preview').replaceChildren();
      degreeElement('#degree-plan-text').value = ''; degreeElement('#degree-audit-text').value = ''; degreeElement('#degree-rules-text').value = '';
      renderAllDegree(); updateDegreeStatus('All degree data was deleted from this browser.');
    } catch (error) { updateDegreeStatus(`Unable to delete local data: ${error.message}`); }
  });
}

async function initializeDegreePlanner() {
  try {
    degreeState.db = await openDegreeDb();
    degreeState.data = await loadDegreeWorkspace();
    attachDegreeEvents();
    renderAllDegree();
    updateDegreeStatus('Private degree data is stored in this browser only. No degree import is sent to the server.');
  } catch (error) {
    updateDegreeStatus(`Local degree storage is unavailable: ${error.message} Enable IndexedDB in this browser to use degree planning.`);
  }
}

initializeDegreePlanner();
