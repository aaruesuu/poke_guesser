import {
  allPokemonData
} from "./all-pokemon-data.js";

import {
  finalEvoData
} from "./final-evo-data.js";

import {
  normalizePokemonName
} from "./utils.js";

import {
  comparePokemon
} from "./compare.js";

import {
  clearResults,
  hideInputArea,
  hidePostGameActions,
  hideRandomStartButton,
  hideSuggestions,
  renderResult,
  setGameStatus,
  setGameTitle,
  hideResultsArea,
  showResultsArea,
  showInputArea,
  showRandomStartButton,
  showResultModal,
  switchScreen,
  getGuessInputValue,
  clearGuessInput,
  blurGuessInput,
  openModal,
  showHintButton,
  hideHintButton,
  setHintButtonEnabled,
} from "./dom.js";

import {
  requestHint,
  getHintKeysForMode,
  getHintLabelsByKeys,
} from "./hints.js";

import {
  filterPokemonNamesByDebut,
} from "./settings.js";

// === 正解ポケモン固定 ===
const DEBUG_FIXED_ANSWER = false;
const DEBUG_FIXED_NAME = 'カラマネロ';
const DEBUG_FIXED_ID = 687;
// =======================

// === ランダムスタート初回固定 ===
const DEBUG_FIXED_RANDOM_START = false;
const DEBUG_FIXED_RANDOM_START_NAME = 'メガゲンガー';
const DEBUG_FIXED_RANDOM_START_ID = 10038;
// ================================
const START_POKEMON_PARAM = 'startPokemonId';

let hasConsumedStartPokemonParam = false;

function findPokemonById(id) {
  if (!Number.isFinite(id)) return null;
  return Object.values(allPokemonData).find((pokemon) => Number(pokemon?.id) === id) || null;
}

