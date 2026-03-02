import { allPokemonData } from "./all-pokemon-data.js";
import { comparePokemon } from "./compare.js";
import {
  renderResult,
  setGameStatus,
  setGameTitle,
  showInputArea,
  hideInputArea,
  showResultsArea,
  hideResultsArea,
  hideRandomStartButton,
  hidePostGameActions,
  showResultModal,
  renderMaskedVersusGuess,
  setTurnsRemaining,
} from "./dom.js";

// Firebase Imports
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, doc, getDoc, runTransaction,
  onSnapshot, serverTimestamp, collection, addDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const TURN_DURATION_MS = 60 * 1000;
const INACTIVITY_TIMEOUT_MS = 4 * 60 * 1000;
const ROOM_EXPIRY_MS = 60 * 60 * 1000;
const MAX_TURNS = 20;

const DEBUG_FIXED_ANSWER = false;

const TURN_MODAL_TYPES = {
  BATTLE_START: "battle-start",
  YOUR_TURN: "your-turn",
  OPPONENT_TURN: "opponent-turn",
};

const TURN_MODAL_CONFIG = {
  [TURN_MODAL_TYPES.BATTLE_START]: {
    id: "versus-battle-start-modal",
    defaultText: "バトルスタート",
    bannerClass: "battle-start",
    duration: 2200,
  },
  [TURN_MODAL_TYPES.YOUR_TURN]: {
    id: "versus-your-turn-modal",
    defaultText: "あなたの番",
    bannerClass: "your-turn",
    duration: 2200,
  },
  [TURN_MODAL_TYPES.OPPONENT_TURN]: {
    id: "versus-opponent-turn-modal",
    defaultText: "相手の番",
    bannerClass: "opponent-turn",
    duration: 2200,
  },
};

function ensureFirebase() {
  if (getApps().length) return getApps()[0];
  if (globalThis.firebaseApp) return globalThis.firebaseApp;
  if (!globalThis.FIREBASE_CONFIG) return null;
  const app = initializeApp(globalThis.FIREBASE_CONFIG);
  globalThis.firebaseApp = app;
  return app;
}

function now() { return Date.now(); }

const state = {
  roomId: null,
  code: null,
  me: null, // Auth UID
  correct: null,
  currentSeed: null, // ★追加: 現在適用中のseedを保持
  unsubRoom: null,
  unsubGuesses: null,
  interval: null,
  roomData: null,
  lastAdvanceAttempt: 0,
  turnNoticeShownFor: null,
  turnModalTimeouts: {},
  turnModalCallbacks: {},
  pendingTurnModal: null,
  resultModalShown: false,
  holdHideBanner: false,
  showingOpponentModal: false,
  committingOpeningGuess: false,
  beforeUnloadHandler: null,
  pageHideHandler: null,
};

function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function sixDigit() {
  const n = Math.floor(Math.random() * 1_000_000);
  return String(n).padStart(6, "0");
}

function chooseAnswerBySeed(seed) {
  const names = Object.keys(allPokemonData).sort();
  const a = 1103515245, c = 12345, m = 2**31;
  let x = (typeof seed === "number" ? seed : seed.split("").reduce((s,ch)=> (s*31 + ch.charCodeAt(0))>>>0, 0)) >>> 0;
  x = (a * x + c) % m;
  const idx = x % names.length;
  return allPokemonData[names[idx]];
}

function pickRandomPokemon() {
  const names = Object.keys(allPokemonData);
  return allPokemonData[names[Math.floor(Math.random() * names.length)]];
}

function isRoomInvalid(roomData) {
  if (!roomData) return false;
  return roomData.status === "finished" || !!roomData.invalidatedAt;
}

function ensureLobbyRoot() {
  let root = document.getElementById("versus-lobby-area");
  if (!root) {
    root = document.createElement("div");
    root.id = "versus-lobby-area";

    const header  = document.getElementById("game-header-area");
    const results = document.getElementById("results-area");

    if (results && results.parentNode) {
      results.parentNode.insertBefore(root, results);
    } else if (header && header.parentNode) {
      header.parentNode.insertBefore(root, header.nextSibling);
    } else {
      (document.getElementById("game-container") || document.body).appendChild(root);
    }
  }
  root.style.display = "";
  return root;
}

