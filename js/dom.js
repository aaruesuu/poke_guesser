import {
  allPokemonData
} from "./all-pokemon-data.js";

import {
  formatDisplayName,
  normalizePokemonName,
  formatDebut,
  formatGenderRate,
} from "./utils.js";
  
import {
  getDebutFilterSections,
  getActiveDebutTitles,
  getDebutTitleCounts,
  setDebutTitlesEnabled,
  selectAllDebutTitles,
  clearAllDebutTitles,
  getDebutSelectionSummary,
} from "./settings.js";

const allPokemonNames = Object.keys(allPokemonData);

const modeSelectionScreen = document.getElementById('mode-selection-screen');
const gameContainer = document.getElementById('game-container');
const settingsScreen = document.getElementById('settings-screen');

const randomStartModeButton = document.getElementById('random-start-mode-button');
const statsModeButton = document.getElementById('base-stats-mode-button');
const versusModeButton = document.getElementById('versus-mode-button');

const guessButton = document.getElementById('guess-button');
const headerLogo = document.getElementById('logo-home');
const homeButton = document.getElementById('home-button');
const hintButton = document.getElementById('hint-button');

const howToPlayButtonHome = document.getElementById('how-to-play-button-home');
const settingsButton = document.getElementById('settings-button');
const settingsButtonHome = document.getElementById('settings-button-home');
const howToHomeToggle = document.getElementById('how-to-home-toggle');
const howtoSection = document.getElementById("how-to-home-section");


const HOW_TO_COLLAPSE_KEY = 'howtoCollapsed';

const modalOverlay = document.getElementById('modal-overlay');
const modalContent = document.getElementById('modal-content');
const modalCloseButton = document.getElementById('modal-close-button');

const resultModalOverlay = document.getElementById('result-modal-overlay');
const resultModal = document.getElementById('result-modal');
const resultModalCloseButton = document.getElementById('result-modal-close-button');

const guessInput = document.getElementById('guess-input');
const resultHistory = document.getElementById('result-history');
const gameControls = document.getElementById('game-controls');
const inputArea = document.getElementById('input-area');
const suggestionsBox = document.getElementById('suggestions-box');
const randomStartButton = document.getElementById('random-start-button');
const resultsArea = document.getElementById('results-area');

const postGamePlayAgainButton = document.getElementById('post-game-play-again');
const postGameBackToMenuButton = document.getElementById('post-game-back-to-menu');
const gameTitle = document.getElementById('game-title');
const gameStatus = document.getElementById('game-status');
const turnsRemaining = document.getElementById('turns-remaining');

const settingsOptionContainer = document.getElementById('settings-options');
const settingsSelectionSummary = document.getElementById('settings-selection-summary');
const settingsSaveButton = document.getElementById('settings-save-button');
const settingsCancelButton = document.getElementById('settings-cancel-button');
const settingsSelectAllButton = document.getElementById('settings-select-all');
const settingsClearAllButton = document.getElementById('settings-clear-all');

let resultAccordionSeq = 0;
let lastNonSettingsScreen = modeSelectionScreen?.id || 'mode-selection-screen';

function setAccordionExpanded(btn, expanded) {
  if (!btn) return;
  const panelId = btn.getAttribute('aria-controls');
  const panel = document.getElementById(panelId);
  if (!panel) return;

  btn.setAttribute('aria-expanded', String(expanded));
  if (expanded) {
    panel.hidden = false;
    panel.style.maxHeight = panel.scrollHeight + 'px';
  } else {
    panel.style.maxHeight = '0px';
    setTimeout(() => { panel.hidden = true; }, 200);
  }
}

function toggleAccordion(btn) {
  if (!btn) return;
  const expanded = btn.getAttribute('aria-expanded') === 'true';
  setAccordionExpanded(btn, !expanded);
}

