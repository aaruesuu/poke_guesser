import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const allPokemonDataPath = path.join(projectRoot, "js", "all-pokemon-data.js");
const dataDirPath = path.join(projectRoot, "data");
const outputPath = path.join(dataDirPath, "species_ja.json");

const POKEAPI_SPECIES_ENDPOINT = "https://pokeapi.co/api/v2/pokemon-species";
const POKEAPI_POKEMON_ENDPOINT = "https://pokeapi.co/api/v2/pokemon";
const MAX_CONCURRENCY = 5;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

const LANGUAGE_PRIORITY = ["ja-hrkt", "ja"];
const FLAVOR_VERSION_PRIORITY = ["violet", "scarlet"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\n\f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeLanguageName(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

async function loadAllPokemonData() {
  const source = await fs.readFile(allPokemonDataPath, "utf8");
  const transformed = source
    .replace(/^\s*export\s+const\s+allPokemonData\s*=/m, "globalThis.allPokemonData =")
    .replace(/^\s*export\s+default\s+/m, "globalThis.allPokemonData = ")
    .replace(/^\s*module\.exports\s*=/m, "globalThis.allPokemonData =")
    .replace(/^\s*exports\.allPokemonData\s*=/m, "globalThis.allPokemonData =");

  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(transformed, { filename: allPokemonDataPath }).runInContext(sandbox);

  return sandbox.allPokemonData;
}

function extractTargetIds(allPokemonData) {
  const arr = Array.isArray(allPokemonData)
    ? allPokemonData
    : Object.values(allPokemonData || {});

  const idSet = new Set();
  for (const pokemon of arr) {
    const numericId = Number(pokemon?.id);
    if (!Number.isInteger(numericId) || numericId <= 0) continue;
    idSet.add(numericId);
  }

  return Array.from(idSet).sort((a, b) => a - b);
}

function pickGenus(species) {
  const genera = Array.isArray(species?.genera) ? species.genera : [];
  for (const lang of LANGUAGE_PRIORITY) {
    const genusEntry = genera.find(
      (entry) => normalizeLanguageName(entry?.language?.name) === lang
    );
    const genus = normalizeText(genusEntry?.genus);
    if (genus) return genus;
  }
  return null;
}

function pickFlavorFromLanguage(entries, languageName) {
  const scoped = entries.filter(
    (entry) =>
      normalizeLanguageName(entry?.language?.name) === languageName &&
      normalizeText(entry?.flavor_text)
  );
  if (scoped.length === 0) return null;

  for (const versionName of FLAVOR_VERSION_PRIORITY) {
    const matched = scoped.find((entry) => entry?.version?.name === versionName);
    if (matched) {
      return {
        flavorText: normalizeText(matched.flavor_text),
        flavorVersion: matched?.version?.name ?? null,
      };
    }
  }

  const fallback = scoped[0];
  return {
    flavorText: normalizeText(fallback?.flavor_text),
    flavorVersion: fallback?.version?.name ?? null,
  };
}

function pickFlavor(species) {
  const entries = Array.isArray(species?.flavor_text_entries)
    ? species.flavor_text_entries
    : [];

  const preferredJa =
    pickFlavorFromLanguage(entries, "ja-hrkt") ??
    pickFlavorFromLanguage(entries, "ja");
  if (preferredJa) return preferredJa;

  return { flavorText: null, flavorVersion: null };
}

function isSpecies404(error) {
  return error?.status === 404;
}

async function fetchJsonWithRetry(url) {
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
      });

      if (response.ok) {
        return await response.json();
      }

      const retriable = response.status === 429 || response.status >= 500;
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.url = url;
      error.retriable = retriable;
      throw error;
    } catch (error) {
      lastError = error;
      const retriable = error?.retriable === true || error?.name === "TypeError";
      if (!retriable || attempt === MAX_RETRIES) break;
      const backoffMs = BACKOFF_BASE_MS * 2 ** attempt;
      await sleep(backoffMs);
    }
  }
  throw lastError ?? new Error(`fetch failed: ${url}`);
}

async function fetchSpeciesWithRetry(id) {
  try {
    return await fetchJsonWithRetry(`${POKEAPI_SPECIES_ENDPOINT}/${id}`);
  } catch (error) {
    if (!isSpecies404(error)) {
      throw error;
    }
  }

  const pokemon = await fetchJsonWithRetry(`${POKEAPI_POKEMON_ENDPOINT}/${id}`);
  const speciesUrl = pokemon?.species?.url;
  if (!speciesUrl) {
    throw new Error(`pokemon ${id} has no species URL`);
  }
  return await fetchJsonWithRetry(speciesUrl);
}

async function fetchAllSpecies(ids) {
  const total = ids.length;
  const results = new Map();
  const failedIds = [];
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= total) return;

      const id = ids[current];
      try {
        const species = await fetchSpeciesWithRetry(id);
        const genus = pickGenus(species);
        const { flavorText, flavorVersion } = pickFlavor(species);
        results.set(id, {
          genus,
          flavorText,
          flavorVersion,
        });
        completed += 1;
        console.log(`[${completed}/${total}] fetched species ${id}`);
      } catch (error) {
        failedIds.push(id);
        completed += 1;
        console.error(
          `[${completed}/${total}] failed species ${id}: ${error?.message ?? String(error)}`
        );
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, total) },
    () => worker()
  );
  await Promise.all(workers);

  const byId = {};
  for (const id of ids) {
    if (!results.has(id)) continue;
    byId[String(id)] = results.get(id);
  }

  return { byId, failedIds };
}

async function writeOutput(byId, failedIds) {
  await fs.mkdir(dataDirPath, { recursive: true });

  const meta = {
    generatedAt: new Date().toISOString(),
    source: "PokeAPI",
    languagePriority: LANGUAGE_PRIORITY,
    flavorVersionPriority: FLAVOR_VERSION_PRIORITY,
  };
  if (failedIds.length > 0) {
    meta.failedIds = failedIds;
  }

  const payload = { meta, byId };
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const allPokemonData = await loadAllPokemonData();
  const targetIds = extractTargetIds(allPokemonData);
  if (targetIds.length === 0) {
    throw new Error("対象となるポケモンIDを取得できませんでした。");
  }

  console.log(`Target species IDs: ${targetIds.length}`);
  const { byId, failedIds } = await fetchAllSpecies(targetIds);
  await writeOutput(byId, failedIds);

  const generatedCount = Object.keys(byId).length;
  console.log(`Generated data/species_ja.json: ${generatedCount} species`);

  if (failedIds.length > 0) {
    console.error(`Failed IDs (${failedIds.length}): ${failedIds.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[fetch-species-ja] failed:", error?.stack ?? error);
  process.exitCode = 1;
});