function setLobbyContent(html) { ensureLobbyRoot().innerHTML = html; }
function hideLobby() { const r = document.getElementById("versus-lobby-area"); if (r) r.style.display = "none"; }
function showLobbyError(message) {
  const errorEl = document.getElementById("vlobby-error");
  if (!errorEl) {
    showToast(message);
    return;
  }
  errorEl.textContent = message;
  errorEl.style.display = "block";
}
function clearLobbyError() {
  const errorEl = document.getElementById("vlobby-error");
  if (!errorEl) return;
  errorEl.textContent = "";
  errorEl.style.display = "none";
}
function showToast(msg) {
  let t = document.getElementById("versus-toast");
  if (!t) { t = document.createElement("div"); t.id = "versus-toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => { t.style.display = "none"; }, 900);
}

let app = null;
let db  = null;

function ensureDB(){
  if (db) return db;
  app = ensureFirebase();
  if (!app) throw new Error("Firebase 未初期化です。");
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false
  });
  return db;
}

function startInterval() {
  stopInterval();
  state.interval = setInterval(onTick, 250);
}
function stopInterval() {
  if (state.interval) { clearInterval(state.interval); state.interval = null; }
}

function installExitGuards() {
  if (!state.beforeUnloadHandler) {
    state.beforeUnloadHandler = (e) => {
      if (state.roomData && state.roomData.status === "playing") {
        e.preventDefault();
        e.returnValue = "";
        surrenderMatch().catch(() => {});
      }
    };
    window.addEventListener("beforeunload", state.beforeUnloadHandler);
  }

  if (!state.pageHideHandler) {
    state.pageHideHandler = () => {
      if (state.roomData && state.roomData.status === "playing") {
        surrenderMatch().catch(() => {});
      }
    };
    window.addEventListener("pagehide", state.pageHideHandler);
  }
}

function removeExitGuards() {
  if (state.beforeUnloadHandler) {
    window.removeEventListener("beforeunload", state.beforeUnloadHandler);
    state.beforeUnloadHandler = null;
  }
  if (state.pageHideHandler) {
    window.removeEventListener("pagehide", state.pageHideHandler);
    state.pageHideHandler = null;
  }
}

function ensureTurnModal(type) {
  const config = TURN_MODAL_CONFIG[type];
  if (!config) return null;

  let overlay = document.getElementById(config.id);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = config.id;
    overlay.className = "versus-modal-overlay hidden";
    overlay.innerHTML = `
      <div class="versus-turn-modal-content" role="alertdialog" aria-live="assertive">
        <div class="versus-turn-banner ${config.bannerClass}">
          <span class="versus-turn-text">${config.defaultText}</span>
        </div>
      </div>
    `;
    overlay.addEventListener("click", () => hideModal(type));
    document.body.appendChild(overlay);
  }
  return overlay;
}

function clearModalTimeout(type) {
  if (state.turnModalTimeouts[type]) {
    clearTimeout(state.turnModalTimeouts[type]);
    delete state.turnModalTimeouts[type];
  }
}

function scheduleModalHide(type, duration, callback) {
  clearModalTimeout(type);
  if (callback) {
    state.turnModalCallbacks[type] = callback;
  } else {
    delete state.turnModalCallbacks[type];
  }
  if (typeof duration !== "number" || duration <= 0) return;
  state.turnModalTimeouts[type] = setTimeout(() => {
    delete state.turnModalTimeouts[type];
    hideModal(type);
  }, duration);
}

function showModal(type, text) {
  const config = TURN_MODAL_CONFIG[type];
  if (!config) return null;
  Object.keys(TURN_MODAL_CONFIG).forEach((key) => {
    if (key !== type) hideModal(key, { runCallback: false });
  });
  const overlay = ensureTurnModal(type);
  if (!overlay) return null;
  const textEl = overlay.querySelector(".versus-turn-text");
  if (textEl) textEl.textContent = text || config.defaultText;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  const banner = overlay.querySelector(".versus-turn-banner");
  if (banner) {
    banner.classList.remove("animate");
    void banner.offsetWidth;
    banner.classList.add("animate");
  }
  return overlay;
}

function hideModal(type, { runCallback = true } = {}) {
  const config = TURN_MODAL_CONFIG[type];
  if (!config) return;
  const overlay = document.getElementById(config.id);
  const callback = state.turnModalCallbacks[type];
  if (!overlay) {
    if (runCallback && typeof callback === "function") {
      delete state.turnModalCallbacks[type];
      try { callback(); } catch (err) { console.warn("[Versus] turn modal callback failed", err); }
    } else {
      delete state.turnModalCallbacks[type];
    }
    return;
  }
  clearModalTimeout(type);
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  if (runCallback && typeof callback === "function") {
    delete state.turnModalCallbacks[type];
    try { callback(); } catch (err) { console.warn("[Versus] turn modal callback failed", err); }
  } else {
    delete state.turnModalCallbacks[type];
  }
}

