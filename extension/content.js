(() => {
  'use strict';

  const TERM = '202711';
  const TERM_LABEL = 'Spring 2027 - College Station';
  const STORAGE = { saved: 'asbWatchCrns', snapshot: 'asbSnapshot', courses: 'asbRebuildCourses', enabled: 'asbRebuildEnabled' };
  const HOST_ID = 'asb-rebuild-host';
  const ACTIVE_ATTR = 'data-asb-rebuild-active';
  const app = document.querySelector('#scheduler-app');
  let main = app?.querySelector('main');
  let nativeNav = app?.querySelector('nav.navbar-fixed-top');
  const state = {
    enabled: true, active: false, pageTerm: '', backend: null, saved: [], courses: [], results: [],
    courseSections: new Map(), savedSections: new Map(), visibleRows: new Map(), query: '', offset: 0,
    hasMore: false, truncated: false, loading: false, searchSequence: 0, searchTimer: 0, openFilter: 'all', searchMode: 'text',
    scheduleResults: [], selectedHandoff: [], status: '', currentView: 'find', scrollY: 0, fallback: '', opening: false, lastHealth: '', lastRoute: '', suppressRoute: '',
  };
  let host;
  let shadow;
  let pageObserver;
  let pageChangeTimer = 0;

  const styleText = `
    :host{all:initial;color:#29231f;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-kerning:normal;color-scheme:light;pointer-events:none}
    *{box-sizing:border-box}button,input,select,textarea{font:inherit}button,a{touch-action:manipulation}
    .launcher{position:fixed;right:18px;bottom:18px;z-index:3;display:flex;align-items:center;gap:10px;padding:8px 13px;border:1px solid #6b1018;border-radius:4px;background:#6b1018;color:#fff;box-shadow:0 4px 14px #221b1830;cursor:pointer;font-weight:700;min-height:44px;pointer-events:auto}
    .launcher:hover{background:#531018}.launcher:focus-visible,button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #b56b28;outline-offset:2px}
    .workspace{position:fixed;inset:50px 0 0;z-index:2;display:grid;grid-template-rows:auto auto minmax(0,1fr);background:#f8f6f2;color:#29231f;box-shadow:0 6px 24px #211a1630;pointer-events:auto}
    .masthead{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px clamp(14px,2vw,30px);border-bottom:1px solid #d8d0c7;background:#fff}
    .brand{display:flex;align-items:center;gap:12px;min-width:0}.mark{display:grid;place-items:center;width:32px;height:32px;background:#6b1018;color:white;font-weight:800;letter-spacing:-.06em}.brand-name{margin:0;font-size:16px;font-weight:800;letter-spacing:-.03em}.brand-sub{margin:1px 0 0;color:#5d534b;font-size:12px}.term{font-size:12px;color:#51483f;white-space:nowrap;font-variant-numeric:tabular-nums}
    .native-button,.primary,.secondary,.quiet-button,.tab{border:1px solid #8f8176;border-radius:3px;background:#fff;color:#302922;cursor:pointer;min-height:40px;padding:8px 12px;font-weight:650}.native-button:hover,.secondary:hover,.quiet-button:hover,.tab:hover{background:#f0ebe5}.primary{border-color:#6b1018;background:#6b1018;color:#fff}.primary:hover{background:#531018}.secondary[aria-pressed=true],.tab[aria-pressed=true]{border-color:#6b1018;color:#6b1018;background:#f5e9e7}
    .fallback-notice{position:fixed;right:18px;bottom:76px;z-index:3;max-width:min(560px,calc(100vw - 36px));box-shadow:0 3px 12px #211a1620}
    .workspace .fallback-notice{position:static;max-width:none;box-shadow:none}
    button:disabled{opacity:.55;cursor:not-allowed}.navrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px clamp(14px,2vw,30px);border-bottom:1px solid #d8d0c7;background:#f1ede7}.tabs{display:flex;gap:6px;flex-wrap:wrap}.tab{min-width:100px}.status{margin:0;color:#534a42;font-size:12px}.content{min-height:0;overflow:auto;padding:16px clamp(14px,2vw,30px) 28px}.view[hidden]{display:none}.searchbar{display:grid;grid-template-columns:minmax(220px,1fr) auto auto;gap:8px;margin-bottom:12px}.search-input{width:100%;min-height:44px;border:1px solid #8f8176;border-radius:3px;padding:9px 12px;background:#fff;color:#29231f}.section-list{display:grid;gap:8px;max-width:1240px}.section-card{display:grid;grid-template-columns:minmax(220px,1.1fr) minmax(260px,1.5fr) minmax(180px,.9fr) auto;align-items:start;gap:8px 18px;padding:12px 14px;border:1px solid #d8d0c7;background:#fff}.section-card:hover{border-color:#a89a8f}.section-main,.section-context{min-width:0}.section-card h3{margin:0;font-size:15px;line-height:1.25;color:#2f2822}.code{color:#6b1018;font-variant-numeric:tabular-nums}.title{margin:3px 0 0;color:#5d534b;overflow-wrap:anywhere}.meta,.meetings,.evidence,.muted{margin:4px 0 0;color:#5d534b;font-size:12px;overflow-wrap:anywhere}.meetings{color:#302922}.flag{display:inline-flex;align-items:center;gap:5px;width:max-content;max-width:100%;padding:3px 7px;border:1px solid #a99d91;border-radius:2px;color:#453a31;font-size:11px;font-weight:750}.flag-open{border-color:#477057;color:#214d34;background:#edf5ee}.flag-closed{border-color:#985c58;color:#722923;background:#f8eeec}.flag-unknown{background:#f3efe9}.actions{display:flex;justify-content:flex-end;align-items:center;gap:6px;flex-wrap:wrap}.actions button{min-height:38px;padding:6px 9px}.rmp-link{display:inline-block;color:#6b1018;font-weight:700;text-decoration:underline;text-underline-offset:2px}.subhead{display:flex;justify-content:space-between;align-items:end;gap:12px;margin:0 0 12px}.subhead h2{margin:0;font-size:20px;letter-spacing:-.03em}.subhead p{margin:4px 0 0;color:#5d534b}.empty{max-width:760px;padding:24px;border-inline-start:3px solid #6b1018;background:#fff}.course-block{margin:0 0 18px;padding:0 0 16px;border-bottom:1px solid #d8d0c7}.course-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}.course-head h3{margin:0;color:#6b1018;font-size:16px}.schedule-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:10px}.schedule-card{padding:14px;border:1px solid #c9bdb1;background:#fff}.schedule-card h3{margin:0;font-size:16px}.schedule-card ol{margin:10px 0;padding-inline-start:22px}.schedule-card li{margin:3px 0}.score{color:#6b1018;font-weight:750;font-variant-numeric:tabular-nums}.callout{margin:12px 0;padding:10px 12px;border-inline-start:3px solid #a56a24;background:#f4eee5;color:#463628}.callout.error{border-color:#8b312a;background:#f8edeb}.callout.success{border-color:#477057;background:#edf5ee}.filters{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.handoff{display:grid;grid-template-columns:minmax(280px,1fr) minmax(260px,1fr);gap:20px;max-width:980px}.handoff textarea{display:block;width:100%;min-height:112px;resize:vertical;border:1px solid #8f8176;background:white;color:#29231f;padding:10px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.steps{margin:0;padding-inline-start:22px}.steps li{margin:0 0 8px}.footnote{max-width:1000px;margin:16px 0 0;padding-top:10px;border-top:1px solid #d8d0c7;color:#5d534b;font-size:12px}.statusline{min-height:20px;margin:0;color:#51483f;font-size:12px}.statusline[aria-live]{contain:content}.keyboard{position:absolute;inset-inline-start:-9999px}.keyboard:focus{inset-inline-start:12px;top:8px;z-index:4;background:#fff;padding:8px}
    .searchbar{grid-template-columns:minmax(220px,1fr) minmax(170px,auto) auto auto}
    @media(max-width:900px){.section-card{grid-template-columns:minmax(0,1fr) auto}.section-context{grid-column:1}.actions{grid-column:2;grid-row:1/4}.handoff{grid-template-columns:1fr}}
    @media(max-width:600px){.workspace{inset:50px 0 0}.masthead{align-items:flex-start;flex-wrap:wrap}.term{white-space:normal}.navrow{align-items:flex-start;flex-direction:column}.tabs{width:100%}.tab{flex:1;min-width:0}.searchbar{grid-template-columns:1fr 1fr}.search-input{grid-column:1/-1}.section-card{grid-template-columns:1fr}.section-context,.actions{grid-column:1;grid-row:auto}.actions{justify-content:flex-start}.content{padding:12px}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
  `;

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function button(label, className, action, pressed) {
    const node = el('button', className || 'secondary', label);
    node.type = 'button';
    if (pressed != null) node.setAttribute('aria-pressed', String(pressed));
    node.addEventListener('click', action);
    return node;
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, response => {
          const error = chrome.runtime.lastError;
          if (error) reject(Error(error.message));
          else if (!response || response.ok === false) reject(Error(response?.error || 'The ASB+ service worker did not respond.'));
          else resolve(response);
        });
      } catch (error) { reject(error); }
    });
  }

  function routeSupported() {
    return /^\/terms\/Spring 2027 - College Station\/(?:options|courses\/add|courses\/\d+)$/.test(decodeURIComponent(location.pathname));
  }

  function currentTerm() {
    const text = (main?.textContent || '').slice(0, 5000);
    const match = text.match(/\b(Spring|Summer|Fall)\s+(20\d{2})\s*-\s*College Station\b/i) || text.match(/\b(Spring|Summer|Fall)\s+(20\d{2})\b/i);
    if (!match) return routeSupported() ? { code: TERM, label: TERM_LABEL } : null;
    const season = match[1].toLowerCase();
    const year = Number(match[2]);
    const suffix = season === 'spring' ? '11' : season === 'summer' ? '21' : '31';
    return { code: `${year}${suffix}`, label: `${season[0].toUpperCase()}${season.slice(1)} ${year} - College Station` };
  }

  function pageCourseCodes() {
    const found = new Set();
    for (const row of main?.querySelectorAll('tbody tr') || []) {
      const text = [...row.querySelectorAll('strong')].map(node => node.textContent || '').join(' ');
      for (const match of text.matchAll(/\b([A-Z]{2,8})\s+(\d{3,4})\b/g)) found.add(`${match[1]} ${match[2]}`);
    }
    return [...found].sort();
  }

  function healthCheck() {
    main = app?.querySelector('main');
    nativeNav = app?.querySelector('nav.navbar-fixed-top');
    const selectors = [];
    if (!app) selectors.push('#scheduler-app');
    if (!main) selectors.push('#scheduler-app main');
    if (!nativeNav) selectors.push('nav.navbar-fixed-top');
    if (!routeSupported()) selectors.push('Spring 2027 planning route');
    const term = currentTerm();
    if (!term) selectors.push('visible Schedule Builder term');
    else if (term.code !== TERM) selectors.push(`term ${TERM_LABEL}`);
    if (main && !main.querySelector('h1,h2')) selectors.push('planning-page heading');
    return { ok: selectors.length === 0, selectors, term };
  }

  function visibleRows() {
    const rows = new Map();
    const selectors = 'tr,[role="row"],li,article,[data-testid],[data-test-id],[class*="section"],[class*="Section"]';
    for (const node of main?.querySelectorAll(selectors) || []) {
      const text = `${node.innerText || node.textContent || ''} ${node.getAttribute('aria-label') || ''}`.trim();
      if (!text || text.length > 2400) continue;
      const crns = [...new Set(text.match(/(?<!\d)\d{5}(?!\d)/g) || [])];
      if (crns.length !== 1) continue;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || !rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight) continue;
      const leafText = [...node.querySelectorAll('*')].filter(item => item.children.length === 0).map(item => `${item.textContent || ''} ${item.getAttribute('aria-label') || ''} ${item.title || ''}`).join('\n');
      const merged = `${text}\n${leafText}`.toLowerCase();
      const status = /\b(full|closed|unavailable|not available|no seats|0 seats?)\b/.test(merged) ? 'closed' : /\b(open|available)\b/.test(merged) ? 'open' : /\b(enrolled|registered)\b/.test(merged) ? 'enrolled' : '';
      let seats = null;
      const tr = node.closest('tr');
      const table = tr?.closest('table');
      if (tr && table) {
        const headers = [...table.querySelectorAll('thead th')];
        const seatIndex = headers.findIndex(th => /seats?\s+(?:open|available)|(?:open|available)\s+seats?/i.test((th.innerText || '').trim()));
        const cell = seatIndex >= 0 ? tr.cells[seatIndex] : null;
        const digits = (cell?.innerText || '').trim().match(/^\d+$/);
        if (digits) seats = Number(digits[0]);
      }
      const previous = rows.get(crns[0]);
      if (!previous || text.length < previous.text.length) rows.set(crns[0], { status, seats, observedAt: Date.now(), text: text.replace(/\s+/g, ' ').slice(0, 240) });
    }
    return rows;
  }

  function dayLabel(days) {
    const labels = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat', U: 'Sun' };
    return [...new Set(String(days || ''))].map(day => labels[day] || day).join(' ');
  }

  function clockLabel(minutes) {
    const hour = Math.floor(minutes / 60) % 24;
    return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
  }

  function meetingsLabel(section) {
    if (!section.meetings?.length) return section.unknownMeetingBlocks ? 'Some meeting times are missing; verify in Schedule Builder.' : 'No meeting times listed.';
    return section.meetings.map(item => `${dayLabel(item.days)} ${clockLabel(item.start)}-${clockLabel(item.end)}${item.building ? ` · ${item.building}` : ''}${item.room ? ` ${item.room}` : ''}`).join(' | ');
  }

  function overlaps(a, b) {
    return Boolean(a?.days && b?.days && a.start < b.end && b.start < a.end && [...a.days].some(day => b.days.includes(day)));
  }

  function findConflicts(section, others) {
    const crns = [];
    let incomplete = !section.meetings?.length || section.unknownMeetingBlocks > 0;
    for (const other of others) {
      if (other.crn === section.crn) continue;
      if (!other.meetings?.length || other.unknownMeetingBlocks > 0) incomplete = true;
      if (section.meetings?.some(left => other.meetings?.some(right => overlaps(left, right)))) crns.push(other.crn);
    }
    return { crns: [...new Set(crns)], incomplete };
  }

  function rmpHref(name) {
    const url = new URL('https://www.ratemyprofessors.com/search/professors/1003');
    url.searchParams.set('q', String(name || '').replace(/\s*\([^)]*\)/g, '').trim());
    return url.href;
  }

  function formatUpdated(value) {
    const stamp = Number(value);
    return Number.isFinite(stamp) && stamp > 0 ? new Date(stamp * 1000).toLocaleString() : 'time not listed';
  }

  function savedList() {
    return state.saved.map(crn => state.savedSections.get(crn) || state.results.find(section => section.crn === crn) || [...state.courseSections.values()].flat().find(section => section.crn === crn)).filter(Boolean);
  }

  function getPageSeats(crn) {
    return state.visibleRows.get(String(crn)) || null;
  }

  function card(section, options = {}) {
    const cardNode = el('article', 'section-card');
    const mainBlock = el('div', 'section-main');
    const title = el('h3');
    title.append(el('span', 'code', section.courseCode || 'Course not listed'), ` · Section ${section.section || 'not listed'}`);
    const details=[`CRN ${section.crn}`,section.scheduleType,section.instructionType,section.site,section.campus,section.attributes?`Attributes ${section.attributes}`:''].filter(Boolean).join(' · ');
    mainBlock.append(title, el('p', 'title', section.title || 'Title not listed'), el('p', 'meta', details));

    const context = el('div', 'section-context');
    context.append(el('p', 'meetings', meetingsLabel(section)));
    const visible = getPageSeats(section.crn);
    const visibleStatus = visible?.status ? `Visible page status: ${visible.status === 'closed' ? 'Full/closed' : visible.status === 'enrolled' ? 'Enrolled' : 'Open/available'}` : '';
    const countText = visible && visible.seats != null ? `Visible Seats Open cell: ${visible.seats} · observed ${new Date(visible.observedAt).toLocaleTimeString()}.` : '';
    const flag = section.openFlag === 'Y' ? 'Public Howdy flag: open' : section.openFlag === 'N' ? 'Public Howdy flag: closed' : 'Public Howdy flag not reported';
    context.append(el('span', `flag ${section.openFlag === 'Y' ? 'flag-open' : section.openFlag === 'N' ? 'flag-closed' : 'flag-unknown'}`, flag));
    if (visibleStatus) context.append(el('p', 'evidence', `${visibleStatus} · observed ${new Date(visible.observedAt).toLocaleString()}.`));
    if (countText) context.append(el('p', 'evidence', countText));
    context.append(el('p', 'evidence', `Source: ${section.source || 'not listed'} · updated ${formatUpdated(section.updatedAt)}. Public flags are not seat counts.`));

    const grades = el('div', 'section-context');
    const history = section.historical || {};
    const gradeBits = [];
    if (Number.isFinite(history.averageGpa)) gradeBits.push(`mean GPA ${history.averageGpa.toFixed(2)}`);
    if (Number.isFinite(history.abRate)) gradeBits.push(`${history.abRate.toFixed(1)}% A/B`);
    if (history.records) gradeBits.push(`${history.records} historical records`);
    const gradeTerms=(history.terms||[]).join(', ')||'term not listed';
    grades.append(el('p','evidence',gradeBits.length?`Historical course grades: ${gradeBits.join(' · ')} · ${history.records} records · terms ${gradeTerms} · ${(history.sources||[]).join(', ')||'source not listed'} · updated ${formatUpdated(history.updatedAt)}.`:'No historical course-grade summary is available.'));
    for(const professor of section.professors||[]){
      const terms=(professor.terms||[]).join(', ')||'term not listed';
      const sources=(professor.sources||[]).join(', ')||'source not listed';
      const details=professor.records?professor.averageGpa==null?`${professor.name}: ${professor.records} exact normalized-name grade records; no GPA values. Terms ${terms} · ${sources} · updated ${formatUpdated(professor.updatedAt)}.`:`${professor.name}: historical GPA ${professor.averageGpa.toFixed(2)} across ${professor.gpaRecords} GPA records (${professor.records} exact normalized-name grade records). Terms ${terms} · ${sources} · updated ${formatUpdated(professor.updatedAt)}.`:`${professor.name}: no exact normalized-name historical grade match.`;
      grades.append(el('p','evidence',details));
      const link = el('a', 'rmp-link', `Search RMP for ${professor.name.replace(/\s*\([^)]*\)/g, '').trim()}`);
      link.href = rmpHref(professor.name); link.target = '_blank'; link.rel = 'noopener noreferrer'; grades.append(link);
    }
    if (!(section.professors || []).length) grades.append(el('p', 'evidence', 'Instructor names are not listed. RMP ratings and reviews are not embedded.'));
    for (const fit of section.requirementFits || []) grades.append(el('p', fit.matches ? 'evidence' : 'callout', `${fit.matches ? 'Potential requirement fit' : 'Does not match'}: ${fit.name}${fit.kind ? ` · ${fit.kind}` : ''}${fit.track ? ` · ${fit.track}` : ''}. ${fit.reason}`));
    const conflictSections = options.conflicts || savedList();
    if (conflictSections.length) {
      const conflict = findConflicts(section, conflictSections);
      grades.append(el('p', conflict.crns.length ? 'callout error' : conflict.incomplete ? 'callout' : 'evidence', conflict.crns.length ? `Meeting-time conflict with saved CRN ${conflict.crns.join(', ')}.` : conflict.incomplete ? 'No known overlap; some meeting times are missing. Confirm in Schedule Builder.' : 'No meeting-time overlap with saved sections.'));
    }
    const actions = el('div', 'actions');
    if (options.addCourse) actions.append(button(state.courses.includes(section.courseCode) ? 'In plan' : 'Add course to plan', state.courses.includes(section.courseCode) ? 'secondary' : 'primary', () => toggleCourse(section.courseCode), state.courses.includes(section.courseCode)));
    actions.append(button(state.saved.includes(section.crn) ? 'Remove saved' : 'Save section', 'secondary', () => toggleSaved(section.crn), state.saved.includes(section.crn)));
    cardNode.append(mainBlock, context, grades, actions);
    return cardNode;
  }

  function createShell() {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('aria-label', 'ASB+ Schedule Builder workspace');
    shadow = host.attachShadow({ mode: 'open' });
    const css = document.createElement('style'); css.textContent = styleText;
    shadow.append(css);
    const root = el('div', 'root');
    shadow.append(root);
    document.documentElement.append(host);
    return root;
  }

  function setStatus(text) {
    state.status = text;
    const node = shadow?.querySelector('.statusline');
    if (node) node.textContent = text;
  }

  function setFallbackNotice(text) {
    state.fallback = text;
    let node = shadow?.querySelector('.fallback-notice');
    if (!node && text) {
      node = el('p', 'fallback-notice callout', text);
      node.setAttribute('role', 'status');
      shadow?.querySelector('.root')?.append(node);
    }
    if (node) { node.hidden = !text; node.textContent = text; }
  }

  function buildLauncher(root) {
    root.replaceChildren();
    const launch = button(state.enabled ? 'Open ASB+ workspace' : 'Re-enable ASB+ workspace', 'launcher', async () => {
      if (!state.enabled) {
        state.enabled = true;
        await chrome.storage.local.set({ [STORAGE.enabled]: true });
      }
      await openWorkspace();
    });
    launch.setAttribute('aria-label', state.enabled ? 'Open ASB+ Spring 2027 course workspace' : 'Re-enable and open ASB+ workspace');
    root.append(launch);
    if (state.fallback) {
      const notice = el('p', 'fallback-notice callout', state.fallback);
      notice.setAttribute('role', 'status'); root.append(notice);
    }
  }

  function buildWorkspace(root) {
    root.replaceChildren();
    const workspace = el('div', 'workspace');
    const skip = el('a', 'keyboard', 'Skip to course search'); skip.href = '#asb-rebuild-search'; workspace.append(skip);
    const header = el('header', 'masthead');
    const brand = el('div', 'brand');
    brand.append(el('span', 'mark', 'A'));
    const name = el('div'); name.append(el('p', 'brand-name', 'ASB+ course workspace'), el('p', 'brand-sub', 'Section choice and schedule planning'));
    brand.append(name);
    const term = el('span', 'term', `${state.backend?.termLabel || TERM_LABEL} · ${Number(state.backend?.sections || 0).toLocaleString()} sections`);
    const native = button('Use original Schedule Builder', 'native-button', killSwitch);
    header.append(brand, term, native);

    const nav = el('div', 'navrow');
    const tabs = el('nav', 'tabs'); tabs.setAttribute('aria-label', 'Workspace views');
    for (const [key, label] of [['find','Find sections'],['plan','Plan & rank'],['saved','Saved'],['handoff','Review CRNs']]) {
      const tab = button(label, 'tab', () => switchView(key), state.currentView === key); tab.setAttribute('role','tab'); tab.setAttribute('aria-selected',String(state.currentView===key)); tabs.append(tab);
    }
    nav.append(tabs, el('p', 'statusline', state.status));
    const content = el('main', 'content'); content.id = 'asb-rebuild-content'; content.tabIndex = -1;
    const fallback = el('p','fallback-notice callout',state.fallback); fallback.setAttribute('role','status'); fallback.hidden=!state.fallback; content.append(fallback);

    const findView = el('section','view'); findView.dataset.view='find';
    const findHead = el('div','subhead'); const findTitle=el('div'); findTitle.append(el('h2','', 'Find sections'), el('p','', 'Search Spring 2027 sections with grades, availability, requirements, and conflicts inline.')); findHead.append(findTitle); findView.append(findHead);
    const searchbar=el('div','searchbar');
    const search=el('input','search-input'); search.type='search'; search.id='asb-rebuild-search'; search.autocomplete='off'; search.placeholder=state.searchMode==='attribute'?'Search section attributes':'Course, title, instructor, or CRN'; search.setAttribute('aria-label','Search courses, sections, or attributes'); search.value=state.query;
    search.addEventListener('input',()=>{state.query=search.value;state.offset=0;state.results=[];state.hasMore=false;state.searchSequence++;state.loading=false;clearTimeout(state.searchTimer);renderResults();state.searchTimer=setTimeout(()=>runSearch(state.query,0),150);});
    const searchMode=el('select','secondary'); searchMode.setAttribute('aria-label','Search category');
    for(const [value,label] of [['text','Courses, titles, instructors, CRNs'],['attribute','Section attributes']]){const option=el('option','',label);option.value=value;searchMode.append(option);}
    searchMode.value=state.searchMode;searchMode.addEventListener('change',()=>{state.searchMode=searchMode.value;search.placeholder=state.searchMode==='attribute'?'Search section attributes':'Course, title, instructor, or CRN';clearTimeout(state.searchTimer);runSearch(state.query,0);});
    const openOnly=el('select','secondary'); openOnly.setAttribute('aria-label','Availability filter'); for(const [v,t] of [['all','All public flags'],['Y','Public open'],['N','Public closed']]){const o=el('option','',t);o.value=v;openOnly.append(o);} openOnly.value=state.openFilter||'all'; openOnly.addEventListener('change',()=>{state.openFilter=openOnly.value;clearTimeout(state.searchTimer);runSearch(state.query,0);});
    const clear=button('Clear search','quiet-button',()=>{state.searchSequence++;clearTimeout(state.searchTimer);state.query='';state.offset=0;state.results=[];state.hasMore=false;state.truncated=false;state.loading=false;search.value='';renderResults();setStatus('Search cleared.');});
    searchbar.append(search,searchMode,openOnly,clear); findView.append(searchbar);
    const searchStatus=el('p','statusline'); searchStatus.dataset.searchStatus='true'; searchStatus.setAttribute('role','status'); searchStatus.setAttribute('aria-live','polite'); findView.append(searchStatus);
    const results=el('div','section-list'); results.dataset.results='true'; findView.append(results);
    const more=button('Load more sections','secondary',()=>loadMore()); more.dataset.loadMore='true'; more.hidden=true; findView.append(more);

    const planView=el('section','view'); planView.dataset.view='plan';
    const planHead=el('div','subhead'); const planTitle=el('div'); planTitle.append(el('h2','', 'Plan & rank'),el('p','','Build conflict-free combinations in this browser. Ranking uses available historical GPA and A/B data only.')); planHead.append(planTitle,button('Rank combinations','primary',()=>generateSchedules())); planView.append(planHead);
    const planMessage=el('p','callout','Course codes visible in Schedule Builder were carried into this workspace. Course state on the native page is unchanged. Required lecture/lab pairings are not inferred; verify components before cart handoff.');planMessage.dataset.planMessage='true';planView.append(planMessage);
    const planTools=el('div','actions');planTools.append(button('Add current search to plan','secondary',addSearchCourses),el('span','muted',`${state.courses.length} courses in plan`));planTools.dataset.planTools='true';planView.append(planTools);
    const planList=el('div');planList.dataset.planList='true';planView.append(planList);
    const schedules=el('div','schedule-list');schedules.dataset.schedules='true';planView.append(schedules);

    const savedView=el('section','view');savedView.dataset.view='saved';const savedHead=el('div','subhead');const savedTitle=el('div');savedTitle.append(el('h2','','Saved sections'),el('p','','Meeting-time conflicts compare against your locally saved CRNs.'));savedHead.append(savedTitle,button('Refresh saved data','secondary',()=>refreshSaved()));savedView.append(savedHead);const savedListNode=el('div','section-list');savedListNode.dataset.saved='true';savedView.append(savedListNode);

    const handoff=el('section','view');handoff.dataset.view='handoff';const handoffHead=el('div','subhead');const hTitle=el('div');hTitle.append(el('h2','','Review CRNs'),el('p','','Copy the chosen sections into Schedule Builder. Nothing is added to the cart or registered automatically.'));handoffHead.append(hTitle);handoff.append(handoffHead);
    const handoffGrid=el('div','handoff');const left=el('div');left.append(el('h3','','Selected sections'));const handoffDetails=el('div','section-list');handoffDetails.dataset.handoffDetails='true';left.append(handoffDetails);const crnBox=el('textarea');crnBox.readOnly=true;crnBox.setAttribute('aria-label','Selected CRNs, one per line');crnBox.dataset.crns='true';left.append(crnBox,button('Copy CRNs','primary',copyCrns));const copyStatus=el('p','statusline');copyStatus.dataset.copyStatus='true';copyStatus.setAttribute('role','status');copyStatus.setAttribute('aria-live','polite');left.append(copyStatus);
    const right=el('div');right.append(el('h3','','Continue in Schedule Builder'));const steps=el('ol','steps');for(const step of ['Copy the CRNs above.','Open native Add Courses and choose By CRN; paste and add the course(s).','Choose the matching sections and use Schedule Builder’s native cart controls.','Review the native cart. Click Register yourself only when ready.'])steps.append(el('li','',step));right.append(steps);const addLink=el('a','primary','Open native Add Courses');addLink.href=nativeAddCoursesHref();addLink.addEventListener('click',()=>{state.suppressRoute=new URL(addLink.href).pathname;closeWorkspace();});right.append(addLink,el('p','muted','ASB+ never submits registration, touches sign-in, or reads cookies. Confirm current availability, eligibility, and holds in the official page.'));handoffGrid.append(left,right);handoff.append(handoffGrid);

    const footer=el('p','footnote','Public open/closed flags are not seat counts. Numeric seats appear only when directly readable in a visible Schedule Builder Seats Open cell. Historical grades are not predictions; RMP is a search link only. Degree rules remain in this browser.');
    const views=[findView,planView,savedView,handoff]; for(const view of views)view.hidden=view.dataset.view!==state.currentView;
    content.append(...views,footer);workspace.append(header,nav,content);root.append(workspace);
    renderResults();renderPlan();renderSaved();updateHandoff();
    if(state.currentView==='find')queueMicrotask(()=>search.focus({preventScroll:true}));
  }

  function nativeAddCoursesHref() {
    const link=[...document.querySelectorAll('#scheduler-app a[href]')].find(a=>/\/courses\/add(?:$|[?#])/.test(a.getAttribute('href')||''));
    return link?.href || new URL(`/terms/${encodeURIComponent(TERM_LABEL)}/courses/add`,location.origin).href;
  }

  function switchView(view) {
    state.currentView=view;const root=shadow?.querySelector('.root');if(root&&state.active)buildWorkspace(root);
  }

  async function runSearch(query, offset=0) {
    const sequence=++state.searchSequence;
    state.loading=true;
    state.offset=offset;
    if(!query.trim()){
      state.results=[];state.hasMore=false;state.truncated=false;state.loading=false;
      setStatus(state.searchMode==='attribute'?'Enter a section attribute.':'Enter a course, title, instructor, or CRN.');
      renderResults();
      return;
    }
    if(!offset){state.results=[];state.hasMore=false;state.truncated=false;}
    setStatus(`Searching Spring 2027 ${state.searchMode==='attribute'?'attributes':'sections'} for “${query}”…`);
    renderResults();
    try {
      const response=await send({type:'asb-search',query,term:TERM,limit:100,offset,searchMode:state.searchMode,open:state.openFilter==='all'?'':state.openFilter});
      if(sequence!==state.searchSequence)return;
      if(String(response.term)!==TERM)throw Error('The backend returned a different term. No results shown.');
      state.results=offset?[...state.results,...(response.sections||[])]:response.sections||[];
      state.results=uniqueSections(state.results);
      state.hasMore=Boolean(response.hasMore);
      state.truncated=Boolean(response.truncated);
      setStatus(`${state.results.length} Spring 2027 section${state.results.length===1?'':'s'} loaded${state.hasMore?'; more results available':''}${state.truncated?'; backend result limit reached, refine search':''}.`);
    } catch(error) {
      if(sequence!==state.searchSequence)return;
      fallback(`ASB+ returned to the original Schedule Builder because Spring 2027 section search failed: ${error.message}`);
    } finally {
      if(sequence===state.searchSequence){state.loading=false;renderResults();renderPlan();renderSaved();}
    }
  }


  function uniqueSections(sections) { const seen=new Set();return sections.filter(section=>{const key=`${section.term}:${section.crn}`;if(seen.has(key))return false;seen.add(key);return true;}); }

  async function loadMore() { if(!state.hasMore||state.loading)return;await runSearch(state.query,state.offset+100); }

  function renderResults() {
    if(!shadow)return;const list=shadow.querySelector('[data-results]');const status=shadow.querySelector('[data-search-status]');const more=shadow.querySelector('[data-load-more]');if(!list)return;
    list.replaceChildren();const filtered=state.results.filter(section=>!state.openFilter||state.openFilter==='all'||section.openFlag===state.openFilter);
    if(!state.query.trim())status.textContent=state.searchMode==='attribute'?'Search section attributes. Results are limited to Spring 2027.':'Search course codes, titles, instructors, or CRNs. Results are limited to Spring 2027.';
    else if(state.loading&&state.results.length===0)status.textContent='Loading sections…';
    else if(!filtered.length)status.textContent=state.results.length?'No sections match this availability filter.':state.searchMode==='attribute'?'No sections found with that attribute. Try a shorter or different attribute.':'No sections found. Try a course code, instructor surname, title, or CRN.';
    else status.textContent=`${filtered.length} matching section${filtered.length===1?'':'s'}${state.hasMore?' on this page':''}.`;
    const saved=savedList();for(const section of filtered)list.append(card(section,{addCourse:true,conflicts:saved}));
    more.hidden=!state.hasMore;more.disabled=state.loading;more.textContent=state.loading?'Loading…':'Load more sections';
  }

  function renderSaved() {
    if(!shadow)return;const list=shadow.querySelector('[data-saved]');if(!list)return;list.replaceChildren();
    const loaded=savedList();const missing=state.saved.filter(crn=>!state.savedSections.has(crn)&&!loaded.some(section=>section.crn===crn));
    if(!state.saved.length){list.append(el('div','empty','No saved sections yet. Save a section from Find sections to check meeting-time conflicts here.'));return;}
    for(const crn of missing){const row=el('article','section-card');const actions=el('div','actions');actions.append(button('Remove saved','secondary',()=>toggleSaved(crn)));row.append(el('div','section-main',`CRN ${crn}`),el('p','muted','Section data unavailable for Spring 2027. Check the native page or remove this saved CRN.'),el('div','section-context'),actions);list.append(row);}
    for(const section of loaded)list.append(card(section,{conflicts:loaded}));
  }

  async function loadCourseSections(courseCode) {
    if(state.courseSections.has(courseCode))return state.courseSections.get(courseCode);
    const response=await send({type:'asb-search',query:courseCode,term:TERM,limit:250,offset:0});
    if(String(response.term)!==TERM)throw Error('The backend returned a different term.');
    const rows=(response.sections||[]).filter(section=>section.courseCode===courseCode);
    if(response.hasMore||response.truncated)throw Error(`${courseCode} has more sections than the safe client-side schedule limit. Narrow sections in Schedule Builder first.`);
    state.courseSections.set(courseCode,rows);return rows;
  }

  function renderPlan() {
    if (!shadow) return;
    const list = shadow.querySelector('[data-plan-list]');
    const scheduleList = shadow.querySelector('[data-schedules]');
    if (!list || !scheduleList) return;
    list.replaceChildren();
    scheduleList.replaceChildren();

    const tools = shadow.querySelector('[data-plan-tools]');
    const count = tools?.querySelector('.muted');
    if (count) count.textContent = `${state.courses.length} course${state.courses.length === 1 ? '' : 's'} in plan`;
    if (!state.courses.length) {
      list.append(el('div', 'empty', 'Add a course from Find sections, or use courses already listed on the native Schedule Builder page.'));
      return;
    }

    for (const code of state.courses) {
      const block = el('section', 'course-block');
      const head = el('div', 'course-head');
      head.append(el('h3', '', code), button('Remove course', 'quiet-button', () => toggleCourse(code)));
      block.append(head);

      const sections = state.courseSections.get(code);
      let message = 'Section options load when you rank combinations.';
      if (sections && !sections.length) message = 'No Spring 2027 sections were returned for this course.';
      else if (sections) message = `${sections.length} section option${sections.length === 1 ? '' : 's'} available · lecture/lab pairing is not inferred.`;
      block.append(el('p', 'muted', message));
      list.append(block);
    }

    for (const schedule of state.scheduleResults) {
      const item = el('article', 'schedule-card');
      const score = schedule.score == null ? 'Historical score not available' : `Historical score ${schedule.score.toFixed(2)} / 100`;
      item.append(el('h3', '', `Option ${schedule.index} · ${schedule.quality}`), el('p', 'score', score));

      const entries = el('ol');
      for (const section of schedule.sections) {
        entries.append(el('li', '', `${section.courseCode} · Section ${section.section} · CRN ${section.crn} · ${meetingsLabel(section)}`));
      }
      item.append(entries);

      const feedback = schedule.incomplete
        ? 'No known overlaps, but meeting data is incomplete. Verify in Schedule Builder.'
        : 'No meeting-time overlap detected for the listed meeting blocks.';
      item.append(el('p', schedule.incomplete ? 'callout' : 'evidence', feedback));
      item.append(button('Use this CRN set', 'primary', () => {
        state.selectedHandoff = schedule.sections;
        updateHandoff();
        switchView('handoff');
      }));
      scheduleList.append(item);
    }
  }

  async function generateSchedules() {
    state.scheduleResults = [];
    renderPlan();
    setStatus('Loading section choices and ranking combinations in this browser…');
    try {
      const entries = await Promise.all(state.courses.map(async code => [code, await loadCourseSections(code)]));
      const groups = entries.map(([, sections]) => sections).filter(sections => sections.length);
      if (groups.length !== state.courses.length) throw Error('At least one planned course has no returned Spring 2027 sections.');

      const limit = 25000;
      let visited = 0;
      let capped = false;
      const found = [];
      const chosen = [];

      const walk = index => {
        if (visited >= limit) {
          capped = true;
          return;
        }
        if (index === groups.length) {
          visited++;
          let complete = true;
          let gradeTotal = 0;
          let gradeCount = 0;
          for (const section of chosen) {
            if (!section.meetings?.length || section.unknownMeetingBlocks) complete = false;

            const history = section.historical || {};
            const hasGpa = Number.isFinite(history.averageGpa);
            const hasAbRate = Number.isFinite(history.abRate);
            if (!hasGpa && !hasAbRate) continue;
            const metrics = Number(hasGpa) + Number(hasAbRate);
            const score = (hasGpa ? history.averageGpa / 4 : 0) + (hasAbRate ? history.abRate / 100 : 0);
            gradeTotal += score / metrics;
            gradeCount++;
          }
          const score = gradeCount ? (gradeTotal / gradeCount) * 100 : null;
          found.push({
            sections: [...chosen],
            score,
            incomplete: !complete,
            quality: complete ? 'Meeting times complete' : 'Meeting times incomplete',
          });
          return;
        }

        for (const section of groups[index]) {
          if (visited >= limit) {
            capped = true;
            break;
          }
          let conflict = false;
          for (const prior of chosen) {
            for (const meeting of section.meetings || []) {
              if (prior.meetings?.some(other => overlaps(meeting, other))) {
                conflict = true;
                break;
              }
            }
            if (conflict) break;
          }
          if (conflict) continue;
          chosen.push(section);
          walk(index + 1);
          chosen.pop();
        }
      };

      walk(0);
      found.sort((left, right) => {
        const scoreDifference = (right.score ?? -1) - (left.score ?? -1);
        if (scoreDifference) return scoreDifference;
        const leftCrns = left.sections.map(section => section.crn).join(',');
        const rightCrns = right.sections.map(section => section.crn).join(',');
        return leftCrns.localeCompare(rightCrns);
      });
      state.scheduleResults = found.slice(0, 12).map((item, index) => ({ ...item, index: index + 1 }));
      setStatus(`${found.length} non-conflicting combination${found.length === 1 ? '' : 's'} evaluated locally${capped ? `; evaluation stopped at ${limit.toLocaleString()} combinations, so ranking is partial` : ''}. Historical score averages available GPA and A/B shares equally; public flags are not seat counts.`);
    } catch (error) {
      fallback(`ASB+ returned to the original Schedule Builder because schedule ranking could not complete: ${error.message}`);
    }
    renderPlan();
  }

  function updateHandoff() {
    if(!shadow)return;
    const items=state.selectedHandoff?.length?state.selectedHandoff:savedList();
    const box=shadow.querySelector('[data-crns]');
    if(box)box.value=items.map(section=>section.crn).join('\n');
    const details=shadow.querySelector('[data-handoff-details]');
    if(!details)return;
    details.replaceChildren();
    if(!items.length){details.append(el('div','empty','Select a ranked CRN set or save sections to review the handoff.'));return;}
    for(const section of items){
      const cardNode=el('article','schedule-card');
      const conflict=findConflicts(section,items);
      const flag=section.openFlag==='Y'?'Public Howdy flag: open':section.openFlag==='N'?'Public Howdy flag: closed':'Public Howdy flag not reported';
      cardNode.append(el('h3','',`${section.courseCode||'Course'} · Section ${section.section||'not listed'} · CRN ${section.crn}`),el('p','meetings',meetingsLabel(section)),el('p','evidence',flag));
      cardNode.append(el('p',conflict.crns.length?'callout error':conflict.incomplete?'callout':'evidence',conflict.crns.length?`Meeting-time conflict with CRN ${conflict.crns.join(', ')}.`:conflict.incomplete?'Meeting-time check is incomplete. Confirm the listed section in Schedule Builder.':'No meeting-time overlap detected across the selected CRNs.'));
      const visible=getPageSeats(section.crn);
      if(visible?.seats!=null)cardNode.append(el('p','evidence',`Visible Seats Open cell: ${visible.seats} · observed ${new Date(visible.observedAt).toLocaleString()}.`));
      cardNode.append(el('p','meta',`Source: ${section.source||'not listed'} · updated ${formatUpdated(section.updatedAt)}. Public flags are not seat counts.`));
      details.append(cardNode);
    }
  }

  async function copyCrns() {
    const box=shadow.querySelector('[data-crns]');const status=shadow.querySelector('[data-copy-status]');if(!box.value){status.textContent='Choose a ranked option or save sections first.';return;}
    try {await navigator.clipboard.writeText(box.value);status.textContent='CRNs copied. Add them through native Add Courses; registration was not submitted.';}
    catch {box.focus();box.select();status.textContent='Clipboard access was unavailable. CRNs are selected; copy them with your keyboard.';}
  }

  async function toggleSaved(crn) {
    try {const stored=await chrome.storage.local.get({[STORAGE.saved]:[]});const saved=new Set((Array.isArray(stored[STORAGE.saved])?stored[STORAGE.saved]:[]).map(String));if(saved.has(crn))saved.delete(crn);else saved.add(crn);state.saved=[...saved].sort();await chrome.storage.local.set({[STORAGE.saved]:state.saved});if(saved.has(crn)&&!state.savedSections.has(crn)){const result=await send({type:'asb-sections',crns:[crn],term:TERM});for(const section of result.sections||[])state.savedSections.set(section.crn,section);}setStatus(state.saved.includes(crn)?`Saved CRN ${crn}.`:`Removed CRN ${crn} from Saved.`);renderResults();renderSaved();renderPlan();updateHandoff();}
    catch(error){fallback(`ASB+ returned to the original Schedule Builder because Saved data could not be updated: ${error.message}`);}
  }

  async function toggleCourse(code) {
    if(!code)return;
    const courses=new Set(state.courses);
    if(courses.has(code))courses.delete(code);else courses.add(code);
    const next=[...courses].sort();
    try {await chrome.storage.local.set({[STORAGE.courses]:next});}
    catch(error){fallback(`ASB+ returned to the original Schedule Builder because the local plan could not be saved: ${error.message}`);return;}
    state.courses=next;state.scheduleResults=[];renderResults();renderPlan();setStatus(`${code} ${courses.has(code)?'added to':'removed from'} the local plan.`);
  }

  async function addSearchCourses() {
    const next=[...new Set([...state.courses,...state.results.map(section=>section.courseCode).filter(Boolean)])].sort();
    const added=next.length-state.courses.length;
    if(!added){setStatus(state.results.length?'All result courses are already in the plan.':'Search sections before adding courses to the plan.');return;}
    try {await chrome.storage.local.set({[STORAGE.courses]:next});}
    catch(error){fallback(`ASB+ returned to the original Schedule Builder because the local plan could not be saved: ${error.message}`);return;}
    state.courses=next;state.scheduleResults=[];renderResults();renderPlan();setStatus(`${added} course${added===1?'':'s'} added to the local plan.`);
  }

  async function refreshSaved() {
    try {const response=await send({type:'asb-refresh-saved',crns:state.saved,term:TERM});state.savedSections=new Map((response.sections||[]).map(section=>[section.crn,section]));setStatus(`Refreshed ${state.savedSections.size} saved Spring 2027 sections.`);renderSaved();renderResults();}
    catch(error){fallback(`ASB+ returned to the original Schedule Builder because Saved data could not be refreshed: ${error.message}`);}
  }

  async function openWorkspace() {
    if (state.active || state.opening) return;
    state.opening = true;
    try {
      const check = healthCheck();
      if (!check.ok) {
        fallback(`ASB+ stayed off because the page structure is unsupported (${check.selectors.join(', ')}). Schedule Builder is unchanged.`);
        return;
      }
      try {
        const connection = await send({ type: 'asb-connect' });
        if (String(connection.summary?.term) !== TERM) {
          throw Error(`Backend term is ${connection.summary?.termLabel || connection.summary?.term || 'unknown'}, not Spring 2027.`);
        }
        const lookup = await send({ type: 'asb-check-section-lookup', term: TERM });
        if (String(lookup.term) !== TERM) throw Error('The exact CRN lookup is not serving Spring 2027.');
        state.backend = { ...connection.summary };
      } catch (error) {
        fallback(`ASB+ stayed off because its Spring 2027 backend data is unavailable: ${error.message}`);
        return;
      }
      try {
        const stored = await chrome.storage.local.get({ [STORAGE.saved]: [], [STORAGE.courses]: null });
        state.saved = [...new Set((Array.isArray(stored[STORAGE.saved]) ? stored[STORAGE.saved] : []).map(String))].sort();
        const savedData = await send({ type: 'asb-sections', crns: state.saved, term: TERM });
        if (String(savedData.term) !== TERM || !Array.isArray(savedData.sections)) throw Error('Saved section data did not match Spring 2027.');
        state.savedSections = new Map(savedData.sections.map(section => [section.crn, section]));
        const codes = Array.isArray(stored[STORAGE.courses]) ? stored[STORAGE.courses] : pageCourseCodes();
        state.courses = [...new Set(codes.map(String).filter(code => /^[A-Z]{2,8}\s+\d{3,4}$/.test(code)))].sort();
        if (!Array.isArray(stored[STORAGE.courses]) && state.courses.length) {
          await chrome.storage.local.set({ [STORAGE.courses]: state.courses });
        }
        state.pageTerm = check.term.code;
        state.visibleRows = visibleRows();
        state.scrollY = window.scrollY;
        state.currentView = 'find';
        state.fallback = '';
        state.active = true;
        const root = shadow?.querySelector('.root');
        if (!root) throw Error('The ASB+ workspace could not be initialized.');
        buildWorkspace(root);
        document.documentElement.setAttribute(ACTIVE_ATTR, '');
        setStatus('Connected to Spring 2027. Search and plan data stays local to this browser.');
      } catch (error) {
        fallback(`ASB+ could not validate the Spring 2027 section data: ${error.message}`);
      }
    } finally {
      state.opening = false;
    }
  }

  async function closeWorkspace() {
    state.active = false;
    document.documentElement.removeAttribute(ACTIVE_ATTR);
    const root = shadow?.querySelector('.root');
    if (root) buildLauncher(root);
    window.scrollTo({ top: state.scrollY, behavior: 'auto' });
  }

  function fallback(message) {
    state.active = false;
    document.documentElement.removeAttribute(ACTIVE_ATTR);
    state.fallback = message;
    const root = shadow?.querySelector('.root');
    if (root) buildLauncher(root);
  }

  async function killSwitch() {
    state.enabled = false;
    state.fallback = 'ASB+ replacement is off. Re-enable it from the ASB+ button when you choose.';
    await closeWorkspace();
    try {
      await chrome.storage.local.set({ [STORAGE.enabled]: false });
    } catch (error) {
      state.fallback = `Schedule Builder is restored, but the local kill switch could not be saved: ${error.message}`;
      const root=shadow?.querySelector('.root');
      if(root)buildLauncher(root);
    }
  }

  function renderResultsWithData() {
    if(!state.active)return;
    renderResults();
    renderSaved();
    updateHandoff();
  }

  function onPageMutation() {
    clearTimeout(pageChangeTimer);
    pageChangeTimer = setTimeout(async function () {
      const route = location.pathname;
      if (!routeSupported()) {
        if (state.active) await closeWorkspace();
        host?.remove();
        host = null;
        shadow = null;
        state.lastHealth = '';
        state.lastRoute = route;
        state.suppressRoute = '';
        return;
      }

      const check = healthCheck();
      const health = check.ok ? 'ok' : check.selectors.join('|');
      const routeChanged = state.lastRoute !== route;
      state.lastRoute = route;

      if (state.active) {
        state.lastHealth = health;
        if (!check.ok) fallback(`ASB+ switched back to Schedule Builder because page checks failed: ${check.selectors.join(', ')}.`);
        else renderResultsWithData();
        return;
      }
      if (!host?.isConnected) {
        initialize().catch(() => {});
        return;
      }

      const shouldOpen = state.enabled &&
        state.suppressRoute !== route &&
        check.ok &&
        (state.lastHealth !== health || routeChanged);
      state.lastHealth = health;
      if (shouldOpen) initialize().catch(() => {});
    }, 120);
  }

  async function initialize() {
    if (!app) return;
    if (!pageObserver) {
      pageObserver = new MutationObserver(onPageMutation);
      pageObserver.observe(app, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-label', 'title', 'href'],
      });
    }
    if (!routeSupported()) return;

    state.lastRoute = location.pathname;
    const check = healthCheck();
    state.lastHealth = check.ok ? 'ok' : check.selectors.join('|');
    if (!host?.isConnected) {
      const root = createShell();
      buildLauncher(root);
    }

    try {
      const stored = await chrome.storage.local.get({ [STORAGE.enabled]: true });
      state.enabled = stored[STORAGE.enabled] !== false;
    } catch {
      state.enabled = true;
    }
    if (!state.enabled) {
      state.fallback = 'ASB+ replacement is disabled. Re-enable it when you choose.';
      const root = shadow?.querySelector('.root');
      if (root) buildLauncher(root);
    }
    if (!check.ok) {
      setFallbackNotice(`ASB+ is using the original page. Unsupported page checks: ${check.selectors.join(', ')}.`);
      return;
    }
    if (!state.enabled) return;
    await openWorkspace();
  }

  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    if(changes[STORAGE.saved]){state.saved=[...new Set((changes[STORAGE.saved].newValue||[]).map(String))].sort();if(state.active){renderSaved();renderResults();renderPlan();updateHandoff();}}
    if(changes[STORAGE.courses]){state.courses=[...new Set((changes[STORAGE.courses].newValue||[]).map(String))].sort();if(state.active)renderPlan();}
    if(changes[STORAGE.enabled])state.enabled=changes[STORAGE.enabled].newValue!==false;
  });

  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message?.type!=='asb-detect')return;
    const check=healthCheck();const rows=visibleRows();respond({ok:true,url:location.href,title:document.title,count:rows.size,overlayCount:0,pageTerm:check.term,backendTerm:state.backend,backendUnavailable:false,bodyCrns:[...new Set((main?.innerText||'').match(/(?<!\d)\d{5}(?!\d)/g)||[])].length,hasCrnLabel:/\bcrn\b/i.test(main?.innerText||''),supported:check.ok,missing:check.selectors,rows:[...rows].slice(0,20).map(([crn,row])=>({crn,status:row.status,tag:'row',classes:'',text:row.text}))});
  });

  initialize().catch(error=>fallback(`ASB+ stayed off. Schedule Builder is unchanged. ${error.message}`));
})();