export function initDOM(handlers) {
  const { onStartRandom, onStartStats, onGuess, onRandomStart, onPlayAgain, onBackToMenu, onHint } = handlers;

  if (randomStartModeButton) randomStartModeButton.addEventListener('click', onStartRandom);
  if (statsModeButton) statsModeButton.addEventListener('click', onStartStats);
  if (versusModeButton && handlers.onStartVersus) versusModeButton.addEventListener('click', handlers.onStartVersus);
  if (randomStartButton) randomStartButton.addEventListener('click', onRandomStart);
  if (guessButton) guessButton.addEventListener('click', onGuess);
  if (headerLogo) headerLogo.addEventListener('click', onBackToMenu);
  if (homeButton) {
    homeButton.addEventListener('click', (event) => {
      event.preventDefault();
      onBackToMenu();
    });
  }
  if (hintButton && typeof onHint === 'function') hintButton.addEventListener('click', onHint);
  if (postGamePlayAgainButton) postGamePlayAgainButton.addEventListener('click', onPlayAgain);
  if (postGameBackToMenuButton) postGameBackToMenuButton.addEventListener('click', onBackToMenu);

  if (guessInput) guessInput.addEventListener('input', handleInput);
  document.addEventListener('click', (event) => {
    if (gameControls && !gameControls.contains(event.target)) {
      suggestionsBox.classList.add('hidden');
    }
  });

  if (howToPlayButtonHome) howToPlayButtonHome.addEventListener('click', openHowToPlayModal);
  if (settingsButton) settingsButton.addEventListener('click', openSettingsScreen);
  if (settingsButtonHome) settingsButtonHome.addEventListener('click', openSettingsScreen);

  if (howToHomeToggle && howtoSection) {
    const isCollapsed = localStorage.getItem(HOW_TO_COLLAPSE_KEY) === '1';
    setAccordionExpanded(howToHomeToggle, !isCollapsed);

    // 初期状態（リロード後）も反映
    if (isCollapsed) {
      howtoSection.classList.remove('is-expanded');
    } else {
      howtoSection.classList.add('is-expanded');
    }

    howToHomeToggle.addEventListener('click', () => {
      toggleAccordion(howToHomeToggle);

      const collapsed = howToHomeToggle.getAttribute('aria-expanded') !== 'true';

      if (collapsed) {
        localStorage.setItem(HOW_TO_COLLAPSE_KEY, '1');
        howtoSection.classList.remove('is-expanded');   // ← 追加
      } else {
        localStorage.removeItem(HOW_TO_COLLAPSE_KEY);
        howtoSection.classList.add('is-expanded');      // ← 追加
      }
    });
  }

  if (modalCloseButton) modalCloseButton.addEventListener('click', closeModal);
  if (modalOverlay) modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

  if (resultModalCloseButton) {
    resultModalCloseButton.addEventListener('click', () => {
      resultModalOverlay.classList.add('hidden');
      const el = document.getElementById('post-game-actions');
      if (el) el.classList.remove('hidden');
    });
  }
  if (resultModalOverlay) {
    resultModalOverlay.addEventListener('click', (e) => {
      if (e.target === resultModalOverlay) {
        resultModalOverlay.classList.add('hidden');
        const el = document.getElementById('post-game-actions');
        if (el) el.classList.remove('hidden');
      }
    });
  }
  
  if (settingsSaveButton) settingsSaveButton.addEventListener('click', closeSettingsScreen);
  if (settingsCancelButton) settingsCancelButton.addEventListener('click', closeSettingsScreen);
  if (settingsSelectAllButton) settingsSelectAllButton.addEventListener('click', () => {
    selectAllDebutTitles();
    renderDebutFilterOptions();
  });
  if (settingsClearAllButton) settingsClearAllButton.addEventListener('click', () => {
    clearAllDebutTitles();
    renderDebutFilterOptions();
  });

  renderDebutFilterOptions();
}

export function switchScreen(targetScreen) {
  const screens = [
    modeSelectionScreen,
    gameContainer,
    settingsScreen,
  ].filter(Boolean);
  screens.forEach(screen => {
    if (screen.id === targetScreen) {
      screen.classList.remove('hidden');
    } else {
      screen.classList.add('hidden');
    }
  });
  if (targetScreen && targetScreen !== 'settings-screen') {
    lastNonSettingsScreen = targetScreen;
  }
}
  
export function setGameStatus(text) { gameStatus.textContent = text || ""; }
export function setGameTitle(text) { gameTitle.textContent = text || ""; }
export function updateStatusUI(text) { gameStatus.textContent = text || ""; }
export function setTurnsRemaining(text) {
  if (!turnsRemaining) return;
  if (!text) {
    turnsRemaining.textContent = "";
    turnsRemaining.classList.add('hidden');
    return;
  }
  turnsRemaining.textContent = text;
  turnsRemaining.classList.remove('hidden');
}

