(() => {
  const storageKey = 'asb-preflight-workspace';
  const maxItems = 100;
  const escapeText = value => String(value ?? '');
  const state = loadState();
  let availableSchedules = [];

  function loadState() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
      const ticket = value.ticket && typeof value.ticket === 'object' ? value.ticket : null;
      let cleanTicket = null;
      if (ticket && typeof ticket.dateTime === 'string' && typeof ticket.timeZone === 'string' &&
          Number.isFinite(Number(ticket.timestamp)) && Number(ticket.timestamp) > 0) {
        const dateTime = ticket.dateTime.slice(0, 16);
        const timeZone = ticket.timeZone.slice(0, 80);
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTime)) {
          try {
            new Intl.DateTimeFormat('en-US', { timeZone });
            cleanTicket = { dateTime, timeZone, timestamp: Number(ticket.timestamp) };
          } catch { }
        }
      }
      const checklist = Array.isArray(value.checklist) ? value.checklist.slice(0, maxItems).flatMap(item => {
        if (!item || typeof item !== 'object' || !['Hold', 'Action item'].includes(item.kind) || typeof item.text !== 'string') return [];
        const text = item.text.trim().slice(0, 240);
        return text ? [{ id: String(item.id || crypto.randomUUID()), kind: item.kind, text, done: item.done === true }] : [];
      }) : [];
      const order = Array.isArray(value.order) ? value.order.slice(0, 100).flatMap(item => {
        if (!item || typeof item !== 'object' || typeof item.courseCode !== 'string' || !/^\d{5}$/.test(String(item.crn || ''))) return [];
        return [{
          courseCode: item.courseCode.slice(0, 32), crn: String(item.crn),
          backups: Array.isArray(item.backups) ? [...new Set(item.backups.map(String).filter(crn => /^\d{5}$/.test(crn) && crn !== String(item.crn)))].slice(0, 20) : []
        }];
      }) : [];
      return {
        ticket: cleanTicket, checklist, order,
        orderReason: typeof value.orderReason === 'string' ? value.orderReason.slice(0, 300) : ''
      };
    } catch {
      return { ticket: null, checklist: [], order: [], orderReason: '' };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      return true;
    } catch {
      document.querySelector('#preflight-order-status').textContent = 'Browser storage is unavailable or full. Your latest change may not persist.';
      return false;
    }
  }

  function formatParts(timestamp, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
  }

  function wallTimeToInstant(value, timeZone) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) throw Error('Choose a valid date and time.');
    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    const target = Date.UTC(year, month - 1, day, hour, minute);
    const check = new Date(target);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day || hour > 23 || minute > 59) {
      throw Error('The date or time is invalid.');
    }
    let candidate = target;
    for (let attempt = 0; attempt < 6; attempt++) {
      const parts = formatParts(candidate, timeZone);
      const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
      const difference = target - represented;
      if (difference === 0) return candidate;
      candidate += difference;
    }
    const finalParts = formatParts(candidate, timeZone);
    if (finalParts.year !== year || finalParts.month !== month || finalParts.day !== day || finalParts.hour !== hour || finalParts.minute !== minute) {
      throw Error('That local time does not exist in this time zone, usually because clocks move forward. Choose another time.');
    }
    return candidate;
  }

  function renderCountdown(updateFields = false) {
    const output = document.querySelector('#preflight-countdown');
    const dateInput = document.querySelector('#preflight-ticket-time');
    const zoneInput = document.querySelector('#preflight-ticket-zone');
    if (!state.ticket) {
      output.textContent = 'Set your registration window to start a local countdown.';
      return;
    }
    if (updateFields) {
      dateInput.value = state.ticket.dateTime;
      zoneInput.value = state.ticket.timeZone;
    }
    const remaining = state.ticket.timestamp - Date.now();
    const opensAt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: state.ticket.timeZone }).format(state.ticket.timestamp);
    if (remaining <= 0) {
      output.textContent = `The saved registration window has passed (${opensAt} ${state.ticket.timeZone}). Update it when you have a new ticket time.`;
      return;
    }
    let seconds = Math.floor(remaining / 1000);
    const days = Math.floor(seconds / 86400); seconds %= 86400;
    const hours = Math.floor(seconds / 3600); seconds %= 3600;
    const minutes = Math.floor(seconds / 60); seconds %= 60;
    output.textContent = `Opens in ${days}d ${hours}h ${minutes}m ${seconds}s · ${opensAt} ${state.ticket.timeZone}.`;
  }

  function makeButton(label, action, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary';
    button.dataset.action = action;
    button.textContent = label;
    button.disabled = disabled;
    return button;
  }

  function renderChecklist() {
    const root = document.querySelector('#preflight-checklist');
    root.replaceChildren();
    if (!state.checklist.length) {
      const empty = document.createElement('li');
      empty.className = 'preflight-empty';
      empty.textContent = 'No holds or action items saved.';
      root.append(empty);
      return;
    }
    for (const item of state.checklist) {
      const row = document.createElement('li');
      row.className = 'preflight-check-item';
      const label = document.createElement('label');
      label.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = item.done;
      input.dataset.itemId = item.id;
      input.setAttribute('aria-label', `${item.done ? 'Mark incomplete' : 'Mark complete'}: ${item.kind}: ${item.text}`);
      const text = document.createElement('span');
      text.className = item.done ? 'preflight-done' : '';
      const kind = document.createElement('strong');
      kind.textContent = `${item.kind}: `;
      text.append(kind, document.createTextNode(escapeText(item.text)));
      label.append(input, text);
      const removeItem = makeButton('Remove', 'remove-item');
      removeItem.setAttribute('aria-label', `Remove ${item.kind}: ${item.text}`);
      row.append(label, removeItem);
      row.dataset.itemId = item.id;
      root.append(row);
    }
  }

  function compatibleBackups(item) {
    const choices = new Map();
    for (const schedule of availableSchedules) {
      const sections = new Map((schedule.sections || []).map(section => [
        `${section.subject || ''} ${section.course || ''}`.trim().toUpperCase().replace(/\s+/g, ' '), section
      ]));
      if (!state.order.every(primary => primary.courseCode === item.courseCode || String(sections.get(primary.courseCode)?.crn || '') === primary.crn)) continue;
      const candidate = sections.get(item.courseCode);
      const crn = String(candidate?.crn || '');
      if (/^\d{5}$/.test(crn) && crn !== item.crn) choices.set(crn, candidate);
    }
    return [...choices.entries()].map(([crn, section]) => ({ crn, section }));
  }

  function renderOrder() {
    const root = document.querySelector('#preflight-order');
    const reasonField = document.createElement('div');
    reasonField.className = 'field preflight-reason';
    const reasonLabel = document.createElement('label');
    reasonLabel.htmlFor = 'preflight-order-reason';
    reasonLabel.textContent = 'Why this order?';
    const reasonInput = document.createElement('input');
    reasonInput.id = 'preflight-order-reason';
    reasonInput.maxLength = 300;
    reasonInput.value = state.orderReason;
    reasonInput.placeholder = 'For example, register for the major course first';
    reasonInput.addEventListener('change', () => {
      state.orderReason = reasonInput.value.trim().slice(0, 300);
      saveState();
      updatePasteList();
    });
    reasonField.append(reasonLabel, reasonInput);
    root.replaceChildren();
    if (!state.order.length) {
      const empty = document.createElement('p');
      empty.className = 'preflight-empty';
      empty.textContent = 'No primary section order saved yet.';
      root.append(empty);
      document.querySelector('#preflight-order-status').textContent = 'Generate schedules and choose “Use this option as primary” to begin.';
      updatePasteList();
      return;
    }
    root.append(reasonField);
    state.order.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'preflight-order-item';
      const head = document.createElement('div');
      head.className = 'preflight-order-head';
      const title = document.createElement('strong');
      title.textContent = `${index + 1}. ${item.courseCode}`;
      const primary = document.createElement('span');
      primary.className = 'preflight-primary-crn';
      primary.textContent = `Primary section ID ${item.crn}`;
      head.append(title, primary);
      const actions = document.createElement('div');
      actions.className = 'card-actions';
      const up = makeButton('Move up', 'move-up', index === 0);
      const down = makeButton('Move down', 'move-down', index === state.order.length - 1);
      const remove = makeButton('Remove course', 'remove-course');
      up.setAttribute('aria-label', `Move ${item.courseCode} earlier in the section order`);
      down.setAttribute('aria-label', `Move ${item.courseCode} later in the section order`);
      remove.setAttribute('aria-label', `Remove ${item.courseCode} from the section order`);
      up.dataset.index = String(index); down.dataset.index = String(index); remove.dataset.index = String(index);
      actions.append(up, down, remove);
      card.append(head, actions);

      const currentBackups = document.createElement('ul');
      currentBackups.className = 'preflight-backups';
      const choices = compatibleBackups(item);
      for (const crn of item.backups) {
        const backupRow = document.createElement('li');
        const label = document.createElement('span');
        const stillAvailable = choices.some(choice => choice.crn === crn);
        label.textContent = `Backup section ID ${crn}${stillAvailable ? '' : ' · not in the latest compatible schedules; verify in Howdy'}`;
        const removeBackup = makeButton('Remove backup', 'remove-backup');
        removeBackup.setAttribute('aria-label', `Remove backup section ID ${crn} for ${item.courseCode}`);
        removeBackup.dataset.course = item.courseCode;
        removeBackup.dataset.crn = crn;
        backupRow.append(label, removeBackup);
        currentBackups.append(backupRow);
      }
      const backupLabel = document.createElement('label');
      backupLabel.className = 'field preflight-backup-add';
      backupLabel.textContent = `Add compatible backup for ${item.courseCode}`;
      const select = document.createElement('select');
      select.dataset.backupSelect = item.courseCode;
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = choices.length ? 'Choose a section ID' : 'No compatible generated backup';
      select.append(placeholder);
      for (const choice of choices.filter(choice => !item.backups.includes(choice.crn))) {
        const option = document.createElement('option');
        option.value = choice.crn;
        option.textContent = `${choice.crn}${choice.section.section ? ` · section ${choice.section.section}` : ''}`;
        select.append(option);
      }
      const add = makeButton('Add backup', 'add-backup', !choices.some(choice => !item.backups.includes(choice.crn)));
      add.dataset.course = item.courseCode;
      add.setAttribute('aria-label', `Add backup section ID for ${item.courseCode}`);
      backupLabel.append(select);
      card.append(currentBackups, backupLabel, add);
      root.append(card);
    });
    const sectionLabel = state.order.length === 1 ? 'section ID' : 'section IDs';
    document.querySelector('#preflight-order-status').textContent = `${state.order.length} primary ${sectionLabel} saved in your chosen order. Backups are selected separately and are not included in the copy list.`;
    updatePasteList();
  }

  function updatePasteList() {
    const textarea = document.querySelector('#preflight-crn-list');
    textarea.value = state.order.map(item => item.crn).join('\n');
    document.querySelector('#preflight-copy-crns').disabled = !state.order.length || !state.orderReason.trim();
    if (state.order.length && !state.orderReason.trim()) {
      document.querySelector('#preflight-order-status').textContent = 'Add a reason for this section order before copying it.';
    }
  }

  function setPrimaryOrder(detail) {
    const sections = Array.isArray(detail?.sections) ? detail.sections : [];
    const seen = new Set();
    const rows = sections.flatMap(section => {
      const courseCode = `${section.subject || ''} ${section.course || ''}`.trim().toUpperCase().replace(/\s+/g, ' ');
      const crn = String(section.crn || '');
      if (!courseCode || !/^\d{5}$/.test(crn) || seen.has(courseCode)) return [];
      seen.add(courseCode);
      const previous = state.order.find(item => item.courseCode === courseCode);
      return [{ courseCode, crn, backups: previous ? previous.backups.filter(value => value !== crn) : [] }];
    });
    if (!rows.length || rows.length !== sections.length) {
      document.querySelector('#preflight-order-status').textContent = 'This schedule has missing, duplicate, or invalid course/section ID details. No order was saved.';
      return;
    }
    state.order = rows;
    state.orderReason = `Selected from ranked schedule ${Number(detail.index) + 1}. Edit this reason or move courses to change the order.`;
    saveState();
    renderOrder();
    document.querySelector('#preflight-copy-status').textContent = '';
    document.querySelector('#preflight-order-heading').scrollIntoView({ block: 'nearest' });
  }

  document.querySelector('#preflight-ticket-form').addEventListener('submit', event => {
    event.preventDefault();
    const dateTime = document.querySelector('#preflight-ticket-time').value;
    const timeZone = document.querySelector('#preflight-ticket-zone').value.trim();
    try {
      if (!timeZone) throw Error('Enter a time zone, such as America/Chicago.');
      const timestamp = wallTimeToInstant(dateTime, timeZone);
      state.ticket = { dateTime, timeZone, timestamp };
      saveState();
      renderCountdown();
    } catch (error) {
      document.querySelector('#preflight-countdown').textContent = `Countdown not saved: ${error.message}`;
    }
  });

  document.querySelector('#preflight-item-form').addEventListener('submit', event => {
    event.preventDefault();
    const kind = document.querySelector('#preflight-item-kind').value;
    const input = document.querySelector('#preflight-item-text');
    const status = document.querySelector('#preflight-checklist-status');
    const text = input.value.trim().slice(0, 240);
    if (!text) return;
    if (state.checklist.length >= maxItems) {
      status.textContent = `The local checklist limit is ${maxItems} items. Remove one before adding another.`;
      return;
    }
    state.checklist.push({ id: crypto.randomUUID(), kind, text, done: false });
    saveState();
    input.value = '';
    status.textContent = '';
    renderChecklist();
    input.focus();
  });

  document.querySelector('#preflight-checklist').addEventListener('change', event => {
    const input = event.target.closest('input[data-item-id]');
    if (!input) return;
    const item = state.checklist.find(row => row.id === input.dataset.itemId);
    if (item) item.done = input.checked;
    saveState();
    renderChecklist();
  });
  document.querySelector('#preflight-checklist').addEventListener('click', event => {
    const button = event.target.closest('[data-action="remove-item"]');
    if (!button) return;
    const id = button.closest('[data-item-id]')?.dataset.itemId;
    state.checklist = state.checklist.filter(item => item.id !== id);
    saveState();
    document.querySelector('#preflight-checklist-status').textContent = '';
    renderChecklist();
  });

  document.querySelector('#preflight-order').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const index = Number(button.dataset.index);
    if (button.dataset.action === 'move-up' && index > 0) [state.order[index - 1], state.order[index]] = [state.order[index], state.order[index - 1]];
    else if (button.dataset.action === 'move-down' && index >= 0 && index < state.order.length - 1) [state.order[index + 1], state.order[index]] = [state.order[index], state.order[index + 1]];
    else if (button.dataset.action === 'remove-course' && index >= 0) state.order.splice(index, 1);
    else if (button.dataset.action === 'remove-backup') {
      const item = state.order.find(row => row.courseCode === button.dataset.course);
      if (item) item.backups = item.backups.filter(crn => crn !== button.dataset.crn);
    } else if (button.dataset.action === 'add-backup') {
      const item = state.order.find(row => row.courseCode === button.dataset.course);
      const selected = button.closest('.preflight-order-item')?.querySelector('select')?.value;
      if (item && selected && compatibleBackups(item).some(choice => choice.crn === selected) && !item.backups.includes(selected)) item.backups.push(selected);
    }
    saveState();
    renderOrder();
  });

  document.querySelector('#preflight-copy-crns').addEventListener('click', async () => {
    const textarea = document.querySelector('#preflight-crn-list');
    if (!state.order.length || !state.orderReason.trim()) return;
    try {
      if (!navigator.clipboard?.writeText) throw Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(textarea.value);
      document.querySelector('#preflight-copy-status').textContent = 'Primary section IDs copied in order. Backups were not copied.';
    } catch {
      textarea.focus();
      textarea.select();
      document.querySelector('#preflight-copy-status').textContent = 'Clipboard copy failed. The primary section IDs are selected in the text box. Use Ctrl+C or your device’s copy command. Backups are not included.';
    }
  });

  window.addEventListener('asb-preflight-alternatives', event => {
    availableSchedules = Array.isArray(event.detail?.results) ? event.detail.results : [];
    if (state.order.length) renderOrder();
  });
  window.addEventListener('asb-preflight-select-order', event => setPrimaryOrder(event.detail));

  renderCountdown(true);
  renderChecklist();
  renderOrder();
  window.setInterval(renderCountdown, 1000);
})();
