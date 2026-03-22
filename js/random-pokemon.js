import { allPokemonData } from "./all-pokemon-data.js";
import { formatGenderRate } from "./utils.js";

const LAST_ID_KEY = "poke-guesser:randomPokemon:lastId";
const FALLBACK_SPRITE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

const cardRoot = document.getElementById("random-pokemon-card");
const refreshButton = document.getElementById("random-pokemon-refresh");

if (!cardRoot) {
  // Home-only feature. Skip quietly on other pages.
} else {
  const pokemonList = Object.values(allPokemonData || {}).filter(
    (pokemon) => pokemon && typeof pokemon.id === "number" && pokemon.name
  );

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

  function resolveDisplayDexId(pokemon) {
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

  function readLastId() {
    try {
      const raw = sessionStorage.getItem(LAST_ID_KEY);
      return raw ? Number(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function saveLastId(id) {
    try {
      sessionStorage.setItem(LAST_ID_KEY, String(id));
    } catch (error) {
      // Ignore storage failures in strict/private environments.
    }
  }

  function pickRandomPokemon() {
    if (pokemonList.length === 0) return null;
    if (pokemonList.length === 1) return pokemonList[0];

    const lastId = readLastId();
    let picked = pokemonList[Math.floor(Math.random() * pokemonList.length)];

    if (typeof lastId === "number") {
      for (let i = 0; i < 5 && picked.id === lastId; i += 1) {
        picked = pokemonList[Math.floor(Math.random() * pokemonList.length)];
      }
    }

    saveLastId(picked.id);
    return picked;
  }

  function formatTypes(pokemon) {
    const types = [pokemon.type1, pokemon.type2].filter(
      (type) => type && type !== "なし"
    );
    return types.length ? types.join(" / ") : "—";
  }

  function formatCombined(values) {
    const filtered = (values || []).filter((value) => value && value !== "なし");
    return filtered.length ? filtered.join(" / ") : "—";
  }

  function formatMeasure(value, unit) {
    if (typeof value !== "number" || Number.isNaN(value)) return "—";
    return `${value}${unit}`;
  }

  function calcTotalStats(pokemon) {
    if (typeof pokemon.totalStats === "number") return pokemon.totalStats;
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

  function toPokemonPagePath(id) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return null;
    const fileId = numericId > 9999 ? String(numericId) : String(numericId).padStart(4, "0");
    return `pokemon/${fileId}.html`;
  }

  function getStatValue(stats, key) {
    const value = Number(stats?.[key]);
    return Number.isFinite(value) ? value : "—";
  }

  function renderPokemonCard(pokemon) {
    if (!pokemon) {
      cardRoot.textContent = "表示できるポケモンが見つかりませんでした。";
      return;
    }

    const stats = pokemon.stats || {};
    const totalStats = calcTotalStats(pokemon);
    const generation = pokemon.generation || pokemon.debutGen || "—";
    const debutTitle = pokemon.debutTitle ? pokemon.debutTitle : "";
    const displayDexId = resolveDisplayDexId(pokemon);
    const displayDexText = Number.isFinite(displayDexId)
      ? String(displayDexId).padStart(4, "0")
      : "----";
    const modeSelectionUrl = `game.html?mode=randomStart&startPokemonId=${encodeURIComponent(String(pokemon.id))}`;
    const detailUrl = toPokemonPagePath(pokemon.id);
    const profileRows = [
      ["タイプ", formatTypes(pokemon)],
      ["世代", generation],
      ["初登場作品", debutTitle || "—"],
      ["高さ", formatMeasure(pokemon.height, "m")],
      ["重さ", formatMeasure(pokemon.weight, "kg")],
      ["進化数", Number.isFinite(Number(pokemon.evolutionCount)) ? Number(pokemon.evolutionCount) : "—"],
      ["性別比", formatGenderRate(pokemon.genderRate)],
      ["特性", formatCombined([pokemon.ability1, pokemon.ability2, pokemon.hiddenAbility])],
      ["タマゴグループ", formatCombined([pokemon.eggGroup1, pokemon.eggGroup2])],
    ];

    cardRoot.innerHTML = `
      <article class="random-card__inner">
        <div class="random-card__sprite-wrap">
          <img
            class="random-card__img"
            src="${pokemon.sprite || FALLBACK_SPRITE}"
            alt="${pokemon.name}"
          />
        </div>
        <div class="random-card__meta">
          <p class="random-card__number">No.${displayDexText}</p>
          <h3 class="random-card__name">${pokemon.name}</h3>

          <h4 class="random-card__section-title">種族値</h4>
          <div class="random-card__stats-grid">
            <div class="random-card__stat-item"><span class="random-card__stat-label">HP</span><span class="random-card__stat-value">${getStatValue(stats, "hp")}</span></div>
            <div class="random-card__stat-item"><span class="random-card__stat-label">こうげき</span><span class="random-card__stat-value">${getStatValue(stats, "attack")}</span></div>
            <div class="random-card__stat-item"><span class="random-card__stat-label">ぼうぎょ</span><span class="random-card__stat-value">${getStatValue(stats, "defense")}</span></div>
            <div class="random-card__stat-item"><span class="random-card__stat-label">とくこう</span><span class="random-card__stat-value">${getStatValue(stats, "spAttack")}</span></div>
            <div class="random-card__stat-item"><span class="random-card__stat-label">とくぼう</span><span class="random-card__stat-value">${getStatValue(stats, "spDefense")}</span></div>
            <div class="random-card__stat-item"><span class="random-card__stat-label">すばやさ</span><span class="random-card__stat-value">${getStatValue(stats, "speed")}</span></div>
            <div class="random-card__stat-item is-total"><span class="random-card__stat-label">合計種族値</span><span class="random-card__stat-value">${totalStats}</span></div>
          </div>

          <h4 class="random-card__section-title">プロフィール</h4>
          <div class="random-card__profile-grid">
            ${profileRows
              .map(
                ([label, value]) => `
                  <div class="random-card__profile-row">
                    <span class="random-card__profile-label">${label}</span>
                    <span class="random-card__profile-value">${value}</span>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>

        <div class="random-card__cta-row">
          <a class="sub-button nav-link-button random-card__play" href="${modeSelectionUrl}">このポケモンで遊ぶ</a>
          ${
            detailUrl
              ? `<a class="sub-button nav-link-button random-card__detail" href="${detailUrl}">詳細を見る</a>`
              : ""
          }
        </div>
      </article>
    `;

    const img = cardRoot.querySelector(".random-card__img");
    if (img) {
      img.addEventListener("error", () => {
        img.src = FALLBACK_SPRITE;
      });
    }
  }

  function refreshRandomPokemon() {
    renderPokemonCard(pickRandomPokemon());
  }

  if (refreshButton) {
    refreshButton.addEventListener("click", refreshRandomPokemon);
  }

  refreshRandomPokemon();
}