export function hideResultsArea() {
  if (resultsArea?.style) {
    resultsArea.style.display = 'none';
  }
  resultsArea?.classList?.add('hidden');
}

export function showResultsArea() {
  if (resultsArea?.style) {
    resultsArea.style.display = '';
  }
  resultsArea?.classList?.remove('hidden');
}

export function renderResult(pokemon, comparisonResult, gameMode, isCorrect = false) {
  const row = document.createElement('div');
  row.classList.add('result-row');
  row.classList.add(gameMode === 'stats' ? 'result-row-stats' : 'result-row-classic');

  if (isCorrect) {
    row.id = 'result-history-correct';
    row.classList.add('is-correct');
  }

  const { main: mainName, form: formName } = formatDisplayName(pokemon.name);
  const displayNameHTML = formName ? `${mainName}<br><span class="form-name">${formName}</span>` : mainName;

  const header = document.createElement('button');
  header.type = 'button';
  const accId = `rh-acc-${++resultAccordionSeq}`;
  const panelId = `${accId}-panel`;

  header.classList.add('result-header', 'accordion-trigger');
  header.setAttribute('id', accId);
  header.setAttribute('aria-controls', panelId);
  header.setAttribute('aria-expanded','true');

  header.innerHTML = `
    <img src="${pokemon.sprite}" alt="${pokemon.name}" class="result-sprite">
    <div class="result-name">${displayNameHTML}</div>
  `;

  const icon = document.createElement('span');
  icon.className = 'accordion-icon';
  icon.setAttribute('aria-hidden','true');
  header.appendChild(icon);

  row.appendChild(header);

  if (!resultHistory.dataset.accordionReady) {
    setupAccordion(resultHistory);
    resultHistory.dataset.accordionReady = "1";
  }

  header.addEventListener('click', () => toggleAccordion(header));
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleAccordion(header);
    }
  });

  const bodyContainer = document.createElement('div');
  bodyContainer.classList.add('result-body', 'accordion-panel');

  bodyContainer.setAttribute('id', panelId);
  bodyContainer.setAttribute('role','region');
  bodyContainer.setAttribute('aria-labelledby', accId);

  const formatCombinedField = (items) => {
    const filtered = items.filter(item => item && item !== 'なし');
    return filtered.length > 0 ? filtered.join(' / ') : '—';
  };

  const totalStats =
    pokemon.stats.hp + pokemon.stats.attack + pokemon.stats.defense +
    pokemon.stats.spAttack + pokemon.stats.spDefense + pokemon.stats.speed;

  if (gameMode === 'stats') {
    bodyContainer.innerHTML = `
      <div class="${comparisonResult.stats.hp.class}">
        <div class="value-wrapper"><span>${pokemon.stats.hp}</span><span class="${comparisonResult.stats.hp.symbolClass}">${comparisonResult.stats.hp.symbol}</span></div>
      </div>
      <div class="${comparisonResult.stats.attack.class}">
        <div class="value-wrapper"><span>${pokemon.stats.attack}</span><span class="${comparisonResult.stats.attack.symbolClass}">${comparisonResult.stats.attack.symbol}</span></div>
      </div>
      <div class="${comparisonResult.stats.defense.class}">
        <div class="value-wrapper"><span>${pokemon.stats.defense}</span><span class="${comparisonResult.stats.defense.symbolClass}">${comparisonResult.stats.defense.symbol}</span></div>
      </div>
      <div class="${comparisonResult.stats.spAttack.class}">
        <div class="value-wrapper"><span>${pokemon.stats.spAttack}</span><span class="${comparisonResult.stats.spAttack.symbolClass}">${comparisonResult.stats.spAttack.symbol}</span></div>
      </div>
      <div class="${comparisonResult.stats.spDefense.class}">
        <div class="value-wrapper"><span>${pokemon.stats.spDefense}</span><span class="${comparisonResult.stats.spDefense.symbolClass}">${comparisonResult.stats.spDefense.symbol}</span></div>
      </div>
      <div class="${comparisonResult.stats.speed.class}">
        <div class="value-wrapper"><span>${pokemon.stats.speed}</span><span class="${comparisonResult.stats.speed.symbolClass}">${comparisonResult.stats.speed.symbol}</span></div>
      </div>
    `;
  } else {
    bodyContainer.innerHTML = `
      <div class="${comparisonResult.debut.class}">
        <div class="value-wrapper">
          <span>${formatDebut(pokemon.debutGen, pokemon.debutTitle)}</span>
          <span class="${comparisonResult.debut.symbolClass}">${comparisonResult.debut.symbol}</span>
        </div>
      </div>
      <div class="${comparisonResult.totalStats.class}">
        <div class="value-wrapper"><span>${totalStats}</span><span class="${comparisonResult.totalStats.symbolClass}">${comparisonResult.totalStats.symbol}</span></div>
      </div>
      <div class="${comparisonResult.types} full-width">${formatCombinedField([pokemon.type1, pokemon.type2])}</div>
      <div class="${comparisonResult.abilities} full-width">${formatCombinedField([pokemon.ability1, pokemon.ability2, pokemon.hiddenAbility])}</div>
      <div class="${comparisonResult.height.class}">
        <div class="value-wrapper"><span>${pokemon.height}m</span><span class="${comparisonResult.height.symbolClass}">${comparisonResult.height.symbol}</span></div>
      </div>
      <div class="${comparisonResult.weight.class}">
        <div class="value-wrapper"><span>${pokemon.weight}kg</span><span class="${comparisonResult.weight.symbolClass}">${comparisonResult.weight.symbol}</span></div>
      </div>
      <div class="${comparisonResult.genderRate}">${formatGenderRate(pokemon.genderRate)}</div>
      <div class="${comparisonResult.evolutionCount}">${pokemon.evolutionCount}</div>
      <div class="${comparisonResult.eggGroups} full-width">${formatCombinedField([pokemon.eggGroup1, pokemon.eggGroup2])}</div>
    `;
  }

  row.appendChild(bodyContainer);
  resultHistory.insertAdjacentElement('afterbegin', row);
  return row;
}