function hideAllTurnModals(options = { runCallback: false }) {
  Object.keys(TURN_MODAL_CONFIG).forEach((type) => hideModal(type, options));
}

function queueTurnModal(turnNumber, mine) {
  state.pendingTurnModal = { turnNumber, mine };
}

function flushPendingTurnModal() {
  if (!state.pendingTurnModal) return;
  const { turnNumber, mine } = state.pendingTurnModal;
  state.pendingTurnModal = null;
  if (mine) {
    showTurnModal(turnNumber);
  } else {
    showOpponentModal();
  }
}

function showTurnModal(turnNumber) {
  state.pendingTurnModal = null;
  showModal(TURN_MODAL_TYPES.YOUR_TURN);
  state.turnNoticeShownFor = turnNumber;
  scheduleModalHide(TURN_MODAL_TYPES.YOUR_TURN, TURN_MODAL_CONFIG[TURN_MODAL_TYPES.YOUR_TURN].duration);
}

function showOpponentModal() {
  state.pendingTurnModal = null;
  state.showingOpponentModal = true;
  state.holdHideBanner = true;
  showModal(TURN_MODAL_TYPES.OPPONENT_TURN);
  scheduleModalHide(
    TURN_MODAL_TYPES.OPPONENT_TURN,
    TURN_MODAL_CONFIG[TURN_MODAL_TYPES.OPPONENT_TURN].duration,
    () => {
      state.showingOpponentModal = false;
      state.holdHideBanner = false;
    },
  );
}

function showBattleStartModal(onComplete) {
  state.holdHideBanner = true;
  state.showingOpponentModal = false;
  showModal(TURN_MODAL_TYPES.BATTLE_START);
  scheduleModalHide(
    TURN_MODAL_TYPES.BATTLE_START,
    TURN_MODAL_CONFIG[TURN_MODAL_TYPES.BATTLE_START].duration,
    () => {
      state.holdHideBanner = false;
      if (typeof onComplete === "function") onComplete();
    },
  );
}

function hideTurnModal() {
  hideAllTurnModals({ runCallback: false });
  state.pendingTurnModal = null;
  state.holdHideBanner = false;
  state.showingOpponentModal = false;
}

function onTick() {
  const d = state.roomData;
  if (!d) return;

  if (d.status === "playing") {
    const left = (d.turnDeadline?.toMillis ? d.turnDeadline.toMillis() : d.turnDeadline || 0) - now();
    const mine = d.turnOf === state.me;
    const remainingTurns = Math.max(0, (d.maxTurns || MAX_TURNS) - (d.turnCount || 0));
    setGameStatus(`${mine ? "あなた" : "相手"}の番です（残り時間：${fmtClock(left)}／残りターン数：${remainingTurns}）`);
    const guessInput = document.getElementById("guess-input");
    const guessButton = document.getElementById("guess-button");
    const expired = left <= 0;
    if (guessInput) guessInput.disabled = expired || !mine;
    if (guessButton) guessButton.disabled = expired || !mine;
    if (expired && (now() - (state.lastAdvanceAttempt || 0) > 1500)) {
      state.lastAdvanceAttempt = now();
      forceAdvanceTurnIfExpired().catch(()=>{});
    }
  }
}

async function joinRoomByCode(code) {
  const roomRef = doc(ensureDB(), "rooms", code);
  const snap = await getDoc(roomRef);
  if (snap.exists() && isRoomInvalid(snap.data())) {
    throw new Error("ROOM_INVALID");
  }
  state.roomId = code;
  state.code   = code;
  await claimRoomAsync(code);
  return { roomId: code };
}

function opponentId(playersMap, me) {
  if (!playersMap) return null;
  const ids = Object.keys(playersMap);
  return ids.find(id => id !== me) || null;
}

function getOpponentUid(roomData, uid) {
  if (!roomData) return null;
  if (roomData.hostUid === uid) return roomData.guestUid || null;
  if (roomData.guestUid === uid) return roomData.hostUid || null;
  return opponentId(roomData.players || {}, uid);
}