function removeStartPokemonParamFromUrl() {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(START_POKEMON_PARAM)) return;

  url.searchParams.delete(START_POKEMON_PARAM);
  const nextQuery = url.searchParams.toString();
  const nextUrl = `${url.pathname}${nextQuery ? `?${nextQuery}` : ''}${url.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

function consumeStartPokemonFromQuery() {
  if (hasConsumedStartPokemonParam || typeof window === 'undefined') return null;
  hasConsumedStartPokemonParam = true;

  const params = new URLSearchParams(window.location.search);
  const rawId = params.get(START_POKEMON_PARAM);
  const pokemonId = Number(rawId);
  const pokemon = Number.isFinite(pokemonId) ? findPokemonById(pokemonId) : null;

  if (pokemon) {
    removeStartPokemonParamFromUrl();
  }

  return pokemon;
}

let gameMode = null;
let guessesLeft = 10;
let gameOver = false;
let versusHistoryGuard = false;
const allPokemonNames = Object.keys(allPokemonData);
let correctPokemon = null;
let answeredPokemonNames = new Set();
let correctCount = 0;
let correctlyAnsweredPokemon = [];
const hintRevealedKeys = new Set();

export function initGame(options = {}) {
  const { initialScreen = 'game-container' } = options;
  switchScreen(initialScreen);
  setGameTitle('');
  setGameStatus('');
}

export const Handlers = {
  onStartRandom:  () => startGame('randomStart'),
  onStartStats:   () => startGame('stats'),
  onStartVersus:  () => startVersus(),
  onGuess:        () => handleGuess(),
  onRandomStart:  () => handleRandomStart(),
  onPlayAgain:    () => startGame(gameMode || 'randomStart'),
  onBackToMenu:   () => handleBackToMenu(),
  onHint:         () => handleHintRequest(),
};

function startGame(mode) {
  gameMode = mode;
  const forcedRandomStartPokemon = gameMode === 'randomStart'
    ? consumeStartPokemonFromQuery()
    : null;

  if (gameMode !== 'versus') {
    versusHistoryGuard = false;
  }
  
  if (globalThis._pgVersus && typeof globalThis._pgVersus.teardown === 'function') {
    globalThis._pgVersus.teardown();
  }

  document.getElementById('versus-lobby-area')?.remove();
  document.getElementById('game-header-area')?.style && (document.getElementById('game-header-area').style.display = '');
  showResultsArea();
  resetGame();
  switchScreen('game-container');
  setupUIForMode();
  initRound({ avoidPokemon: forcedRandomStartPokemon });

  if (gameMode === 'randomStart' && forcedRandomStartPokemon) {
    handleRandomStart(forcedRandomStartPokemon);
  }
  
  if (gameMode !== 'versus') {
    showHintButton();
    updateHintAvailability();
  }
}

function getEligiblePokemonNames() {
  const finalEvolutionPokemonNames = allPokemonNames.filter((name) => finalEvoData[name]?.isFinalEvolution);
  if (gameMode === 'stats') {
    const base = finalEvolutionPokemonNames.length ? finalEvolutionPokemonNames : allPokemonNames;
    const filtered = filterPokemonNamesByDebut(base);
    return filtered.length ? filtered : base;
  }
  const filtered = filterPokemonNamesByDebut(allPokemonNames);
  return filtered.length ? filtered : allPokemonNames;
}

function initRound(options = {}) {
  const { avoidPokemon = null } = options;

  hintRevealedKeys.clear();

  if (DEBUG_FIXED_ANSWER) {
    const byName = allPokemonData[DEBUG_FIXED_NAME];
    const byId   = Object.values(allPokemonData).find(p => p.id === DEBUG_FIXED_ID);
    correctPokemon = byName || byId || null;
  } else {
    const candidates = getEligiblePokemonNames();
    const basePool = candidates.length ? candidates : allPokemonNames;
    let pool = basePool;

    if (avoidPokemon) {
      const filtered = basePool.filter((name) => {
        const pokemon = allPokemonData[name];
        return pokemon && !isCorrectAnswer(pokemon, avoidPokemon);
      });
      if (filtered.length) {
        pool = filtered;
      }
    }

    const name = pool[Math.floor(Math.random() * pool.length)];
    correctPokemon = allPokemonData[name] || null;
  }

  guessesLeft = 10;
  gameOver = false;
  answeredPokemonNames = new Set();
  clearResults();
  setGameStatus(`残り回数：${guessesLeft}`);
  updateHintAvailability();
}
  

function resetGame() {
  gameOver = false;
  guessesLeft = 10;
  correctCount = 0;
  correctlyAnsweredPokemon = [];
  
  hintRevealedKeys.clear();
  
  clearResults();
  showInputArea();
  hidePostGameActions();

  const guessInput = document.getElementById('guess-input');
  const guessButton = document.getElementById('guess-button');
  if (guessInput) guessInput.disabled = false;
  if (guessButton) guessButton.disabled = false;

  const playAgainBtn = document.getElementById('post-game-play-again');
  if (playAgainBtn) playAgainBtn.classList.remove('hidden');
  const backToMenuBtn = document.getElementById('post-game-back-to-menu');
  if (backToMenuBtn) backToMenuBtn.textContent = 'ホームへ戻る';
  
  setGameStatus('');
  hideHintButton();
  setHintButtonEnabled(false);
}

function navigateToHome() {
  if (typeof window === 'undefined') return;
  window.location.replace('index.html');
}

function isCorrectAnswer(guessed, correct) {
  if (!guessed || !correct) return false;
  if (guessed.id === correct.id) return true;
  if (normalizePokemonName(guessed.name) === normalizePokemonName(correct.name)) return true;
  
  return false;
}

function handleGuess() {
  if (gameOver) return;

  if (gameMode === 'versus' && globalThis._pgVersus && typeof globalThis._pgVersus.handleGuess === 'function') {
    const guessRaw = getGuessInputValue();
    globalThis._pgVersus.handleGuess(guessRaw);
    hideSuggestions();
    clearGuessInput();
    blurGuessInput();
    
    return;
  }

  if (gameOver) return;

  const guessRaw = getGuessInputValue();
  if (!guessRaw) return;

  let guessedPokemon = Object.values(allPokemonData).find(p => p.name === guessRaw);
  if (!guessedPokemon) {
    const guessName = normalizePokemonName(guessRaw);
    guessedPokemon = Object.values(allPokemonData).find(p => normalizePokemonName(p.name) === guessName);
  }

  if (!guessedPokemon) {
    hideSuggestions();
    openModal(null, "入力されたポケモンが見つかりませんでした");
    blurGuessInput();
    
    return;
  }

  const comparisonResult = comparePokemon(guessedPokemon, correctPokemon);
  if (!comparisonResult) return;
  
  const isCorrect = isCorrectAnswer(guessedPokemon, correctPokemon);
  renderResult(guessedPokemon, comparisonResult, gameMode, isCorrect);

  guessesLeft--;
  setGameStatus(`残り回数：${guessesLeft}`);

  if (isCorrect) {
    endGame(true);
  } else if (gameMode === 'randomStart' && guessesLeft <= 0) {
    endGame(false);
  }

  hideSuggestions();
  clearGuessInput();
  blurGuessInput();
}

function handleRandomStart(forcedPokemon = null) {
  let randomGuess = forcedPokemon || null;

  const pool = allPokemonNames;

  if (!randomGuess && DEBUG_FIXED_RANDOM_START) {
    const byName = allPokemonData[DEBUG_FIXED_RANDOM_START_NAME];
    const byId = Object.values(allPokemonData).find(p => p.id === DEBUG_FIXED_RANDOM_START_ID);
    const fixed = byName || byId || null;
    if (fixed && !isCorrectAnswer(fixed, correctPokemon)) {
      randomGuess = fixed;
    }
  }

  if (!randomGuess) {
    do {
      const randomName = pool[Math.floor(Math.random() * pool.length)];
      randomGuess = allPokemonData[randomName];
    } while (isCorrectAnswer(randomGuess, correctPokemon));
  }

  const comparisonResult = comparePokemon(randomGuess, correctPokemon);
  renderResult(randomGuess, comparisonResult, gameMode);

  setGameStatus(`残り回数：${guessesLeft}`);

  hideRandomStartButton();
  showInputArea();
}

function setupUIForMode() {
  hideRandomStartButton();
  showInputArea();

  if (gameMode === 'stats') {
    setGameTitle('種族値モード');
    showRandomStartButton();
    hideInputArea();
  } else if (gameMode === 'randomStart') {
    setGameTitle('ノーマルモード');
    showRandomStartButton();
    hideInputArea();
  } else {
    setGameTitle('ノーマルモード');
  }
  setGameStatus('');
  updateHintAvailability();
}

function endGame(isWin) {
  gameOver = true;
  const usedHintLabels = gameMode === 'versus'
    ? []
    : getHintLabelsByKeys(Array.from(hintRevealedKeys), gameMode);
  showResultModal(correctPokemon, isWin ? "正解" : "残念", gameMode, guessesLeft, usedHintLabels);
  setHintButtonEnabled(false);
}

async function handleBackToMenu() {
  if (gameMode === 'versus' && globalThis._pgVersus && typeof globalThis._pgVersus.confirmSurrenderIfNeeded === 'function') {
    const ok = await globalThis._pgVersus.confirmSurrenderIfNeeded();
    if (!ok) return;
  }
  resetGame();
  versusHistoryGuard = false;
  navigateToHome();
}

function startVersus() {
  gameMode = 'versus';
  resetGame();
  hideHintButton();
  setHintButtonEnabled(false);
  switchScreen('game-container');
  if (!versusHistoryGuard) {
    history.pushState({ mode: 'versus' }, '');
    versusHistoryGuard = true;
  }
  setGameTitle('対戦モード');
  setGameStatus('ルームを作成するか、コードを入力して参加してください');
  hideRandomStartButton();
  hideInputArea();
  hideResultsArea();
  const tryBoot = () => {
    if (globalThis._pgVersus && typeof globalThis._pgVersus.boot === 'function') {
      globalThis._pgVersus.boot();
      return;
    }
    import('./versus.js')
      .then(() => {
        if (globalThis._pgVersus && typeof globalThis._pgVersus.boot === 'function') {
          globalThis._pgVersus.boot();
        } else {
          console.warn('[Versus] versus module loaded but bootstrapper missing');
        }
      })
      .catch((e) => console.error('[Versus] failed to load module', e));
  };
  tryBoot();
}

async function handleHintRequest() {
  if (gameMode === 'versus' || gameOver) return;
  if (!correctPokemon) return;

  const result = await requestHint({
    pokemon: correctPokemon,
    mode: gameMode,
    disabledKeys: hintRevealedKeys,
  });

  if (result && result.key) {
    hintRevealedKeys.add(result.key);
    updateHintAvailability();
  }
}

function updateHintAvailability() {
  if (gameMode === 'versus') {
    hideHintButton();
    setHintButtonEnabled(false);
    return;
  }

  if (!correctPokemon) {
    setHintButtonEnabled(false);
    return;
  }

  const keys = getHintKeysForMode(gameMode);
  if (!keys || keys.length === 0) {
    hideHintButton();
    setHintButtonEnabled(false);
    return;
  }

  showHintButton();
  const remaining = keys.filter((key) => !hintRevealedKeys.has(key));
  const hasAvailable = remaining.length > 0;
  setHintButtonEnabled(hasAvailable && !gameOver);
}

window.addEventListener('popstate', async () => {
  if (!versusHistoryGuard || gameMode !== 'versus') return;
  const ok = await (globalThis._pgVersus?.confirmSurrenderIfNeeded?.() ?? true);
  if (!ok) {
    history.pushState({ mode: 'versus' }, '');
    return;
  }
  versusHistoryGuard = false;
  resetGame();
  navigateToHome();
});