export function collapseResultRow(row) {
  if (!row) return;
  const trigger = row.querySelector('.accordion-trigger');
  if (!trigger) return;
  setAccordionExpanded(trigger, false);
}

export function lockResultRow(row) {
  if (!row) return;
  row.classList.add('versus-history-locked');
  const trigger = row.querySelector('.accordion-trigger');
  if (!trigger) return;
  if (!trigger.hasAttribute('data-lock-prev-disabled')) {
    trigger.dataset.lockPrevDisabled = trigger.disabled ? '1' : '0';
  }
  trigger.disabled = true;
  trigger.setAttribute('aria-disabled', 'true');
}

export function unlockResultRow(row) {
  if (!row) return;
  row.classList.remove('versus-history-locked');
  const trigger = row.querySelector('.accordion-trigger');
  if (!trigger) return;
  const prevDisabled = trigger.getAttribute('data-lock-prev-disabled');
  if (prevDisabled === '1') {
    trigger.disabled = true;
    trigger.setAttribute('aria-disabled', 'true');
  } else {
    trigger.disabled = false;
    trigger.removeAttribute('aria-disabled');
  }
  trigger.removeAttribute('data-lock-prev-disabled');
}

export function getResultRows() {
  return Array.from(resultHistory.querySelectorAll('.result-row'));
}

