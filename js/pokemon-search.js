import { allPokemonData } from "./all-pokemon-data.js";
import { normalizePokemonName } from "./utils.js";

const FORM_ID = "pokemon-search-form";
const INPUT_ID = "guess-input";
const SUGGESTIONS_ID = "suggestions-box";
const FEEDBACK_ID = "pokemon-search-feedback";
const NOT_FOUND_MESSAGE = "見つかりませんでした";
const NUMBER_SEARCH_DISABLED_MESSAGE = "図鑑No検索は使えません。ポケモン名で検索してください";
const DEFAULT_SPRITE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

function toHalfWidth(input) {
  return String(input).replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
}

function isNumberOnlyQuery(input) {
  const normalized = toHalfWidth(String(input).trim());
  return /^\d+$/.test(normalized);
}

function toPokemonFilename(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  const base = String(numericId);
  return numericId > 9999 ? `${base}.html` : `${base.padStart(4, "0")}.html`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toPokemonArray(rawData) {
  const source = Array.isArray(rawData) ? rawData : Object.values(rawData || {});
  return source
    .filter((pokemon) => pokemon && typeof pokemon === "object")
    .map((pokemon) => ({
      id: Number(pokemon.id),
      name: typeof pokemon.name === "string" ? pokemon.name.trim() : "",
      sprite: typeof pokemon.sprite === "string" && pokemon.sprite.trim() !== ""
        ? pokemon.sprite.trim()
        : DEFAULT_SPRITE,
      raw: pokemon,
    }))
    .filter((pokemon) => Number.isInteger(pokemon.id) && pokemon.id > 0 && pokemon.name !== "");
}

function createIndex(pokemonArray) {
  const byId = new Map();
  const byName = new Map();
  const records = [];

  for (const pokemon of pokemonArray) {
    if (!byId.has(pokemon.id)) {
      byId.set(pokemon.id, pokemon);
    }

    const aliases = new Set([pokemon.name]);
    for (const key of ["nameEn", "englishName", "enName", "apiName"]) {
      const value = pokemon.raw?.[key];
      if (typeof value === "string" && value.trim() !== "") {
        aliases.add(value.trim());
      }
    }

    const normalizedAliases = Array.from(aliases)
      .map((name) => normalizePokemonName(name))
      .filter((name) => name !== "");

    const record = {
      id: pokemon.id,
      name: pokemon.name,
      sprite: pokemon.sprite,
      normalizedName: normalizePokemonName(pokemon.name),
      normalizedAliases,
    };
    records.push(record);

    for (const key of normalizedAliases) {
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, record);
        continue;
      }
      if (record.name.length < existing.name.length) {
        byName.set(key, record);
        continue;
      }
      if (record.name.length === existing.name.length && record.id < existing.id) {
        byName.set(key, record);
      }
    }
  }

  records.sort((a, b) => a.id - b.id);
  return { byId, byName, records };
}

function setFeedback(feedbackEl, message, isError) {
  feedbackEl.textContent = message;
  feedbackEl.classList.toggle("is-error", Boolean(isError));
}

function getMatchIndex(record, normalizedQuery) {
  let best = Infinity;
  for (const alias of record.normalizedAliases) {
    const idx = alias.indexOf(normalizedQuery);
    if (idx !== -1 && idx < best) {
      best = idx;
    }
  }
  return best;
}

function getSuggestions(index, query, limit = 100) {
  const normalizedQuery = normalizePokemonName(query);
  if (!normalizedQuery) return [];

  return index.records
    .map((record) => {
      const matchIndex = getMatchIndex(record, normalizedQuery);
      if (matchIndex === Infinity) return null;
      return { record, matchIndex };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.matchIndex - b.matchIndex ||
        a.record.normalizedName.length - b.record.normalizedName.length ||
        a.record.name.localeCompare(b.record.name, "ja") ||
        a.record.id - b.record.id
    )
    .slice(0, limit)
    .map((item) => item.record);
}

function resolvePokemon(index, query) {
  const trimmed = String(query ?? "").trim();
  if (!trimmed) return null;

  const normalized = normalizePokemonName(trimmed);
  if (!normalized) return null;

  const exact = index.byName.get(normalized);
  if (exact) return exact;

  const partials = getSuggestions(index, trimmed, 1);
  return partials[0] ?? null;
}

function moveToPokemon(record) {
  const filename = toPokemonFilename(record?.id);
  if (!filename) return false;
  window.location.href = `./${filename}`;
  return true;
}

function initPokemonSearch() {
  const form = document.getElementById(FORM_ID);
  const input = document.getElementById(INPUT_ID);
  const suggestionsBox = document.getElementById(SUGGESTIONS_ID);
  const feedback = document.getElementById(FEEDBACK_ID);
  if (!form || !input || !suggestionsBox || !feedback) return;

  const pokemonArray = toPokemonArray(allPokemonData ?? globalThis.allPokemonData);
  if (pokemonArray.length === 0) {
    setFeedback(feedback, NOT_FOUND_MESSAGE, true);
    return;
  }

  const index = createIndex(pokemonArray);

  function hideSuggestions() {
    suggestionsBox.classList.add("hidden");
  }

  function renderSuggestions() {
    const query = input.value.trim();
    if (!query) {
      hideSuggestions();
      return;
    }

    suggestionsBox.style.width = `${input.offsetWidth}px`;
    const suggestions = getSuggestions(index, query, 100);

    if (suggestions.length === 0) {
      hideSuggestions();
      return;
    }

    const itemsHtml = suggestions
      .map(
        (record) => `
          <div class="suggestion-item" data-id="${record.id}">
            <img src="${escapeHtml(record.sprite)}" alt="${escapeHtml(record.name)}" class="suggestion-sprite">
            <span>${escapeHtml(record.name)}</span>
          </div>
        `
      )
      .join("");

    suggestionsBox.innerHTML = itemsHtml;
    suggestionsBox.querySelectorAll(".suggestion-item").forEach((item) => {
      item.addEventListener("click", () => {
        const targetId = Number(item.dataset.id);
        const record = index.byId.get(targetId);
        if (!record) return;
        input.value = record.name;
        setFeedback(feedback, "", false);
        hideSuggestions();
        input.focus();
      });
    });

    suggestionsBox.classList.remove("hidden");
  }

  input.addEventListener("input", () => {
    setFeedback(feedback, "", false);
    renderSuggestions();
  });

  input.addEventListener("focus", () => {
    renderSuggestions();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
    }
  });

  document.addEventListener("click", (event) => {
    if (!form.contains(event.target)) {
      hideSuggestions();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (isNumberOnlyQuery(input.value)) {
      setFeedback(feedback, NUMBER_SEARCH_DISABLED_MESSAGE, true);
      hideSuggestions();
      return;
    }

    const resolved = resolvePokemon(index, input.value);
    if (!resolved) {
      setFeedback(feedback, NOT_FOUND_MESSAGE, true);
      hideSuggestions();
      return;
    }

    moveToPokemon(resolved);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPokemonSearch, { once: true });
} else {
  initPokemonSearch();
}
