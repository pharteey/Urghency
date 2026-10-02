'use strict';

/* ==========================================================
   Urgency: a small to-do app (vanilla JS + localStorage)

   Sections:
   1. Constants and app state
   2. Storage: loadTasks(), saveTasks()
   3. Task actions: addTask(), updateTask(), deleteTask(), toggleTask()
   4. Finding tasks: filterTasks(), searchTasks(), sortTasks()
   5. Rendering: renderTasks(), updateStatistics(), showToast()
   6. Forms and modals
   7. Theme
   8. Events and startup
   ========================================================== */

/* ---------- 1. Constants and app state ---------- */

const STORAGE_KEY = 'urgency.tasks';
const SEEDED_KEY = 'urgency.seeded';   // remembers that sample tasks were already added
const THEME_KEY = 'urgency.theme';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const CATEGORY_LABEL = { work: 'Work', personal: 'Personal', study: 'Study', other: 'Other' };

// Everything the UI depends on lives here.
const state = {
  tasks: [],            // [{ id, title, description, priority, category, dueDate, completed, createdAt }]
  filter: 'all',        // 'all' | 'pending' | 'completed' | 'high'
  query: '',            // text typed in the search box
  editingId: null,      // id of the task open in the edit modal
  deletingId: null,     // id of the task waiting for delete confirmation
  lastAddedId: null     // used to highlight a newly added card once
};

// DOM elements are looked up once, in cacheElements().
const el = {};
let addCollapse, editModal, deleteModal;

const ICONS = {
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>'
};

function icon(name) {
  return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
}

/* ---------- Small helpers ---------- */

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'task-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function pad(number) {
  return String(number).padStart(2, '0');
}

// Dates are stored as "YYYY-MM-DD" (what <input type="date"> gives us).
function toISODate(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function parseLocalDate(isoDate) {
  const parts = isoDate.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDate(date) {
  const options = { weekday: 'short', month: 'short', day: 'numeric' };
  if (date.getFullYear() !== new Date().getFullYear()) {
    options.year = 'numeric';
  }
  return date.toLocaleDateString(undefined, options);
}

/* ---------- 2. Storage ---------- */

function isValidTask(task) {
  return task && typeof task === 'object' &&
    typeof task.id === 'string' && typeof task.title === 'string';
}

// Fills in anything missing so older or hand-edited data cannot break the UI.
function normalizeTask(task) {
  return {
    id: task.id,
    title: task.title,
    description: typeof task.description === 'string' ? task.description : '',
    priority: PRIORITY_LABEL[task.priority] ? task.priority : 'medium',
    category: CATEGORY_LABEL[task.category] ? task.category : 'other',
    dueDate: typeof task.dueDate === 'string' ? task.dueDate : '',
    completed: Boolean(task.completed),
    createdAt: task.createdAt || new Date().toISOString()
  };
}

function createSampleTasks() {
  const today = new Date();
  const now = Date.now();
  return [
    {
      id: createId(),
      title: 'Prepare weekly report',
      description: 'Pull the numbers together and send a short summary to the team.',
      priority: 'high',
      category: 'work',
      dueDate: toISODate(today),
      completed: false,
      createdAt: new Date(now - 3000).toISOString()
    },
    {
      id: createId(),
      title: 'Buy groceries',
      description: 'Eggs, rice, tomatoes, and something for lunch.',
      priority: 'medium',
      category: 'personal',
      dueDate: toISODate(addDays(today, 1)),
      completed: false,
      createdAt: new Date(now - 2000).toISOString()
    },
    {
      id: createId(),
      title: 'Review mathematics notes',
      description: 'Chapters 4 and 5. Focus on the practice problems.',
      priority: 'low',
      category: 'study',
      dueDate: toISODate(addDays(today, 3)),
      completed: false,
      createdAt: new Date(now - 1000).toISOString()
    },
    {
      id: createId(),
      title: 'Return library books',
      description: '',
      priority: 'low',
      category: 'other',
      dueDate: '',
      completed: true,
      createdAt: new Date(now - 4000).toISOString()
    }
  ];
}

// Sample tasks are added on the very first visit only.
function loadTasks() {
  let tasks = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        tasks = parsed.filter(isValidTask).map(normalizeTask);
      }
    }
    if (!localStorage.getItem(SEEDED_KEY)) {
      if (!raw) {
        tasks = createSampleTasks();
      }
      localStorage.setItem(SEEDED_KEY, 'true');
    }
  } catch (error) {
    console.warn('Urgency could not read saved tasks.', error);
  }
  state.tasks = tasks;
  saveTasks();
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  } catch (error) {
    console.warn('Urgency could not save tasks.', error);
    showToast('Could not save your tasks in this browser.', 'danger');
  }
}