export function showResultModal(pokemon, verdict, gameMode, guessesLeft, usedHintLabels = [], options = {}) {
  const verdictEl = resultModal.querySelector('#result-modal-verdict span');
  verdictEl.textContent = verdict;

  const scoreEl = resultModal.querySelector('#result-modal-score');
  scoreEl.textContent = '';

  const crackerImages = resultModal.querySelectorAll('.verdict-cracker-img');
  const isVictory = verdict === '正解' || verdict === '勝利';
  if (isVictory) {
    crackerImages.forEach(img => img.classList.remove('hidden'));
    if (gameMode === 'versus') {
      if (options.finishedReason === 'surrender') {
        scoreEl.textContent = '相手が降参しました';
      } else {
        scoreEl.textContent = 'おめでとうございます！';
      }
    } else {
      const guessesTaken = 10 - guessesLeft;
      scoreEl.textContent = `${guessesTaken}回でクリア`;
    }
  } else {
    crackerImages.forEach(img => img.classList.add('hidden'));
    if (gameMode === 'versus') {
      if (verdict === '引き分け') {
        scoreEl.textContent = '回答数が上限に達しました。';
      } else if (options.finishedReason === 'surrender') {
        scoreEl.textContent = '降参しました';
      } else {
        scoreEl.textContent = '相手が正解しました。';
      }
    }
  }

  const setData = (field, value) => {
    const el = resultModal.querySelector(`[data-field="${field}"]`);
    if (el) el.textContent = value;
  };

  resultModal.querySelector('[data-field="sprite"]').src = pokemon.sprite;

  const { main: mainName, form: formName } = formatDisplayName(pokemon.name);
  setData('name', mainName);
  setData('form', formName);

  let nationalNo = pokemon.id;
  if (pokemon.name.includes('（')) {
    const baseName = pokemon.name.split('（')[0];
    const allPokemonArray = Object.values(allPokemonData);
    const candidateForms = allPokemonArray.filter(p => p.name.startsWith(baseName));
    if (candidateForms.length > 0) {
      const baseForm = candidateForms.reduce((minPokemon, currentPokemon) => {
        return currentPokemon.id < minPokemon.id ? currentPokemon : minPokemon;
      });
      nationalNo = baseForm.id;
    }
  }
  setData('nationalNo', nationalNo ? `No. ${String(nationalNo).padStart(4, '0')}` : '---');

  const profileLeft = resultModal.querySelector('.profile-left');
  const formatCombinedField = (items) => {
    const filtered = items.filter(item => item && item !== 'なし');
    return filtered.length > 0 ? filtered.join(' / ') : '—';
  };
  const totalStats =
    pokemon.stats.hp + pokemon.stats.attack + pokemon.stats.defense +
    pokemon.stats.spAttack + pokemon.stats.spDefense + pokemon.stats.speed;

  profileLeft.innerHTML = `
    <div class="modal-grid-item"><span class="modal-grid-label">初登場作品（世代）</span><span class="modal-grid-value">${formatDebut(pokemon.debutGen, pokemon.debutTitle)}</span></div>
    <div class="modal-grid-item"><span class="modal-grid-label">合計種族値</span><span class="modal-grid-value">${totalStats}</span></div>
    <div class="modal-grid-item full-width"><span class="modal-grid-label">タイプ</span><span class="modal-grid-value">${formatCombinedField([pokemon.type1, pokemon.type2])}</span></div>
    <div class="modal-grid-item full-width"><span class="modal-grid-label">特性</span><span class="modal-grid-value">${formatCombinedField([pokemon.ability1, pokemon.ability2, pokemon.hiddenAbility])}</span></div>
    <div class="modal-grid-item"><span class="modal-grid-label">高さ</span><span class="modal-grid-value">${pokemon.height} m</span></div>
    <div class="modal-grid-item"><span class="modal-grid-label">重さ</span><span class="modal-grid-value">${pokemon.weight} kg</span></div>
    <div class="modal-grid-item"><span class="modal-grid-label">性別比</span><span class="modal-grid-value">${formatGenderRate(pokemon.genderRate)}</span></div>
    <div class="modal-grid-item"><span class="modal-grid-label">進化数</span><span class="modal-grid-value">${pokemon.evolutionCount}</span></div>
    <div class="modal-grid-item full-width"><span class="modal-grid-label">タマゴグループ</span><span class="modal-grid-value">${formatCombinedField([pokemon.eggGroup1, pokemon.eggGroup2])}</span></div>
  `;

  const profileDetails = resultModal.querySelector('.profile-left'); profileDetails.classList.add('pair-grid');
  const profileStats = resultModal.querySelector('.profile-right');
  
  // ★修正: 対戦モード(versus)も基本モードと同じレイアウト(Stats非表示、Details全幅)にする
  if (gameMode === 'randomStart' || gameMode === 'versus') {
    profileStats.classList.add('hidden');
    profileDetails.style.gridColumn = '1 / -1';
  } else {
    profileStats.classList.remove('hidden');
    profileDetails.style.gridColumn = '';
  }

  const postGameActions = document.getElementById('post-game-actions');
  if (postGameActions) postGameActions.classList.add('hidden');
  const playAgainBtn = document.getElementById('post-game-play-again');
  const backToMenuBtn = document.getElementById('post-game-back-to-menu');
  if (postGameActions) {
    if (gameMode === 'versus') {
      postGameActions.classList.add('is-versus');
    } else {
      postGameActions.classList.remove('is-versus');
    }
  }
  if (playAgainBtn) {
    if (gameMode === 'versus') {
      playAgainBtn.classList.add('hidden');
    } else {
      playAgainBtn.classList.remove('hidden');
    }
  }
  if (backToMenuBtn) {
    backToMenuBtn.textContent = gameMode === 'versus' ? 'ホームへ戻る' : 'モード選択へ';
  }
  const hintSection = resultModal.querySelector('#result-modal-hints');
  const hintListEl = hintSection?.querySelector('.result-hints-list');
  if (hintSection && hintListEl) {
    const hasHints = Array.isArray(usedHintLabels) && usedHintLabels.length > 0;
    hintListEl.textContent = hasHints ? usedHintLabels.join('・') : 'なし';
    hintSection.classList.remove('hidden');
  }

  resultModalOverlay.classList.remove('hidden');
}
  