async function maybeStartMatch(roomRef) {
  await runTransaction(ensureDB(), async (tx) => {
    const rs = await tx.get(roomRef);
    const data = rs.data();
    if (data.status !== "lobby") return;

    const playersMap = data.players || {};
    const playerIds = Object.keys(playersMap);
    
    if (playerIds.length !== 2) return;

    const orderedByRole = [data.hostUid, data.guestUid].filter(Boolean);
    const pool = orderedByRole.length === 2 ? orderedByRole : playerIds;
    const first = Math.random() < 0.5 ? pool[0] : pool[1];

    const seed = Math.floor(Math.random() * 2**31);
    tx.update(roomRef, {
      status: "playing",
      seed,
      turnOf: first,
      turnNumber: 1,
      turnCount: 0,
      openingAutoGuessDone: false,
      turnDeadline: new Date(Date.now() + TURN_DURATION_MS),
      maxTurns: data.maxTurns || MAX_TURNS,
      winner: null,
      finishedReason: null,
      lastActionAt: serverTimestamp(),
      lastActionBy: first,
    });
  });
}

function listenRoom(onState, onGuess) {
  const db = ensureDB();
  const roomRef = doc(db, "rooms", state.roomId);

  try { state.unsubRoom && state.unsubRoom(); } catch {}
  try { state.unsubGuesses && state.unsubGuesses(); } catch {}
  state.unsubRoom = null;
  state.unsubGuesses = null;

  state.unsubRoom = onSnapshot(roomRef, async (snap) => {
    if (!snap.exists()) {
      hideInputArea();
      hideResultsArea();
      setGameTitle("対戦モード");
      setGameStatus("ホストの準備を待っています…");
      setTurnsRemaining("");
      state.roomData = null;
      return;
    }

    const data = snap.data() || {};
    const prevStatus = state.roomData ? state.roomData.status : null;
    state.roomData = data;

    // ★修正: 正解データの同期ロジック
    // seedが存在し、かつ手持ちのseedと異なる場合にのみ更新する
    if (DEBUG_FIXED_ANSWER) {
        if (!state.correct) {
            const fixed = Object.values(allPokemonData).find(p => p.id === 149) || Object.values(allPokemonData)[0];
            state.correct = fixed;
        }
    } else {
        if (typeof data.seed === 'number') {
            // 初回、またはseedが変わった時（＝新しい対戦が始まった時）に正解を更新
            if (state.currentSeed !== data.seed) {
                state.correct = chooseAnswerBySeed(data.seed);
                state.currentSeed = data.seed;
                // seedが変わったら履歴などの状態もクリアするのが安全
                if (prevStatus === "finished" || prevStatus === "lobby") {
                    state.resultModalShown = false;
                }
            }
        }
    }

    // Lobby Logic
    if (data.status === "lobby") {
      const playersMap = data.players || {};
      const playerIds = Object.keys(playersMap);
      const playerCount = playerIds.length;
      
      state.turnNoticeShownFor = null;
      state.resultModalShown = false;
      hideTurnModal();

      // Auto-join logic
      if (state.me && !playersMap[state.me] && playerCount < 2) {
          try {
             await claimRoomAsync(state.roomId);
          } catch(e) {
             console.warn("[Versus] auto-join failed", e);
          }
      }

      const iAmCreator = data.creatorId && state.me && state.me === data.creatorId;
      if (playerCount === 2 && iAmCreator) {
        try {
          await maybeStartMatch(roomRef);
        } catch (err) {
          if (!(err && err.code === "failed-precondition")) {
            console.warn("[Versus] maybeStartMatch failed", err);
          }
        }
      }

      hideInputArea();
      hideResultsArea();
      setGameTitle("対戦モード");
      setGameStatus(playerCount >= 2 ? "準備中…" : "相手の参加を待っています…");
      setTurnsRemaining("");
      removeExitGuards();
    }

    if (data.status === "playing") {
      installExitGuards();
      hideLobby();
      hideRandomStartButton();
      showInputArea();
      showResultsArea();
      hidePostGameActions();
      state.resultModalShown = false;

      if (!data.openingAutoGuessDone) {
        commitOpeningAutoGuess(roomRef, data).catch(() => {});
      }

      setGameTitle("対戦モード");

      const left = (data.turnDeadline?.toMillis ? data.turnDeadline.toMillis() : data.turnDeadline || 0) - now();
      const mine = data.turnOf === state.me;
      const remainingTurns = Math.max(0, (data.maxTurns || MAX_TURNS) - (data.turnCount || 0));
      setGameStatus(`${mine ? "あなた" : "相手"}の番です（残り時間：${fmtClock(left)}／残りターン数：${remainingTurns}）`);

      const currentTurn = data.turnNumber || 1;
      
      if (prevStatus !== "playing") {
        if ((currentTurn || 0) <= 1) {
          queueTurnModal(currentTurn, mine);
          showBattleStartModal(() => flushPendingTurnModal());
        } else if (mine) {
          showTurnModal(currentTurn);
        } else {
          showOpponentModal();
        }
      } else if (mine && state.turnNoticeShownFor !== currentTurn && !state.pendingTurnModal) {
        showTurnModal(currentTurn);
      } else if (!mine && !state.holdHideBanner && !state.showingOpponentModal && !state.pendingTurnModal) {
        hideTurnModal();
      }

      try { startInterval && startInterval(); } catch {}
    }

    if (data.status === "finished") {
      try { stopInterval && stopInterval(); } catch {}
      removeExitGuards();
      const winRole = data.winner;
      const win = (winRole === "host" && state.me === data.hostUid) || (winRole === "guest" && state.me === data.guestUid);
      const draw = winRole === "draw";
      setGameTitle("対戦モード");
      setTurnsRemaining("");
      showResultsArea();
      const reason = data.finishedReason === "max_turns" ? "20ターン経過のため引き分け" : win ? "Win" : draw ? "Draw" : "Lose";
      setGameStatus(`対戦終了：${reason}`);
      hideTurnModal();
      state.turnNoticeShownFor = null;
      hideInputArea();
      
      if (!state.resultModalShown && state.correct) {
        const verdict = draw ? "引き分け" : win ? "勝利" : "敗北";
        showResultModal(state.correct, verdict, "versus", 0);
        state.resultModalShown = true;
      }
    }

    onState && onState(data);
  });

  const q = query(collection(roomRef, "guesses"), orderBy("ts", "asc"));
  state.unsubGuesses = onSnapshot(q, (qs) => {
    qs.docChanges().forEach((ch) => {
      if (ch.type !== "added") return;
      const g = ch.doc.data();

      if (onGuess) {
        onGuess(g);
        return;
      }

      if (g.masked && g.by !== state.me) {
        renderMaskedVersusGuess(false);
        return;
      }

      const guessed = Object.values(allPokemonData).find(p => p.id === g.id);
      if (!guessed || !state.correct) return;
      const result = comparePokemon(guessed, state.correct);
      const row = renderResult(guessed, result, "versus", !!g.isCorrect);

      const targetRow = row || document.querySelector(".result-row");
      if (targetRow) {
        if (g.autoStart) {
          targetRow.classList.add("by-neutral");
        } else {
          targetRow.classList.add(g.by === state.me ? "by-me" : "by-opponent");
        }
        const trig = targetRow.querySelector(".accordion-trigger");
        if (trig && trig.hasAttribute("disabled")) trig.removeAttribute("disabled");
      }
    });
  });
}