/* ---------- 3. Task actions ---------- */

function findTask(id) {
  return state.tasks.find(function (task) { return task.id === id; });
}

function addTask(data) {
  const task = {
    id: createId(),
    title: data.title,
    description: data.description,
    priority: data.priority,
    category: data.category,
    dueDate: data.dueDate,
    completed: false,
    createdAt: new Date().toISOString()
  };
  state.tasks.push(task);
  state.lastAddedId = task.id;
  saveTasks();
  showNewTask(task);
  showToast('Task added');
  return task;
}

function updateTask(id, changes) {
  const task = findTask(id);
  if (!task) return;
  Object.assign(task, changes);
  saveTasks();
  renderTasks();
  showToast('Task updated');
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(function (task) { return task.id !== id; });
  saveTasks();
  renderTasks();
  showToast('Task deleted', 'danger');
}

function toggleTask(id) {
  const task = findTask(id);
  if (!task) return;
  task.completed = !task.completed;
  saveTasks();
  renderTasks();
  showToast(task.completed ? 'Task completed' : 'Task marked as pending');
}

// If the current filter or search would hide a task the user just added,
// switch back to "All" and clear the search so they can see it.
function showNewTask(task) {
  const isVisible = getVisibleTasks().some(function (item) { return item.id === task.id; });
  if (!isVisible) {
    state.filter = 'all';
    state.query = '';
    el.search.value = '';
    syncFilterButtons();
  }
  renderTasks();
}

/* ---------- 4. Finding tasks ---------- */

function filterTasks(tasks, filter) {
  switch (filter) {
    case 'pending':
      return tasks.filter(function (task) { return !task.completed; });
    case 'completed':
      return tasks.filter(function (task) { return task.completed; });
    case 'high':
      // High priority means "high and still to do"
      return tasks.filter(function (task) { return task.priority === 'high' && !task.completed; });
    default:
      return tasks;
  }
}

function searchTasks(tasks, query) {
  const text = query.trim().toLowerCase();
  if (!text) return tasks;
  return tasks.filter(function (task) {
    const haystack = [task.title, task.description, CATEGORY_LABEL[task.category]].join(' ').toLowerCase();
    return haystack.includes(text);
  });
}