export function clearResults() { resultHistory.innerHTML = ""; }
export function blurGuessInput(){ if (guessInput) guessInput.blur(); }
export function getGuessInputValue(){ return guessInput ? guessInput.value.trim() : ""; }
export function clearGuessInput(){ if (guessInput) guessInput.value = ""; }

export function showHintButton() {
  if (hintButton) {
    hintButton.classList.remove('hidden');
  }
}

export function hideHintButton() {
  if (hintButton) {
    hintButton.classList.add('hidden');
  }
}

export function setHintButtonEnabled(enabled) {
  if (hintButton) {
    hintButton.disabled = !enabled;
    hintButton.classList.toggle('is-disabled', !enabled);
    hintButton.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  }
}

export function renderMaskedVersusGuess(isMine = false) {
  const row = document.createElement('div');
  row.classList.add('result-row', 'result-row-classic', 'is-masked');
  row.classList.add(isMine ? 'by-me' : 'by-opponent');

  const header = document.createElement('div');
  header.classList.add('masked-result-header');
  header.innerHTML = '<span class="masked-question">???</span>';
  row.appendChild(header);

  const body = document.createElement('div');
  body.classList.add('masked-result-body');
  body.innerHTML = `<p>${isMine ? 'この回答は相手から秘匿されています' : '相手の回答は秘匿されています'}</p>`;
  row.appendChild(body);

  resultHistory.insertAdjacentElement('afterbegin', row);
  return row;
}


let suggestionRequestToken = 0;
function handleInput() {
  const currentToken = ++suggestionRequestToken;
  const inputText = guessInput.value.trim();
  if (inputText.length === 0) {
    suggestionsBox.classList.add('hidden');
    return;
  }

  suggestionsBox.style.width = `${guessInput.offsetWidth}px`;

  const inputTextKana = normalizePokemonName(inputText);
  const suggestions = allPokemonNames
  .map(name => {
    const normalizedName = normalizePokemonName(name);
    const matchIndex = normalizedName.indexOf(inputTextKana);
    if (matchIndex === -1) return null;
    return { name, matchIndex, length: normalizedName.length };
  })
  .filter(Boolean)
  .sort((a, b) => a.matchIndex - b.matchIndex || a.length - b.length || a.name.localeCompare(b.name, "ja"))
  .slice(0, 100)
  .map(({ name }) => name);

  if (currentToken !== suggestionRequestToken) return;

  if (suggestions.length > 0) {
    const itemsHtml = suggestions.map(name => {
      const pokemon = allPokemonData[name];
      const spriteUrl = pokemon ? pokemon.sprite : 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png';
      return `
        <div class="suggestion-item" data-name="${name}">
          <img src="${spriteUrl}" alt="${name}" class="suggestion-sprite">
          <span>${name}</span>
        </div>
      `;
    }).join('');

    suggestionsBox.innerHTML = itemsHtml;
    suggestionsBox.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        guessInput.value = item.dataset.name;
        suggestionsBox.classList.add('hidden');
        guessInput.focus();
      });
    });
    suggestionsBox.classList.remove('hidden');
  } else {
    suggestionsBox.classList.add('hidden');
  }
}
  
function openSettingsScreen() {
  renderDebutFilterOptions();
  switchScreen('settings-screen');
}

