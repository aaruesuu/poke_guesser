import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const NO_DATA = "—";
const TYPE_NAME_JA = Object.freeze({
  normal: "ノーマル",
  fire: "ほのお",
  water: "みず",
  electric: "でんき",
  grass: "くさ",
  ice: "こおり",
  fighting: "かくとう",
  poison: "どく",
  ground: "じめん",
  flying: "ひこう",
  psychic: "エスパー",
  bug: "むし",
  rock: "いわ",
  ghost: "ゴースト",
  dragon: "ドラゴン",
  dark: "あく",
  steel: "はがね",
  fairy: "フェアリー",
  stellar: "ステラ",
  unknown: "不明",
  shadow: "シャドー",
});
const DAMAGE_CLASS_JA = Object.freeze({
  physical: "物理",
  special: "特殊",
  status: "変化",
});
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const pokemonDataFilePath = path.join(projectRoot, "js", "all-pokemon-data.js");
const speciesDataPath = path.join(projectRoot, "data", "species_ja.json");
const movesCachePath = path.join(projectRoot, "data", "moves_cache.json");
const pokemonMovesPath = path.join(projectRoot, "data", "pokemon_moves_sv_levelup.json");
const outputDirPath = path.join(projectRoot, "pokemon");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed !== "" && trimmed !== "なし";
  }
  return true;
}

function valueOrDash(value, suffix = "") {
  if (!hasMeaningfulValue(value)) return NO_DATA;
  return `${value}${suffix}`;
}

function normalizePokemonData(rawData) {
  const source = Array.isArray(rawData) ? rawData : Object.values(rawData || {});
  return source
    .filter((pokemon) => pokemon && typeof pokemon === "object")
    .filter((pokemon) => Number.isFinite(Number(pokemon.id)))
    .map((pokemon) => ({ ...pokemon, id: Number(pokemon.id) }));
}

async function loadPokemonData() {
  const source = await fs.readFile(pokemonDataFilePath, "utf8");
  const transformed = source
    .replace(/^\s*export\s+const\s+allPokemonData\s*=/m, "globalThis.allPokemonData =")
    .replace(/^\s*export\s+default\s+/m, "globalThis.allPokemonData = ")
    .replace(/^\s*module\.exports\s*=/m, "globalThis.allPokemonData =")
    .replace(/^\s*exports\.allPokemonData\s*=/m, "globalThis.allPokemonData =");

  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(transformed, { filename: pokemonDataFilePath }).runInContext(sandbox);

  const normalized = normalizePokemonData(sandbox.allPokemonData);
  if (normalized.length === 0) {
    throw new Error("allPokemonData の読み込みに失敗しました。");
  }
  return normalized;
}

async function loadJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function toPokemonFileId(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return "0000";
  const base = String(Math.trunc(numericId));
  return numericId > 9999 ? base : base.padStart(4, "0");
}

function collectBaseNameCandidates(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return [];

  const candidates = new Set([trimmed]);
  const formStart = trimmed.indexOf("（");
  if (formStart > 0) {
    candidates.add(trimmed.slice(0, formStart).trim());
  }
  if (trimmed.startsWith("メガ")) {
    candidates.add(trimmed.slice("メガ".length).trim());
  }
  if (trimmed.startsWith("ゲンシ")) {
    candidates.add(trimmed.slice("ゲンシ".length).trim());
  }

  for (const candidate of Array.from(candidates)) {
    const normalized = candidate.replace(/[XYＸＹ]$/, "").trim();
    if (normalized) candidates.add(normalized);
  }

  return Array.from(candidates).filter(Boolean);
}

function resolveDisplayDexId(pokemon, pokemonList) {
  const rawId = Number(pokemon?.id);
  if (!Number.isFinite(rawId)) return null;
  if (rawId <= 9999) return rawId;

  const nameCandidates = collectBaseNameCandidates(pokemon?.name);
  let bestRegularId = null;
  let bestAnyId = null;

  for (const baseName of nameCandidates) {
    for (const candidate of pokemonList) {
      const candidateName = typeof candidate?.name === "string" ? candidate.name : "";
      if (!candidateName) continue;
      if (candidateName !== baseName && !candidateName.startsWith(`${baseName}（`)) continue;

      const candidateId = Number(candidate.id);
      if (!Number.isFinite(candidateId)) continue;
      if (bestAnyId === null || candidateId < bestAnyId) {
        bestAnyId = candidateId;
      }
      if (candidateId <= 9999 && (bestRegularId === null || candidateId < bestRegularId)) {
        bestRegularId = candidateId;
      }
    }
  }

  return bestRegularId ?? bestAnyId ?? rawId;
}

