(() => {
  const overlayAttribute = 'data-asb-plus-overlay';
  const watchKey = 'asbWatchCrns';
  const snapshotKey = 'asbSnapshot';
  const observedKey = 'asbObservedStatuses';
  const alertsKey = 'asbAlerts';
  const alertLimit = 50;
  const seenAlertIds = new Set();
  let queued = false;
  let scanChain = Promise.resolve();
  let watchUpdateChain = Promise.resolve();

  function isVisible(node) {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' &&
      rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
      rect.right > 0 && rect.left < innerWidth;
  }

  function visibleText(node) {
    return `${node.innerText || node.textContent || ''}\n${node.getAttribute('aria-label') || ''}\n${node.getAttribute('title') || ''}`.trim();
  }

  function crnFrom(text) {
    const values = [...new Set(text.match(/\b\d{5}\b/g) || [])];
    return values.length === 1 ? values[0] : '';
  }

  function statusFromVisibleText(value) {
    const chunks = String(value || '').toLowerCase().split(/[\n\t]+/).flatMap(line => line.split(/[|;·]+/)).map(line => line.trim()).filter(Boolean);
    for (const chunk of chunks) {
      const labeled = chunk.match(/^(?:seat status|availability|status|seats?)\s*[:=-]\s*(.+)$/);
      const status = (labeled ? labeled[1] : chunk).trim();
      if (/^(?:full|closed|unavailable|not available|no seats|0 seats?)(?:$|[\s:/-])/.test(status)) return 'closed';
      if (/^(?:open|available)(?:$|[:/-])/.test(status) || /^(?:open|available)\s+(?:seats?|places?|[0-9])/.test(status) || /^[1-9]\d*\s+seats?\s+available\b/.test(status)) return 'open';
    }
    return '';
  }

  function visibleRows() {
    const selectors = 'tr,[role="row"],li,article,[data-testid],[data-test-id],[class*="section"],[class*="Section"]';
    const best = new Map();
    for (const node of document.querySelectorAll(selectors)) {
      if (node.matches(`[${overlayAttribute}]`) || node.closest(`[${overlayAttribute}]`) || !isVisible(node)) continue;
      const text = visibleText(node);
      if (!text || text.length > 1800) continue;
      const crn = crnFrom(text);
      if (!crn) continue;
      const candidate = { node, crn, text, status: statusFromVisibleText(text) };
      const previous = best.get(crn);
      if (!previous || text.length < previous.text.length) best.set(crn, candidate);
    }
    return [...best.values()];
  }

  function formatTime(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return 'time not listed';
    return new Date(value * 1000).toLocaleString();
  }

  function meetingConflicts(left, right) {
    if (!left?.days || !right?.days || !Number.isFinite(left.start) || !Number.isFinite(left.end) ||
        !Number.isFinite(right.start) || !Number.isFinite(right.end)) return false;
    if (left.start >= right.end || right.start >= left.end) return false;
    return [...left.days].some(day => right.days.includes(day));
  }

  function trackedConflictText(section, watchCrns, snapshot) {
    if (!watchCrns.includes(section.crn)) return 'Track this section to compare it with other desired CRNs.';
    const otherCrns = watchCrns.filter(crn => crn !== section.crn);
    if (!otherCrns.length) return 'No other desired CRNs are tracked.';
    if (!snapshot) return 'Conflict check is unavailable until a local section snapshot is imported.';
    const lookup = new Map(snapshot.sections.map(item => [String(item.crn), item]));
    const matches = [];
    let incomplete = section.unknownMeetingBlocks > 0 || !section.meetings.length;
    for (const crn of otherCrns) {
      const other = lookup.get(crn);
      if (!other || other.unknownMeetingBlocks > 0 || !other.meetings.length) {
        incomplete = true;
        continue;
      }
      if (section.meetings.some(left => other.meetings.some(right => meetingConflicts(left, right)))) matches.push(crn);
    }
    if (matches.length) return `Meeting-time conflict with tracked CRN ${matches.join(', ')}.`;
    return incomplete
      ? 'No known overlap found, but some tracked meeting times are missing from the local snapshot.'
      : `No meeting-time overlap with ${otherCrns.length} other tracked CRN(s) in this local snapshot.`;
  }

  function makeElement(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = content;
    return node;
  }

  function addSectionInfo(panel, section, row, watchCrns, snapshot) {
    const title = section ? `${section.courseCode} · Section ${section.section} · CRN ${section.crn}` : `Visible CRN ${row.crn}`;
    panel.append(makeElement('strong', 'heading', title));
    if (section?.title) panel.append(makeElement('p', '', section.title));
    const observed = new Date().toLocaleString();
    panel.append(makeElement('p', 'source', row.status
      ? `Visible Schedule Builder status: ${row.status === 'open' ? 'Open/available' : 'Full/closed'} · observed ${observed}.`
      : `Visible Schedule Builder row · status not recognized · observed ${observed}.`));
    if (section) {
      const flag = section.openFlag === 'Y' ? 'Open' : section.openFlag === 'N' ? 'Closed' : 'Not reported';
      panel.append(makeElement('p', 'source', `Public Howdy flag: ${flag} · ${section.source || 'source not listed'} · updated ${formatTime(section.updatedAt)}. This is not a seat count.`));
      const history = section.historical || {};
      const grades = [];
      if (Number.isFinite(history.averageGpa)) grades.push(`course-level historical GPA ${history.averageGpa.toFixed(2)}`);
      if (Number.isFinite(history.abRate)) grades.push(`A/B share ${history.abRate.toFixed(1)}%`);
      if (history.records) grades.push(`${history.records} historical grade records`);
      panel.append(makeElement('p', '', grades.length
        ? `${grades.join(' · ')} · sources: ${(history.sources || []).join(', ') || 'not listed'} · updated ${formatTime(history.updatedAt)}.`
        : 'No historical course-grade summary is available in this snapshot.'));
      if (section.professors?.length) {
        const details = section.professors.map(item => item.averageGpa == null
          ? `${item.name}: no exact historical grade-name match`
          : `${item.name}: historical GPA ${item.averageGpa.toFixed(2)} from ${item.records} exact-name record(s)`);
        panel.append(makeElement('p', '', `Current instructors: ${details.join('; ')}. RMP ratings are disabled.`));
      } else {
        panel.append(makeElement('p', '', 'Instructor details are not listed in this snapshot. RMP ratings are disabled.'));
      }
      const fits = section.requirementFits || [];
      panel.append(makeElement('p', 'section-label', fits.length ? 'Requirement fit' : 'Requirement fit not listed'));
      for (const fit of fits) {
        panel.append(makeElement('p', fit.matches ? 'fit-match' : 'fit-miss', `${fit.matches ? 'Potential fit' : 'Does not match'}: ${fit.name} (${fit.kind})${fit.track ? ` · Track ${fit.track}` : ''}. ${fit.reason}`));
      }
      panel.append(makeElement('p', 'conflict', trackedConflictText(section, watchCrns, snapshot)));
    } else {
      panel.append(makeElement('p', '', snapshot
        ? 'This CRN is not in the imported snapshot. Add its course to Courses to schedule in ASB+ and import a new file for historical and requirement details.'
        : 'Import a local ASB+ snapshot for historical grade, instructor, and requirement details.'));
    }
  }

  function addWatchButton(panel, crn, watchCrns) {
    const button = makeElement('button', 'watch-button', watchCrns.includes(crn) ? 'Stop tracking this CRN' : 'Track this CRN');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(watchCrns.includes(crn)));
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      watchUpdateChain = watchUpdateChain.then(async () => {
        const current = await chrome.storage.local.get({ [watchKey]: [] });
        const next = new Set((Array.isArray(current[watchKey]) ? current[watchKey] : []).map(String));
        if (next.has(crn)) next.delete(crn); else next.add(crn);
        await chrome.storage.local.set({ [watchKey]: [...next].sort() });
      }).catch(() => {}).finally(queueScan);
    });
    panel.append(button);
  }

  function createPanelHost(row) {
    const node = row.node;
    let host;
    if (node.tagName === 'TR') {
      let sibling = node.nextElementSibling;
      if (sibling?.matches(`tr[${overlayAttribute}]`) && sibling.dataset.crn === row.crn) {
        host = sibling.querySelector(`[${overlayAttribute}]`);
      } else {
        sibling = document.createElement('tr');
        sibling.setAttribute(overlayAttribute, 'true');
        sibling.dataset.crn = row.crn;
        const cell = document.createElement('td');
        cell.colSpan = Math.max(1, node.cells.length);
        host = document.createElement('div');
        host.setAttribute(overlayAttribute, 'true');
        cell.append(host);
        sibling.append(cell);
        node.after(sibling);
      }
    } else {
      host = [...node.children].find(child => child.hasAttribute(overlayAttribute));
      if (!host) {
        host = document.createElement('div');
        host.setAttribute(overlayAttribute, 'true');
        node.append(host);
      }
    }
    return host;
  }

  function renderRow(row, saved) {
    const watchCrns = Array.isArray(saved[watchKey]) ? saved[watchKey].map(String) : [];
    const snapshot = saved[snapshotKey];
    const section = snapshot?.sections?.find(item => String(item.crn) === row.crn) || null;
    const host = createPanelHost(row);
    const signature = JSON.stringify([row.text, row.status, watchCrns, section]);
    if (host.dataset.asbSignature === signature) return;
    host.dataset.asbSignature = signature;
    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.replaceChildren();
    const style = document.createElement('style');
    style.textContent = ':host{display:block;margin:5px 0;color:#202522;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}.panel{display:grid;gap:4px;padding:9px 11px;border:1px solid #d7dcd3;border-inline-start:4px solid #500000;border-radius:6px;background:#fff}.panel p{margin:0}.heading{color:#500000}.source{color:#525c55;font-size:12px}.section-label{margin-top:3px!important;font-weight:750}.fit-match{color:#286248}.fit-miss{color:#805c18}.conflict{font-weight:700}.watch-button{justify-self:start;min-height:34px;margin-top:3px;padding:5px 10px;border:1px solid #500000;border-radius:5px;background:#fff;color:#500000;font:inherit;font-weight:700;cursor:pointer}.watch-button:focus-visible{outline:3px solid #b46a20;outline-offset:2px}';
    const panel = document.createElement('div');
    panel.className = 'panel';
    addSectionInfo(panel, section, row, watchCrns, snapshot);
    addWatchButton(panel, row.crn, watchCrns);
    shadow.append(style, panel);
  }

  function noticeRoot() {
    let host = document.querySelector('#asb-plus-notices');
    if (host) return host.shadowRoot;
    host = document.createElement('div');
    host.id = 'asb-plus-notices';
    document.documentElement.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial;position:fixed;inset-block-start:12px;inset-inline-end:12px;z-index:2147483647;width:min(360px,calc(100vw - 24px));font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#202522}.notices{display:grid;gap:7px}.notice{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 8px;padding:11px 13px;border:1px solid #286248;border-inline-start:5px solid #286248;border-radius:7px;background:#fff;box-shadow:0 5px 20px #0003}.notice strong{color:#286248}.notice span{grid-column:1}.dismiss{grid-column:2;grid-row:1/3;align-self:start;min-height:30px;padding:3px 7px;border:1px solid #d7dcd3;border-radius:4px;background:#fff;color:#202522;font:inherit;font-size:12px;cursor:pointer}.dismiss:focus-visible{outline:3px solid #b46a20;outline-offset:2px}';
    const list = document.createElement('div');
    list.className = 'notices';
    list.setAttribute('role', 'status');
    list.setAttribute('aria-live', 'polite');
    shadow.append(style, list);
    return shadow;
  }

  function showAlert(alert) {
    if (!alert?.id || seenAlertIds.has(alert.id)) return;
    seenAlertIds.add(alert.id);
    const root = noticeRoot();
    const list = root.querySelector('.notices');
    const card = document.createElement('div');
    card.className = 'notice';
    card.append(makeElement('strong', '', alert.kind === 'visible-transition' ? 'Visible seat status changed' : 'Public open flag changed'));
    card.append(makeElement('span', '', alert.message));
    const dismiss = makeElement('button', 'dismiss', 'Dismiss');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', `Dismiss alert for CRN ${alert.crn}`);
    dismiss.addEventListener('click', () => card.remove());
    card.append(dismiss);
    list.prepend(card);
    while (list.children.length > 4) list.lastElementChild.remove();
  }

  async function scan() {
    if (document.visibilityState !== 'visible') return;
    const saved = await chrome.storage.local.get({ [watchKey]: [], [snapshotKey]: null, [observedKey]: {}, [alertsKey]: [] });
    const watched = new Set((Array.isArray(saved[watchKey]) ? saved[watchKey] : []).map(String));
    const observed = { ...(saved[observedKey] || {}) };
    let changed = false;
    const newAlerts = [];
    for (const row of visibleRows()) {
      renderRow(row, saved);
      if (!row.status) continue;
      const previous = observed[row.crn];
      if (watched.has(row.crn) && previous === 'closed' && row.status === 'open') {
        const alert = {
          id: `${Date.now()}-${row.crn}-${Math.random().toString(16).slice(2)}`,
          kind: 'visible-transition', crn: row.crn,
          message: `Tracked CRN ${row.crn} changed from full/closed to open in the visible Schedule Builder page. Observed ${new Date().toLocaleString()}.`,
          observedAt: new Date().toISOString()
        };
        newAlerts.push(alert);
        showAlert(alert);
      }
      if (previous !== row.status) { observed[row.crn] = row.status; changed = true; }
    }
    if (changed || newAlerts.length) {
      const oldAlerts = Array.isArray(saved[alertsKey]) ? saved[alertsKey] : [];
      await chrome.storage.local.set({
        [observedKey]: Object.fromEntries(Object.entries(observed).slice(-1000)),
        [alertsKey]: [...oldAlerts, ...newAlerts].slice(-alertLimit)
      });
    }
  }

  function queueScan() {
    if (queued || document.visibilityState !== 'visible') return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scanChain = scanChain.then(scan).catch(() => {});
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[watchKey] || changes[snapshotKey]) queueScan();
    if (changes[alertsKey]) {
      const before = new Set((changes[alertsKey].oldValue || []).map(alert => alert.id));
      for (const alert of changes[alertsKey].newValue || []) if (!before.has(alert.id)) showAlert(alert);
    }
  });

  const observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title'] });
  document.addEventListener('visibilitychange', queueScan);
  queueScan();
})();