async function postGuess(guessName) {
  const guessed = Object.values(allPokemonData).find(p => p.name === guessName);
  if (!guessed) return;

  const roomRef = doc(ensureDB(), "rooms", state.roomId);
  const guessRef = doc(collection(roomRef, "guesses"));

  await runTransaction(ensureDB(), async (tx) => {
    const s = await tx.get(roomRef);
    if (!s.exists()) return;
    const r = s.data();
    if (r.status !== "playing") return;
    if (r.turnOf !== state.me) return;

    const deadlineMs = r.turnDeadline?.toMillis ? r.turnDeadline.toMillis() : r.turnDeadline || 0;
    if (deadlineMs && now() > deadlineMs + 1000) return; // Firestore rules will enforce too

    const isCorrect = (state.correct && guessed.id === state.correct.id);
    const turnNumber = r.turnNumber || 1;
    const nextTurnCount = (r.turnCount || 0) + 1;
    const updates = {
      turnCount: nextTurnCount,
      lastActionAt: serverTimestamp(),
      lastActionBy: state.me,
    };

    if (isCorrect) {
      updates.status = "finished";
      updates.winner = r.hostUid === state.me ? "host" : "guest";
      updates.finishedReason = "normal";
      updates.invalidatedAt = serverTimestamp();
    } else if (nextTurnCount >= (r.maxTurns || MAX_TURNS)) {
      updates.status = "finished";
      updates.winner = "draw";
      updates.finishedReason = "max_turns";
      updates.invalidatedAt = serverTimestamp();
    } else {
      const other = getOpponentUid(r, state.me) || opponentId(r.players, state.me) || state.me;
      updates.turnOf = other;
      updates.turnNumber = (r.turnNumber || 1) + 1;
      updates.turnDeadline = new Date(Date.now() + TURN_DURATION_MS);
    }

    tx.set(guessRef, {
      by: state.me,
      playerId: state.me,
      name: guessed.name,
      id: guessed.id,
      isCorrect,
      turnNumber,
      ts: serverTimestamp(),
    });
    tx.update(roomRef, updates);
  });

  if (!state.roomData || state.roomData.turnOf === state.me) {
    showOpponentModal();
  }
}


