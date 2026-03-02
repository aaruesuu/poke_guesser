import {
  getDebutFilterSections,
  getActiveDebutTitles,
  getDebutTitleCounts,
  setDebutTitlesEnabled,
  selectAllDebutTitles,
  clearAllDebutTitles,
  getDebutSelectionSummary,
} from './settings.js';

const settingsOptionContainer = document.getElementById('settings-options');
const settingsSelectionSummary = document.getElementById('settings-selection-summary');
const settingsSelectAllButton = document.getElementById('settings-select-all');
const settingsClearAllButton = document.getElementById('settings-clear-all');

function updateDebutSelectionSummary() {
  if (!settingsSelectionSummary) return;
  const { effectiveSelected, total, usingFallback } = getDebutSelectionSummary();
  if (usingFallback) {
    settingsSelectionSummary.textContent = `有効な選択がありません（選択数: 0/${total}）`;
    return;
  }
  settingsSelectionSummary.textContent = `選択数：${effectiveSelected}/${total}`;
}

function renderDebutFilterOptions() {
  if (!settingsOptionContainer) return;
  const activeTitles = getActiveDebutTitles();
  const titleCounts = getDebutTitleCounts();
  const sections = getDebutFilterSections();

  settingsOptionContainer.innerHTML = '';

  sections.forEach((section) => {
    const sectionEl = document.createElement('section');
    sectionEl.className = 'settings-section';

    const heading = document.createElement('h3');
    heading.textContent = section.heading;
    sectionEl.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'settings-option-list';

    section.options.forEach((opt) => {
      const checkboxId = `settings-${opt.id}`;
      const wrapper = document.createElement('label');
      wrapper.className = 'settings-option';
      wrapper.setAttribute('for', checkboxId);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = checkboxId;
      const isActive = opt.titles.every((title) => activeTitles.has(title));
      const isPartial = !isActive && opt.titles.some((title) => activeTitles.has(title));
      checkbox.checked = isActive;
      checkbox.indeterminate = isPartial;

      checkbox.addEventListener('change', () => {
        setDebutTitlesEnabled(opt.titles, checkbox.checked);
        renderDebutFilterOptions();
      });

      const label = document.createElement('span');
      label.textContent = opt.label;

      const count = opt.titles.reduce((sum, title) => sum + (titleCounts[title] || 0), 0);
      const countEl = document.createElement('span');
      countEl.className = 'settings-option-count';
      countEl.textContent = `(${count})`;

      wrapper.appendChild(checkbox);
      wrapper.appendChild(label);
      wrapper.appendChild(countEl);
      list.appendChild(wrapper);
    });

    sectionEl.appendChild(list);
    settingsOptionContainer.appendChild(sectionEl);
  });

  updateDebutSelectionSummary();
}

if (settingsSelectAllButton) {
  settingsSelectAllButton.addEventListener('click', () => {
    selectAllDebutTitles();
    renderDebutFilterOptions();
  });
}

if (settingsClearAllButton) {
  settingsClearAllButton.addEventListener('click', () => {
    clearAllDebutTitles();
    renderDebutFilterOptions();
  });
}

renderDebutFilterOptions();