function buildDisplayDexIdMap(pokemonList) {
  const map = new Map();
  for (const pokemon of pokemonList) {
    const pokemonId = Number(pokemon?.id);
    if (!Number.isFinite(pokemonId)) continue;
    const displayDexId = resolveDisplayDexId(pokemon, pokemonList);
    if (Number.isFinite(displayDexId)) {
      map.set(pokemonId, displayDexId);
    }
  }
  return map;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatTypeText(pokemon) {
  const types = [pokemon.type1, pokemon.type2].filter(hasMeaningfulValue);
  return types.length > 0 ? types.join(" / ") : NO_DATA;
}

function calcTotalStats(pokemon) {
  if (Number.isFinite(Number(pokemon.totalStats))) {
    return Number(pokemon.totalStats);
  }
  const stats = pokemon.stats || {};
  return (
    Number(stats.hp || 0) +
    Number(stats.attack || 0) +
    Number(stats.defense || 0) +
    Number(stats.spAttack || 0) +
    Number(stats.spDefense || 0) +
    Number(stats.speed || 0)
  );
}

function statValue(stats, key) {
  const numeric = Number(stats?.[key]);
  return Number.isFinite(numeric) ? String(numeric) : NO_DATA;
}

function toJapaneseType(typeName) {
  if (!hasMeaningfulValue(typeName)) return NO_DATA;
  const key = String(typeName).trim().toLowerCase();
  return TYPE_NAME_JA[key] ?? String(typeName);
}

function toJapaneseDamageClass(damageClass) {
  if (!hasMeaningfulValue(damageClass)) return NO_DATA;
  const key = String(damageClass).trim().toLowerCase();
  return DAMAGE_CLASS_JA[key] ?? String(damageClass);
}

function normalizeMovesByPokemon(rawData) {
  const byId = rawData?.byId && typeof rawData.byId === "object" ? rawData.byId : {};
  const normalized = {};

  for (const [idKey, value] of Object.entries(byId)) {
    const moves = Array.isArray(value?.moves) ? value.moves : [];
    const dedup = new Map();

    for (const move of moves) {
      const name = typeof move?.name === "string" ? move.name.trim() : "";
      if (!name) continue;
      const level = toNumberOrNull(move?.level) ?? 0;
      const prev = dedup.get(name);
      if (!prev || level > prev.level) {
        dedup.set(name, { name, level });
      }
    }

    normalized[String(Number(idKey))] = Array.from(dedup.values());
  }

  return normalized;
}

function buildMoveCandidates(pokemon, learnedMoves, movesCacheByName, missingMoveNames) {
  const typeSet = new Set([pokemon.type1, pokemon.type2].filter(hasMeaningfulValue));
  const candidates = [];

  for (const learned of learnedMoves) {
    const moveName = learned?.name;
    if (!moveName) continue;

    const cache = movesCacheByName?.[moveName];
    if (!cache) {
      missingMoveNames.add(moveName);
      continue;
    }

    candidates.push({
      name: moveName,
      nameJa: hasMeaningfulValue(cache.nameJa) ? String(cache.nameJa).trim() : null,
      level: toNumberOrNull(learned.level) ?? 0,
      type: cache.type ?? null,
      power: toNumberOrNull(cache.power),
      damageClass: cache.damageClass ?? null,
      meta: cache.meta ?? {},
      statChanges: Array.isArray(cache.statChanges) ? cache.statChanges : [],
    });
  }

  return { candidates, typeSet };
}

function sortByPowerLevelNameDesc(a, b) {
  const aPower = toNumberOrNull(a.power) ?? -Infinity;
  const bPower = toNumberOrNull(b.power) ?? -Infinity;
  if (aPower !== bPower) return bPower - aPower;
  if (a.level !== b.level) return b.level - a.level;
  return a.name.localeCompare(b.name);
}

function moveSupportRank(move) {
  const healing = toNumberOrNull(move?.meta?.healing) ?? 0;
  if (healing > 0) return 1;

  const hasPositiveStatChange = (move.statChanges || []).some(
    (change) => (toNumberOrNull(change?.change) ?? 0) > 0
  );
  if (hasPositiveStatChange) return 2;

  const ailment = move?.meta?.ailment;
  const ailmentChance = toNumberOrNull(move?.meta?.ailmentChance) ?? 0;
  if (ailment && ailment !== "none" && ailmentChance > 0) return 3;

  return 4;
}

function selectRepresentativeMoves(candidates, typeSet) {
  const selected = [];
  const selectedNames = new Set();

  const attackMoves = candidates.filter(
    (move) =>
      (move.damageClass === "physical" || move.damageClass === "special") &&
      toNumberOrNull(move.power) !== null
  );

  const stabAttackMoves = attackMoves
    .filter((move) => typeSet.has(move.type))
    .sort(sortByPowerLevelNameDesc);

  const fallbackAttackMoves = attackMoves.sort(sortByPowerLevelNameDesc);
  const firstMove = stabAttackMoves[0] ?? fallbackAttackMoves[0] ?? null;
  if (firstMove) {
    selected.push(firstMove);
    selectedNames.add(firstMove.name);
  }

  const supportCandidates = candidates
    .filter((move) => move.damageClass === "status" && !selectedNames.has(move.name))
    .sort((a, b) => {
      const aRank = moveSupportRank(a);
      const bRank = moveSupportRank(b);
      if (aRank !== bRank) return aRank - bRank;
      if (a.level !== b.level) return b.level - a.level;
      return a.name.localeCompare(b.name);
    });

  const secondMove = supportCandidates[0] ?? null;
  if (secondMove) {
    selected.push(secondMove);
    selectedNames.add(secondMove.name);
  }

  const thirdCandidates = candidates
    .filter((move) => !selectedNames.has(move.name))
    .sort((a, b) => {
      if (a.level !== b.level) return b.level - a.level;

      const aAttack =
        (a.damageClass === "physical" || a.damageClass === "special") &&
        toNumberOrNull(a.power) !== null;
      const bAttack =
        (b.damageClass === "physical" || b.damageClass === "special") &&
        toNumberOrNull(b.power) !== null;
      if (aAttack !== bAttack) return bAttack - aAttack;

      const aPower = toNumberOrNull(a.power) ?? -Infinity;
      const bPower = toNumberOrNull(b.power) ?? -Infinity;
      if (aPower !== bPower) return bPower - aPower;

      return a.name.localeCompare(b.name);
    });

  const thirdMove = thirdCandidates[0] ?? null;
  if (thirdMove) {
    selected.push(thirdMove);
  }

  return selected;
}

function renderRepresentativeMovesSection(pokemon, movesByPokemon, movesCacheByName, missingMoveNames) {
  const learnedMoves = movesByPokemon[String(pokemon.id)] ?? [];
  const { candidates, typeSet } = buildMoveCandidates(
    pokemon,
    learnedMoves,
    movesCacheByName,
    missingMoveNames
  );
  const representatives = selectRepresentativeMoves(candidates, typeSet);

  if (representatives.length === 0) {
    return `
          <section class="page-card page-content">
            <h2>代表技</h2>
            <p>取得データなし</p>
          </section>`;
  }

  const rows = representatives
    .map((move) => {
      const powerText = toNumberOrNull(move.power) ?? NO_DATA;
      const levelText = toNumberOrNull(move.level) ?? NO_DATA;
      const moveNameText = hasMeaningfulValue(move.nameJa) ? move.nameJa : move.name;
      const moveTypeText = toJapaneseType(move.type);
      const damageClassText = toJapaneseDamageClass(move.damageClass);
      return `<tr>
                <td>${escapeHtml(moveNameText)}</td>
                <td>${escapeHtml(moveTypeText)}</td>
                <td>${escapeHtml(damageClassText)}</td>
                <td>${escapeHtml(String(powerText))}</td>
                <td>${escapeHtml(String(levelText))}</td>
              </tr>`;
    })
    .join("\n");

  return `
          <section class="page-card page-content">
            <h2>代表技</h2>
            <table class="pokemon-move-table">
              <thead>
                <tr>
                  <th>技名</th>
                  <th>タイプ</th>
                  <th>分類</th>
                  <th>威力</th>
                  <th>習得Lv</th>
                </tr>
              </thead>
              <tbody>
${rows}
              </tbody>
            </table>
          </section>`;
}

function renderNeighborLink(pokemon, label, direction, position) {
  if (!pokemon) {
    return `<span class="pokemon-detail-neighbor is-disabled">${escapeHtml(label)}</span>`;
  }
  const fileId = toPokemonFileId(pokemon.id);
  const iconHtml = hasMeaningfulValue(pokemon.sprite)
    ? `<img class="pokemon-detail-neighbor-icon" src="${escapeHtml(pokemon.sprite)}" alt="${escapeHtml(
        pokemon.name
      )}" loading="lazy" decoding="async" />`
    : `<span class="pokemon-detail-neighbor-icon is-fallback" aria-hidden="true">?</span>`;
  const arrowHtml = `<span class="pokemon-detail-neighbor-arrow">${escapeHtml(direction)}</span>`;
  const nameHtml = `<span class="pokemon-detail-neighbor-name">${escapeHtml(pokemon.name)}</span>`;
  const content =
    position === "prev"
      ? `${arrowHtml}${nameHtml}${iconHtml}`
      : `${iconHtml}${nameHtml}${arrowHtml}`;
  return `<a class="pokemon-detail-neighbor is-${escapeHtml(position)}" href="${fileId}.html">${content}</a>`;
}

function renderPokemonPage(context) {
  const {
    pokemon,
    prevPokemon,
    nextPokemon,
    displayDexIdMap,
    speciesById,
    movesByPokemon,
    movesCacheByName,
    missingMoveNames,
  } = context;

  const rawId = Number(pokemon.id);
  const displayDexId = displayDexIdMap.get(rawId) ?? rawId;
  const displayDexText = Number.isFinite(displayDexId)
    ? String(displayDexId).padStart(4, "0")
    : "0000";
  const spriteHtml = hasMeaningfulValue(pokemon.sprite)
    ? `<img class="pokemon-detail-sprite" src="${escapeHtml(pokemon.sprite)}" alt="${escapeHtml(pokemon.name)}" />`
    : `<p class="pokemon-detail-sprite-fallback">画像なし</p>`;

  const generationValue = hasMeaningfulValue(pokemon.generation)
    ? pokemon.generation
    : pokemon.debutGen;

  const totalStats = calcTotalStats(pokemon);
  const stats = pokemon.stats || {};

  const species = speciesById[String(pokemon.id)] || null;
  const genusText = hasMeaningfulValue(species?.genus) ? species.genus : NO_DATA;
  const flavorText = hasMeaningfulValue(species?.flavorText)
    ? species.flavorText
    : "取得データなし";
  const flavorVersion = hasMeaningfulValue(species?.flavorVersion)
    ? species.flavorVersion
    : null;

  const representativeMovesSection = renderRepresentativeMovesSection(
    pokemon,
    movesByPokemon,
    movesCacheByName,
    missingMoveNames
  );

  return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(pokemon.name)} | Poke Guesser</title>
    <link rel="stylesheet" href="../style.css" />
    <link
      rel="icon"
      href="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
    />
  </head>
  <body>
    <header id="app-header">
      <a class="logo" href="../index.html">Poke <span class="logo-accent">Guesser</span></a>
      <button id="hamburger-menu" aria-label="メニューを開く" type="button">
        <span></span>
        <span></span>
        <span></span>
      </button>
      <nav id="nav-menu">
        <div class="header-buttons">
          <a class="header-button" href="../index.html">HOME</a>
          <a class="header-button" href="../game.html">PLAY</a>
          <a class="header-button" href="../settings.html">SETTINGS</a>
          <a class="header-button" href="../about.html">ABOUT</a>
          <a class="header-button" href="../updates.html">UPDATES</a>
          <a class="header-button" href="../faq.html">FAQ</a>
          <a class="header-button" href="../glossary.html">用語</a>
          <a class="header-button" href="../privacy.html">Privacy</a>
          <a class="header-button" href="../terms.html">Terms</a>
          <a class="header-button" href="../contact.html">Contact</a>
          <a class="header-button" href="../credits.html">Credits</a>
          <a class="header-button" href="../profile.html">運営者情報</a>
        </div>
      </nav>
    </header>

    <div id="theme-container" class="page-shell">
      <main id="main-content">
        <div class="page-container">
          <header class="page-hero">
            <h1>${escapeHtml(pokemon.name)}</h1>
            <p>ポケモン個別ページ（No.${escapeHtml(displayDexText)}）</p>
          </header>

          <section class="page-card pokemon-search-section" aria-label="ポケモン詳細検索">
            <form id="pokemon-search-form" class="pokemon-search-form" autocomplete="off">
              <label class="pokemon-search-label" for="guess-input">ポケモン詳細を検索</label>
              <div id="game-controls" class="pokemon-search-controls">
                <div id="input-area">
                  <input
                    id="guess-input"
                    type="text"
                    autocomplete="off"
                    placeholder="ポケモン名で検索"
                  />
                  <button id="search-button" class="guess-button" type="submit">検索</button>
                </div>
                <div id="suggestions-box" class="hidden"></div>
              </div>
              <!-- 検索失敗時のみメッセージ表示 -->
              <p id="pokemon-search-feedback" class="pokemon-search-feedback" aria-live="polite"></p>
            </form>
          </section>

          <section class="page-card pokemon-detail-hero">
            <div class="pokemon-detail-sprite-wrap">
              ${spriteHtml}
            </div>
            <div class="pokemon-detail-headline">
              <p class="pokemon-detail-no">図鑑No: ${escapeHtml(displayDexText)}</p>
              <h2 class="pokemon-detail-name">${escapeHtml(pokemon.name)}</h2>
              <p class="pokemon-detail-types">タイプ: ${escapeHtml(formatTypeText(pokemon))}</p>
            </div>
          </section>

          <section class="page-card page-content">
            <h2>基本情報</h2>
            <table class="pokemon-info-table">
              <tbody>
                <tr><th>図鑑No / ID</th><td>${escapeHtml(displayDexText)}</td></tr>
                <tr><th>タイプ</th><td>${escapeHtml(formatTypeText(pokemon))}</td></tr>
                <tr><th>分類</th><td>${escapeHtml(genusText)}</td></tr>
                <tr><th>世代</th><td>${escapeHtml(valueOrDash(generationValue))}</td></tr>
                <tr><th>初登場作品</th><td>${escapeHtml(valueOrDash(pokemon.debutTitle))}</td></tr>
                <tr><th>高さ</th><td>${escapeHtml(valueOrDash(pokemon.height, "m"))}</td></tr>
                <tr><th>重さ</th><td>${escapeHtml(valueOrDash(pokemon.weight, "kg"))}</td></tr>
              </tbody>
            </table>
          </section>

          <section class="page-card page-content">
            <h2>図鑑説明</h2>
            <p class="dex-flavor-text">${escapeHtml(flavorText)}</p>
            ${
              flavorVersion
                ? `<p class="dex-flavor-meta">出典バージョン: ${escapeHtml(flavorVersion)}</p>`
                : ""
            }
          </section>

          <section class="page-card page-content">
            <h2>種族値</h2>
            <table class="pokemon-stat-table">
              <tbody>
                <tr><th>HP</th><td>${escapeHtml(statValue(stats, "hp"))}</td></tr>
                <tr><th>こうげき</th><td>${escapeHtml(statValue(stats, "attack"))}</td></tr>
                <tr><th>ぼうぎょ</th><td>${escapeHtml(statValue(stats, "defense"))}</td></tr>
                <tr><th>とくこう</th><td>${escapeHtml(statValue(stats, "spAttack"))}</td></tr>
                <tr><th>とくぼう</th><td>${escapeHtml(statValue(stats, "spDefense"))}</td></tr>
                <tr><th>すばやさ</th><td>${escapeHtml(statValue(stats, "speed"))}</td></tr>
              </tbody>
              <tfoot>
                <tr><th>合計種族値</th><td>${escapeHtml(String(totalStats))}</td></tr>
              </tfoot>
            </table>
          </section>
${representativeMovesSection}

          <nav class="page-card pokemon-detail-neighbors" aria-label="前後のポケモン">
            ${renderNeighborLink(prevPokemon, "前のポケモンはありません", "←", "prev")}
            <a class="pokemon-detail-neighbor pokemon-detail-neighbor-home" href="../index.html">HOMEへ</a>
            ${renderNeighborLink(nextPokemon, "次のポケモンはありません", "→", "next")}
          </nav>

          <footer id="site-footer">
            <div class="footer-links">
              <a class="footer-link" href="../privacy.html">Privacy</a>
              <span class="footer-sep">｜</span>
              <a class="footer-link" href="../terms.html">Terms</a>
              <span class="footer-sep">｜</span>
              <a class="footer-link" href="../contact.html">Contact</a>
              <span class="footer-sep">｜</span>
              <a class="footer-link" href="../credits.html">Credits</a>
              <span class="footer-sep">｜</span>
              <a class="footer-link" href="../faq.html">FAQ</a>
            </div>
          </footer>
        </div>
      </main>
    </div>

    <div class="footer-copy">© 2026 Poke Guesser</div>

    <script src="../js/site-nav.js" defer></script>
    <script type="module" src="../js/all-pokemon-data.js"></script>
    <script type="module" src="../js/pokemon-search.js"></script>
  </body>
</html>
`;
}

async function clearOldGeneratedFiles() {
  await fs.rm(outputDirPath, { recursive: true, force: true });
  await fs.mkdir(outputDirPath, { recursive: true });
}

async function main() {
  const pokemonList = await loadPokemonData();
  pokemonList.sort((a, b) => a.id - b.id);
  const displayDexIdMap = buildDisplayDexIdMap(pokemonList);

  const speciesData = await loadJsonIfExists(speciesDataPath);
  const movesCacheData = await loadJsonIfExists(movesCachePath);
  const pokemonMovesData = await loadJsonIfExists(pokemonMovesPath);

  const speciesById =
    speciesData?.byId && typeof speciesData.byId === "object" ? speciesData.byId : {};
  const movesCacheByName =
    movesCacheData?.byName && typeof movesCacheData.byName === "object"
      ? movesCacheData.byName
      : {};
  const movesByPokemon = normalizeMovesByPokemon(pokemonMovesData);

  const missingMoveNames = new Set();

  await clearOldGeneratedFiles();

  for (let index = 0; index < pokemonList.length; index += 1) {
    const pokemon = pokemonList[index];
    const prevPokemon = index > 0 ? pokemonList[index - 1] : null;
    const nextPokemon = index < pokemonList.length - 1 ? pokemonList[index + 1] : null;
    const fileName = `${toPokemonFileId(pokemon.id)}.html`;
    const filePath = path.join(outputDirPath, fileName);

    const pageHtml = renderPokemonPage({
      pokemon,
      prevPokemon,
      nextPokemon,
      displayDexIdMap,
      speciesById,
      movesByPokemon,
      movesCacheByName,
      missingMoveNames,
    });
    await fs.writeFile(filePath, pageHtml, "utf8");
  }

  console.log(`[pokemon-pages] Generated ${pokemonList.length} files in ${outputDirPath}`);
  if (Object.keys(speciesById).length === 0) {
    console.warn("[pokemon-pages] species_ja.json が見つからないため分類/図鑑説明は空表示です");
  }
  if (Object.keys(movesCacheByName).length === 0) {
    console.warn("[pokemon-pages] moves_cache.json が見つからないため代表技は空表示です");
  }
  if (Object.keys(movesByPokemon).length === 0) {
    console.warn("[pokemon-pages] pokemon_moves_sv_levelup.json が見つからないため代表技は空表示です");
  }
  if (missingMoveNames.size > 0) {
    const sample = Array.from(missingMoveNames).sort().slice(0, 30);
    console.warn(
      `[pokemon-pages] moves_cache に未収録の技を ${missingMoveNames.size} 件スキップしました: ${sample.join(", ")}`
    );
  }
}

main().catch((error) => {
  console.error("[pokemon-pages] generation failed:", error);
  process.exitCode = 1;
});