async function forceAdvanceTurnIfExpired() {
  const roomRef = doc(ensureDB(), "rooms", state.roomId);
  await runTransaction(ensureDB(), async (tx) => {
    const rs = await tx.get(roomRef);
    if (!rs.exists()) return;
    const data = rs.data();
    if (data.status !== "playing") return;

    const deadlineMs = data.turnDeadline?.toMillis ? data.turnDeadline.toMillis() : data.turnDeadline || 0;
    const inactiveMs = data.lastActionAt?.toMillis ? data.lastActionAt.toMillis() : data.lastActionAt || 0;
    const nowMs = now();

    if (inactiveMs && nowMs - inactiveMs > INACTIVITY_TIMEOUT_MS) {
      const winnerRole = data.hostUid === state.me ? "host" : data.guestUid === state.me ? "guest" : null;
      if (!winnerRole) return;
      tx.update(roomRef, {
        status: "finished",
        winner: winnerRole,
        finishedReason: "timeout",
        invalidatedAt: serverTimestamp(),
        lastActionAt: serverTimestamp(),
        lastActionBy: state.me,
      });
      return;
    }

    if (deadlineMs && nowMs <= deadlineMs) return;

    const nextTurnCount = (data.turnCount || 0) + 1;
    const turnNumber = data.turnNumber || 1;
    const playersMap = data.players || {};
    const other = getOpponentUid(data, data.turnOf) || opponentId(playersMap, data.turnOf) || data.turnOf;
    const maxTurns = data.maxTurns || MAX_TURNS;
    const autoGuess = pickRandomPokemon();
    const isCorrect = state.correct && autoGuess.id === state.correct.id;

    const updates = {
      turnCount: nextTurnCount,
      lastActionAt: serverTimestamp(),
      lastActionBy: data.turnOf,
    };

    if (isCorrect) {
      updates.status = "finished";
      updates.winner = data.hostUid === data.turnOf ? "host" : "guest";
      updates.finishedReason = "normal";
      updates.invalidatedAt = serverTimestamp();
    } else if (nextTurnCount >= maxTurns) {
      updates.status = "finished";
      updates.winner = "draw";
      updates.finishedReason = "max_turns";
      updates.invalidatedAt = serverTimestamp();
    } else {
      updates.turnOf = other;
      updates.turnNumber = turnNumber + 1;
      updates.turnDeadline = new Date(Date.now() + TURN_DURATION_MS);
    }

    if (data.turnOf) {
      const guessRef = doc(collection(roomRef, "guesses"));
      tx.set(guessRef, {
        by: data.turnOf,
        playerId: data.turnOf,
        name: autoGuess.name,
        id: autoGuess.id,
        isCorrect,
        turnNumber,
        autoSkip: true,
        ts: serverTimestamp(),
      });
    }

    tx.update(roomRef, updates);
  });
}

async function commitOpeningAutoGuess(roomRef, data) {
  if (state.committingOpeningGuess) return;
  if (!roomRef || !data || data.status !== "playing" || data.openingAutoGuessDone || !data.turnOf) return;
  if ((data.turnCount || 0) > 0) return;

  state.committingOpeningGuess = true;
  try {
    await runTransaction(ensureDB(), async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists()) return;
      const room = snap.data();
      if (room.status !== "playing" || room.openingAutoGuessDone || !room.turnOf) return;
      if ((room.turnCount || 0) > 0) return;

      const autoGuess = pickRandomPokemon();
      const turnNumber = room.turnNumber || 1;
      const isCorrect = state.correct && autoGuess.id === state.correct.id;

      const updates = {
        openingAutoGuessDone: true,
      };

      if (isCorrect) {
        updates.status = "finished";
        updates.winner = room.hostUid === room.turnOf ? "host" : "guest";
        updates.finishedReason = "normal";
        updates.invalidatedAt = serverTimestamp();
      }

      const guessRef = doc(collection(roomRef, "guesses"));
      tx.set(guessRef, {
        by: "auto-start",
        playerId: room.turnOf,
        name: autoGuess.name,
        id: autoGuess.id,
        isCorrect,
        turnNumber,
        autoStart: true,
        ts: serverTimestamp(),
      });

      tx.update(roomRef, updates);
    });
  } catch (err) {
    console.warn("[Versus] opening auto guess failed", err);
  } finally {
    state.committingOpeningGuess = false;
  }
}