function closeSettingsScreen() {
  switchScreen(lastNonSettingsScreen || 'mode-selection-screen');
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

function updateDebutSelectionSummary() {
  if (!settingsSelectionSummary) return;
  const { selected, effectiveSelected, total, usingFallback } = getDebutSelectionSummary();
  const allSelected = effectiveSelected >= total && !usingFallback;
  if (usingFallback) {
    settingsSelectionSummary.textContent = `有効な選択がありません（選択数: 0/${total}）`;
    return;
  }
  settingsSelectionSummary.textContent = allSelected
    ? `選択数：${effectiveSelected}/${total}`
    : `選択数：${effectiveSelected}/${total}`;
}

export function openModal(title, content, options = {}) {

  const { addHeaderDivider = true } = options;

  const titleHTML = title
    ? `<div class="modal-head">
         <h3>${title}</h3>
         ${addHeaderDivider ? '<hr class="modal-head-divider" />' : ''}
       </div>`
    : '';

  if (!modalContent) return;
  modalContent.innerHTML = `${titleHTML}<div class="modal-body">${content}</div>`;

  if (modalOverlay) modalOverlay.classList.remove('hidden');
}

export function closeModal() {
  if (modalOverlay) modalOverlay.classList.add('hidden');
}

function openHowToPlayModal() {
  const howToContent = `
  <div class="accordion" role="region" aria-label="遊び方の詳細">
    <section class="accordion-item">
      <h4 class="accordion-header">
      <button class="accordion-trigger" aria-expanded="false" aria-controls="acc-panel-pokemon" id="acc-btn-pokemon">
      ノーマルモードとは
      <span class="accordion-icon" aria-hidden="true"></span>
        </button>
      </h4>
      <div id="acc-panel-pokemon" class="accordion-panel" role="region" aria-labelledby="acc-btn-pokemon" hidden>
        <div class="accordion-panel-inner">
        <p>ノーマルモード（Poke Guesserの基本モード）です。ゲーム開始時に<strong>ランダムな1匹</strong>の情報が最初のヒントとして表示されます。<br>1プレイで最大10回の回答が可能で、比較項目は以下になります。</p>
          <ul class="bullets">
            <li>初登場作品（世代）</li>
            <li>合計種族値</li>
            <li>タイプ</li>
            <li>特性</li>
            <li>高さ</li>
            <li>重さ</li>
            <li>性別比</li>
            <li>進化数</li>
            <li>タマゴグループ</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="accordion-item">
      <h4 class="accordion-header">
        <button class="accordion-trigger" aria-expanded="false" aria-controls="acc-panel-stats" id="acc-btn-stats">
        種族値モードとは
          <span class="accordion-icon" aria-hidden="true"></span>
        </button>
      </h4>
      <div id="acc-panel-stats" class="accordion-panel" role="region" aria-labelledby="acc-btn-stats" hidden>
        <div class="accordion-panel-inner">
        <p>ポケモンの<strong>6つの種族値</strong>を手がかりに正解を推測するモードです。<br>最初のヒントはランダムスタートボタンで表示され、回答ごとに各種族値が一致しているかどうかが表示されます。<br>比較項目は以下になります。</p>
          回答ごとに各種族値が一致しているかどうかが表示されます。<br>比較項目は以下になります。</p>
          <ul class="bullets">
            <li>hp</li>
            <li>こうげき</li>
            <li>ぼうぎょ</li>
            <li>とくこう</li>
            <li>とくぼう</li>
            <li>すばやさ</li>
          </ul>
          <p class="note">※最大回答数は10回です</p>
        </div>
      </div>
    </section>

    <section class="accordion-item">
      <h4 class="accordion-header">
      <button class="accordion-trigger" aria-expanded="false" aria-controls="acc-panel-battle" id="acc-btn-battle">
      対戦モードとは
          <span class="accordion-icon" aria-hidden="true"></span>
        </button>
      </h4>
      <div id="acc-panel-battle" class="accordion-panel" role="region" aria-labelledby="acc-btn-battle" hidden>
        <div class="accordion-panel-inner">
        <p>オンラインで1対1の推測バトルを行うモードです。先行後攻決定後、自動でランダムなポケモンが1匹表示され、そこから交互に回答していきます。</p>
        </div>
      </div>
    </section>


        <section class="accordion-item">
      <h4 class="accordion-header">
        <button class="accordion-trigger" aria-expanded="false" aria-controls="acc-panel-titles" id="acc-btn-titles">
          対象作品（初出作品）
          <span class="accordion-icon" aria-hidden="true"></span>
        </button>
      </h4>
      <div id="acc-panel-titles" class="accordion-panel" role="region" aria-labelledby="acc-btn-titles" hidden>
        <div class="accordion-panel-inner">
          <ul class="bullets">
            <li><strong>第一世代</strong><br>
              ポケットモンスター 赤／緑／青／ピカチュウ
            </li>
            <li><strong>第二世代</strong><br>
              ポケットモンスター 金／銀／クリスタル
            </li>
            <li><strong>第三世代</strong><br>
              ポケットモンスター ルビー／サファイア／<br>
              ファイアレッド／リーフグリーン／エメラルド
            </li>
            <li><strong>第四世代</strong><br>
              ポケットモンスター ダイヤモンド／パール／プラチナ／<br>
              ハートゴールド／ソウルシルバー
            </li>
            <li><strong>第五世代</strong><br>
              ポケットモンスター ブラック／ホワイト／<br>
              ブラック2／ホワイト2
            </li>
            <li><strong>第六世代</strong><br>
              ポケットモンスター X／Y／<br>
              オメガルビー／アルファサファイア
            </li>
            <li><strong>第七世代</strong><br>
              ポケットモンスター サン／ムーン／<br>
              ウルトラサン／ウルトラムーン
            </li>
            <li><strong>第八世代</strong><br>
              ポケットモンスター ソード／シールド／<br>
              ブリリアントダイヤモンド／シャイニングパール／<br>
              レッツゴー ピカチュウ・イーブイ／LEGENDS アルセウス
            </li>
            <li><strong>第九世代</strong><br>
              ポケットモンスター スカーレット／バイオレット
            </li>
            <li><strong>外伝作品</strong><br>
              ポケモンGO／ポケモンHOME
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
  
`;

openModal('モード説明', howToContent);

  const accRoot =
    document.querySelector('#modal .modal-body .accordion') ||
    document.querySelector('#modal .accordion') ||
    document.querySelector('.accordion');
  setupAccordion(accRoot);
}

function setupAccordion(root) {
  if (!root) return;
  const triggers = Array.from(root.querySelectorAll('.accordion-trigger'));

  triggers.forEach((btn) => {
    const panelId = btn.getAttribute('aria-controls');
    const panel = document.getElementById(panelId);
    if (!panel) return;
    btn.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    panel.style.maxHeight = '0px';
  });

  triggers.forEach((btn) => {
    const panelId = btn.getAttribute('aria-controls');
    const panel = document.getElementById(panelId);
    if (!panel) return;

    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));

      if (!expanded) {
        panel.hidden = false;
        panel.style.maxHeight = panel.scrollHeight + 'px';
      } else {
        panel.style.maxHeight = panel.scrollHeight + 'px';
        requestAnimationFrame(() => {
          panel.style.maxHeight = '0px';
        });
        panel.addEventListener('transitionend', () => {
          panel.hidden = true;
        }, { once: true });
      }
    });

    btn.addEventListener('keydown', (e) => {
      const idx = triggers.indexOf(btn);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = triggers[idx + 1] || triggers[0];
        next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = triggers[idx - 1] || triggers[triggers.length - 1];
        prev.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        triggers[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        triggers[triggers.length - 1].focus();
      }
    });
  });
}

export function showInputArea(){ if (inputArea) inputArea.classList.remove('hidden'); }
export function hideInputArea(){ if (inputArea) inputArea.classList.add('hidden'); }
export function showRandomStartButton(){ if (randomStartButton) randomStartButton.classList.remove('hidden'); }
export function hideRandomStartButton(){ if (randomStartButton) randomStartButton.classList.add('hidden'); }
export function hidePostGameActions(){ const el = document.getElementById('post-game-actions'); if (el) el.classList.add('hidden'); }
export function showPostGameActions(){ const el = document.getElementById('post-game-actions'); if (el) el.classList.remove('hidden'); }
export function hideSuggestions(){ const el = suggestionsBox; if (el) el.classList.add('hidden'); }