// Pending before completed, then High to Low, then soonest due date, then newest.
function sortTasks(tasks) {
  return tasks.slice().sort(function (a, b) {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    const dueA = a.dueDate || '9999-12-31';
    const dueB = b.dueDate || '9999-12-31';
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

function getVisibleTasks() {
  const filtered = filterTasks(state.tasks, state.filter);
  const searched = searchTasks(filtered, state.query);
  return sortTasks(searched);
}

/* ---------- 5. Rendering ---------- */

function getDueChipHTML(task) {
  if (!task.dueDate) return '';
  const dueDate = parseLocalDate(task.dueDate);
  if (isNaN(dueDate.getTime())) return '';

  const today = parseLocalDate(toISODate(new Date()));
  const days = Math.round((dueDate - today) / 86400000);
  let text = 'Due ' + formatDate(dueDate);
  let extraClass = '';

  // Completed tasks just show their date, with no warning colours.
  if (!task.completed) {
    if (days < 0) {
      text = 'Overdue by ' + Math.abs(days) + (Math.abs(days) === 1 ? ' day' : ' days');
      extraClass = ' chip--overdue';
    } else if (days === 0) {
      text = 'Due today';
      extraClass = ' chip--today';
    } else if (days === 1) {
      text = 'Due tomorrow';
    }
  }
  return '<span class="chip chip--due' + extraClass + '">' + escapeHtml(text) + '</span>';
}

function taskCardHTML(task) {
  const title = escapeHtml(task.title);
  const doneClass = task.completed ? ' is-done' : '';
  const newClass = task.id === state.lastAddedId ? ' is-new' : '';
  const checkLabel = (task.completed ? 'Mark as pending: ' : 'Mark as completed: ') + task.title;
  const description = task.description
    ? '<p class="task__desc">' + escapeHtml(task.description) + '</p>'
    : '';

  return '' +
    '<li class="task' + doneClass + newClass + '" data-id="' + escapeHtml(task.id) + '" data-priority="' + task.priority + '">' +
      '<label class="task__check">' +
        '<input type="checkbox" data-action="toggle"' + (task.completed ? ' checked' : '') +
          ' aria-label="' + escapeHtml(checkLabel) + '">' +
        '<span class="task__box" aria-hidden="true">' + icon('check') + '</span>' +
      '</label>' +
      '<div class="task__body">' +
        '<h3 class="task__title">' + title + '</h3>' +
        description +
        '<div class="task__meta">' +
          '<span class="chip chip--priority"><span class="visually-hidden">Priority: </span>' + PRIORITY_LABEL[task.priority] + '</span>' +
          '<span class="chip chip--category"><span class="visually-hidden">Category: </span>' + CATEGORY_LABEL[task.category] + '</span>' +
          getDueChipHTML(task) +
        '</div>' +
      '</div>' +
      '<div class="task__actions">' +
        '<button type="button" class="icon-btn" data-action="edit" aria-label="Edit task: ' + title + '">' + icon('pencil') + '</button>' +
        '<button type="button" class="icon-btn icon-btn--danger" data-action="delete" aria-label="Delete task: ' + title + '">' + icon('trash') + '</button>' +
      '</div>' +
    '</li>';
}

function getEmptyState() {
  const query = state.query.trim();
  if (query) {
    return {
      icon: 'search',
      title: 'No matching tasks',
      text: 'Nothing matches "' + query + '". Try a different word or clear the search.',
      action: 'clear-search',
      actionLabel: 'Clear search'
    };
  }
  if (state.tasks.length === 0) {
    return {
      icon: 'inbox',
      title: 'No tasks yet',
      text: "You're all caught up. Add a task to get started.",
      action: 'add',
      actionLabel: 'Add Task'
    };
  }
  if (state.filter === 'completed') {
    return { icon: 'check', title: 'No completed tasks', text: 'Finish a task and it will show up here.' };
  }
  if (state.filter === 'high') {
    return { icon: 'check', title: 'No high-priority tasks', text: 'Nothing urgent right now. Set a task to High priority to see it here.' };
  }
  return {
    icon: 'check',
    title: 'Nothing pending',
    text: 'Every task is done. Add a new one when you are ready.',
    action: 'add',
    actionLabel: 'Add Task'
  };
}

function renderEmptyState() {
  const info = getEmptyState();
  const button = info.action
    ? '<button type="button" class="btn-urgent" data-action="' + info.action + '">' + escapeHtml(info.actionLabel) + '</button>'
    : '';
  el.empty.innerHTML =
    '<div class="empty__icon">' + icon(info.icon) + '</div>' +
    '<h3 class="empty__title">' + escapeHtml(info.title) + '</h3>' +
    '<p class="empty__text">' + escapeHtml(info.text) + '</p>' +
    button;
}

function renderTasks() {
  const visible = getVisibleTasks();
  const isEmpty = visible.length === 0;

  el.list.innerHTML = visible.map(taskCardHTML).join('');
  el.list.hidden = isEmpty;
  el.empty.hidden = !isEmpty;
  if (isEmpty) renderEmptyState();

  el.resultCount.textContent = visible.length + (visible.length === 1 ? ' task shown' : ' tasks shown');
  state.lastAddedId = null;
  updateStatistics();
}

function updateStatistics() {
  const total = state.tasks.length;
  const completed = state.tasks.filter(function (task) { return task.completed; }).length;
  const highPending = state.tasks.filter(function (task) { return task.priority === 'high' && !task.completed; }).length;

  el.statAll.textContent = total;
  el.statPending.textContent = total - completed;
  el.statCompleted.textContent = completed;
  el.statHigh.textContent = highPending;
}

function showToast(message, type) {
  const kind = type || 'success';
  const toast = document.createElement('div');
  toast.className = 'toast urgency-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-atomic', 'true');
  toast.innerHTML =
    '<div class="d-flex align-items-center">' +
      '<span class="toast-dot toast-dot--' + kind + '" aria-hidden="true"></span>' +
      '<div class="toast-body flex-grow-1">' + escapeHtml(message) + '</div>' +
      '<button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Dismiss"></button>' +
    '</div>';
  el.toasts.appendChild(toast);
  toast.addEventListener('hidden.bs.toast', function () { toast.remove(); });
  new bootstrap.Toast(toast, { delay: 2800 }).show();
}

function updateGreeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  el.greeting.textContent = 'Good ' + part + ' \uD83D\uDC4B';
}

/* ---------- 6. Forms and modals ---------- */

function setInvalid(input, isInvalid) {
  input.classList.toggle('is-invalid', isInvalid);
}

function openAddForm() {
  if (el.addPanel.classList.contains('show')) {
    focusAddForm();
  } else {
    addCollapse.show();
  }
}

function focusAddForm() {
  el.addTitle.focus({ preventScroll: true });
  el.addPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closeAddForm() {
  el.addForm.reset();
  setInvalid(el.addTitle, false);
  addCollapse.hide();
}

function handleAddSubmit(event) {
  event.preventDefault();
  const title = el.addTitle.value.trim();
  if (!title) {
    setInvalid(el.addTitle, true);
    el.addTitle.focus();
    return;
  }
  addTask({
    title: title,
    description: el.addDescription.value.trim(),
    priority: el.addPriority.value,
    category: el.addCategory.value,
    dueDate: el.addDue.value
  });
  el.addForm.reset();
  setInvalid(el.addTitle, false);
  el.addTitle.focus({ preventScroll: true });   // ready for the next task
}

function openEditModal(id) {
  const task = findTask(id);
  if (!task) return;
  state.editingId = id;
  el.editTitle.value = task.title;
  el.editDescription.value = task.description;
  el.editPriority.value = task.priority;
  el.editCategory.value = task.category;
  el.editDue.value = task.dueDate;
  setInvalid(el.editTitle, false);
  editModal.show();
}

function handleEditSubmit(event) {
  event.preventDefault();
  const title = el.editTitle.value.trim();
  if (!title) {
    setInvalid(el.editTitle, true);
    el.editTitle.focus();
    return;
  }
  updateTask(state.editingId, {
    title: title,
    description: el.editDescription.value.trim(),
    priority: el.editPriority.value,
    category: el.editCategory.value,
    dueDate: el.editDue.value
  });
  editModal.hide();
}

function openDeleteModal(id) {
  const task = findTask(id);
  if (!task) return;
  state.deletingId = id;
  el.deletePreview.textContent = task.title;
  deleteModal.show();
}

function confirmDelete() {
  if (state.deletingId) {
    deleteTask(state.deletingId);
    state.deletingId = null;
  }
  deleteModal.hide();
}

/* ---------- Filters and search ---------- */

function syncFilterButtons() {
  el.filters.querySelectorAll('.filter').forEach(function (button) {
    const isActive = button.dataset.filter === state.filter;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function setFilter(filter) {
  state.filter = filter;
  syncFilterButtons();
  renderTasks();
}

function setSearch(query) {
  state.query = query;
  renderTasks();
}

function clearSearch() {
  el.search.value = '';
  setSearch('');
  el.search.focus();
}

/* ---------- 7. Theme ---------- */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-bs-theme', theme);
  el.themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-bs-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (error) { /* theme just won't persist */ }
}

/* ---------- 8. Events and startup ---------- */

function cacheElements() {
  const byId = function (id) { return document.getElementById(id); };

  el.greeting = byId('greeting');
  el.openAdd = byId('open-add');
  el.themeToggle = byId('theme-toggle');

  el.statAll = byId('stat-all');
  el.statPending = byId('stat-pending');
  el.statCompleted = byId('stat-completed');
  el.statHigh = byId('stat-high');

  el.addPanel = byId('add-task-panel');
  el.addForm = byId('add-task-form');
  el.addTitle = byId('add-title');
  el.addDescription = byId('add-description');
  el.addPriority = byId('add-priority');
  el.addCategory = byId('add-category');
  el.addDue = byId('add-due');
  el.addCancel = byId('add-cancel');

  el.filters = byId('filters');
  el.search = byId('search-input');
  el.list = byId('task-list');
  el.empty = byId('empty-state');
  el.resultCount = byId('result-count');

  el.editModal = byId('edit-modal');
  el.editForm = byId('edit-task-form');
  el.editTitle = byId('edit-title');
  el.editDescription = byId('edit-description');
  el.editPriority = byId('edit-priority');
  el.editCategory = byId('edit-category');
  el.editDue = byId('edit-due');

  el.deleteModal = byId('delete-modal');
  el.deletePreview = byId('delete-preview');
  el.confirmDelete = byId('confirm-delete');

  el.toasts = byId('toast-container');
}

function bindEvents() {
  // Header and theme
  el.openAdd.addEventListener('click', openAddForm);
  el.themeToggle.addEventListener('click', toggleTheme);

  // Add task form
  el.addForm.addEventListener('submit', handleAddSubmit);
  el.addCancel.addEventListener('click', closeAddForm);
  el.addTitle.addEventListener('input', function () { setInvalid(el.addTitle, false); });
  el.addPanel.addEventListener('shown.bs.collapse', function () {
    el.openAdd.setAttribute('aria-expanded', 'true');
    focusAddForm();
  });
  el.addPanel.addEventListener('hidden.bs.collapse', function () {
    el.openAdd.setAttribute('aria-expanded', 'false');
  });

  // Filters and search
  el.filters.addEventListener('click', function (event) {
    const button = event.target.closest('[data-filter]');
    if (button) setFilter(button.dataset.filter);
  });
  el.search.addEventListener('input', function () { setSearch(el.search.value); });

  // Task cards (one listener for the whole list)
  el.list.addEventListener('click', function (event) {
    const button = event.target.closest('button[data-action]');
    const card = event.target.closest('.task');
    if (!button || !card) return;
    if (button.dataset.action === 'edit') openEditModal(card.dataset.id);
    if (button.dataset.action === 'delete') openDeleteModal(card.dataset.id);
  });
  el.list.addEventListener('change', function (event) {
    if (event.target.dataset.action !== 'toggle') return;
    const card = event.target.closest('.task');
    const id = card.dataset.id;
    toggleTask(id);
    // Keep keyboard focus on the same checkbox after the list re-renders
    const checkbox = el.list.querySelector('[data-id="' + id + '"] input[type="checkbox"]');
    if (checkbox) checkbox.focus();
  });

  // Empty state buttons
  el.empty.addEventListener('click', function (event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'add') openAddForm();
    if (button.dataset.action === 'clear-search') clearSearch();
  });

  // Edit modal
  el.editForm.addEventListener('submit', handleEditSubmit);
  el.editTitle.addEventListener('input', function () { setInvalid(el.editTitle, false); });
  el.editModal.addEventListener('shown.bs.modal', function () { el.editTitle.focus(); });

  // Delete modal
  el.confirmDelete.addEventListener('click', confirmDelete);
}

function init() {
  cacheElements();

  addCollapse = new bootstrap.Collapse(el.addPanel, { toggle: false });
  editModal = new bootstrap.Modal(el.editModal);
  deleteModal = new bootstrap.Modal(el.deleteModal);

  applyTheme(document.documentElement.getAttribute('data-bs-theme') || 'light');
  updateGreeting();
  loadTasks();
  bindEvents();
  renderTasks();
}

document.addEventListener('DOMContentLoaded', init);