function boot() {
  const app = ensureFirebase();
  const auth = getAuth(app);
  
  // Set default UI to loading/offline state
  const setInitialUI = (enabled) => {
     const root = document.getElementById("versus-lobby-area");
     if(root) {
        root.querySelectorAll('#vs-create, #vs-join, #vs-code')
            .forEach(el => { el.disabled = !enabled; });
        if(!enabled) setGameStatus("認証中...");
     }
  };

  // Render HTML first
  renderLobbyHTML();
  setInitialUI(false);

  // Authenticate
  onAuthStateChanged(auth, (user) => {
    if (user) {
      state.me = user.uid;
      setInitialUI(true);
      setGameStatus("ルームを作成 or ルームに参加");
    } else {
      signInAnonymously(auth).catch((e) => {
        console.error("Auth failed", e);
        showToast("認証に失敗しました");
      });
    }
  });
}

function renderLobbyHTML() {
  const html = `
    <div class="vlobby-card">
      <div class="vlobby-body">
        <section class="vlobby-panel vlobby-create">
          <h4 class="vlobby-panel-title">ルームを作成</h4>
          <p class="vlobby-panel-description">表示されたコードを共有してください</p>
            <div class="vlobby-code">
              <span id="vs-my-code">------</span>
            </div>
            <div class="vlobby-actions">
              <button id="vs-create" class="vlobby-btn primary" disabled>コード生成</button>
            </div>
        </section>
      <div class="vlobby-divider" role="presentation"><span>or</span></div>
        <section class="vlobby-panel vlobby-join">
          <h4 class="vlobby-panel-title">ルームに参加</h4>
          <p class="vlobby-panel-description">コード（数字6桁）を入力してください</p>
          <div class="vlobby-join-input">
            <input
              id="vs-code"
              class="vlobby-input"
              inputmode="numeric"
              pattern="\\d{6}"
              maxlength="6"
              autocomplete="one-time-code"
              placeholder="123456"
              aria-label="6桁のルームコード"
              disabled
            />
          </div>
          <div class="vlobby-actions">
            <button id="vs-join" class="vlobby-btn ghost small" disabled>参加する</button>
          </div>
          <p id="vlobby-error" class="vlobby-error" aria-live="polite" style="display:none;"></p>
        </section>
      </div>
    </div>
  `;
  setLobbyContent(html);

  const root = ensureLobbyRoot();
  const codeInput = root.querySelector("#vs-code");
  if (codeInput) {
    codeInput.addEventListener("input", () => {
      clearLobbyError();
    });
  }

  root.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("#vs-create, #vs-join");
    if (!btn || btn.disabled) return;

    if (btn.id === "vs-create") {
      try {
        const { code } = await createRoom();
        const created  = root.querySelector("#create-result");
        const codeSpan = root.querySelector("#vs-my-code");
        if (created)  created.style.display = "";
        if (codeSpan) codeSpan.textContent = code;

        listenRoom(handleRoomState, handleGuessAdded);
      } catch (e) {
        console.error(e);
        showToast("ルーム作成に失敗しました");
      }
      return;
    }

    if (btn.id === "vs-join") {
      const input = root.querySelector("#vs-code");
      const code = (input?.value || "").trim();
      if (!/^\d{6}$/.test(code)) { alert("6桁の数字を入力してください"); return; }

      try {
        await joinRoomByCode(code);
        listenRoom(handleRoomState, handleGuessAdded);
      } catch (e) {
        console.error(e);
        state.roomId = null;
        state.code = null;
        if (e && e.message === "ROOM_INVALID") {
          showLobbyError("このルームコードは使用済みです\n新しいコードを発行してください");
        } else {
          showLobbyError("参加に失敗しました\n時間をおいて再度お試しください");
        }
      }
      return;
    }
  });
}

function handleRoomState(_data) {

}

function handleGuessAdded(g) {
  if (g.masked && g.by !== state.me) {
    renderMaskedVersusGuess(false);
    return;
  }

  const guessed = Object.values(allPokemonData).find(p => p.id === g.id);
  if (!guessed || !state.correct) return;
  const result = comparePokemon(guessed, state.correct);

  const row = renderResult(guessed, result, "versus", !!g.isCorrect);

  const targetRow = row || document.querySelector(".result-row");
  if (targetRow) {
    if (g.autoStart) {
      targetRow.classList.add("by-neutral");
    } else {
      targetRow.classList.add(g.by === state.me ? "by-me" : "by-opponent");
    }
    const trig = targetRow.querySelector(".accordion-trigger");
    if (trig && trig.hasAttribute("disabled")) trig.removeAttribute("disabled");
  }
}


function handleGuess(guessRaw) {
  const name = (guessRaw || "").trim();
  if (!name) return;
  postGuess(name).catch((e)=> console.warn("[Versus] postGuess failed", e));
}

async function claimRoomAsync(code) {
  const me = state.me;
  const roomRef = doc(ensureDB(), "rooms", code);
  try {
    await runTransaction(ensureDB(), async (tx) => {
      const rs = await tx.get(roomRef);
      if (rs.exists()) {
        const data = rs.data() || {};
        if (isRoomInvalid(data)) {
          throw new Error("ROOM_INVALID");
        }
        const playersMap = data.players || {};
        
        // Add self if not exists
        if (!playersMap[me]) {
            playersMap[me] = true;
        }

        const updates = { players: playersMap };
        if (!data.hostUid) updates.hostUid = data.creatorId || me;
        if (!data.guestUid && me !== updates.hostUid) updates.guestUid = me;
        if (!data.maxTurns) updates.maxTurns = MAX_TURNS;
        tx.update(roomRef, updates);
      } else {
        // Map structure for players
        const playersMap = { [me]: true };
        tx.set(roomRef, {
          code,
          status: "lobby",
          creatorId: me,
          hostUid: me,
          guestUid: null,
          players: playersMap,
          createdAt: serverTimestamp(),
          maxTurns: MAX_TURNS,
          turnCount: 0,
          winner: null,
          finishedReason: null,
          lastActionAt: serverTimestamp(),
          lastActionBy: me,
        });
      }
    });
  } catch (e) {
    console.warn("[Versus] claimRoomAsync failed", e);
    throw e;
  }
}

async function createRoom() {
  const me = state.me;
  const code = sixDigit();
  state.roomId = code;
  state.code   = code;
  await claimRoomAsync(code);
  return { roomId: code, code };
}

function teardown() {
  try { stopInterval(); } catch {}
  try { state.unsubRoom && state.unsubRoom(); } catch {}
  try { state.unsubGuesses && state.unsubGuesses(); } catch {}
  state.unsubRoom = null;
  state.unsubGuesses = null;

  const root = document.getElementById('versus-lobby-area');
  if (root && root.parentNode) {
    root.parentNode.removeChild(root);
  }

  try { setTurnsRemaining(""); } catch {}

  const skillBar = document.getElementById('versus-skill-bar');
  if (skillBar) skillBar.classList.add('hidden');
  
  hideTurnModal();
  removeExitGuards();

  state.turnNoticeShownFor = null;
  state.resultModalShown = false;
  state.turnModalTimeouts = {};
  state.turnModalCallbacks = {};
  state.pendingTurnModal = null;

  state.roomId = null; 
  state.code = null;
  state.correct = null;
  state.currentSeed = null; // ★追加: teardownでもリセット
}

async function surrenderMatch() {
  if (!state.roomId) return;
  const roomRef = doc(ensureDB(), "rooms", state.roomId);
  await runTransaction(ensureDB(), async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.status !== "playing") return;
    const myRole = data.hostUid === state.me ? "host" : data.guestUid === state.me ? "guest" : null;
    const opponentRole = myRole === "host" ? "guest" : "host";
    tx.update(roomRef, {
      status: "finished",
      winner: opponentRole,
      finishedReason: "surrender",
      invalidatedAt: serverTimestamp(),
      lastActionAt: serverTimestamp(),
      lastActionBy: state.me,
    });
  });
}

async function confirmSurrenderIfNeeded() {
  const playing = state.roomData && state.roomData.status === "playing";
  if (!playing) return true;
  const ok = window.confirm("このバトルを降参（負け）として終了しますか？");
  if (!ok) return false;
  try {
    await surrenderMatch();
  } catch (e) {
    console.warn("[Versus] surrender failed", e);
  }
  return true;
}

export const PGVersus = { boot, handleGuess, forceAdvanceTurnIfExpired, teardown, confirmSurrenderIfNeeded };
globalThis._pgVersus = PGVersus;
