import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const allPokemonDataPath = path.join(projectRoot, "js", "all-pokemon-data.js");
const dataDirPath = path.join(projectRoot, "data");
const outputPath = path.join(dataDirPath, "moves_cache.json");

const POKEAPI_POKEMON_ENDPOINT = "https://pokeapi.co/api/v2/pokemon";
const POKEAPI_SPECIES_ENDPOINT = "https://pokeapi.co/api/v2/pokemon-species";
const POKEAPI_MOVE_ENDPOINT = "https://pokeapi.co/api/v2/move";
const TARGET_LEARN_METHOD = "level-up";
const PREFERRED_VERSION_GROUP = "scarlet-violet";
const MOVE_NAME_LANGUAGE_PRIORITY = ["ja-Hrkt", "ja", "en"];

const MAX_CONCURRENCY = 5;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;
const REQUEST_TIMEOUT_MS = 20000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function fetchJsonWithRetry(url) {
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
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
      const isAbort = error?.name === "AbortError";
      const wrappedError = isAbort
        ? Object.assign(new Error(`Timeout ${REQUEST_TIMEOUT_MS}ms`), {
            retriable: true,
            url,
          })
        : error;
      lastError = wrappedError;
      const retriable =
        wrappedError?.retriable === true || wrappedError?.name === "TypeError";
      if (!retriable || attempt === MAX_RETRIES) break;
      const backoffMs = BACKOFF_BASE_MS * 2 ** attempt;
      await sleep(backoffMs);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError ?? new Error(`fetch failed: ${url}`);
}

async function fetchPokemonWithFallback(pokemonId) {
  try {
    return await fetchJsonWithRetry(`${POKEAPI_POKEMON_ENDPOINT}/${pokemonId}`);
  } catch (primaryError) {
    const species = await fetchJsonWithRetry(`${POKEAPI_SPECIES_ENDPOINT}/${pokemonId}`);
    const defaultVariety =
      species?.varieties?.find((entry) => entry?.is_default) ??
      species?.varieties?.[0] ??
      null;
    const fallbackUrl = defaultVariety?.pokemon?.url;
    if (!fallbackUrl) throw primaryError;
    return await fetchJsonWithRetry(fallbackUrl);
  }
}

function collectLevelUpMoveNames(pokemonPayload) {
  const names = new Set();
  const moveEntries = Array.isArray(pokemonPayload?.moves) ? pokemonPayload.moves : [];

  for (const moveEntry of moveEntries) {
    const moveName = moveEntry?.move?.name;
    if (!moveName) continue;

    const details = Array.isArray(moveEntry?.version_group_details)
      ? moveEntry.version_group_details
      : [];

    const levelUpDetails = details.filter(
      (detail) => detail?.move_learn_method?.name === TARGET_LEARN_METHOD
    );
    if (levelUpDetails.length === 0) continue;

    const hasPreferredVersion = levelUpDetails.some(
      (detail) => detail?.version_group?.name === PREFERRED_VERSION_GROUP
    );

    if (hasPreferredVersion || levelUpDetails.length > 0) {
      names.add(moveName);
    }
  }

  return names;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function pickLocalizedMoveName(move) {
  const names = Array.isArray(move?.names) ? move.names : [];

  for (const languageCode of MOVE_NAME_LANGUAGE_PRIORITY) {
    const localized = names.find(
      (entry) =>
        entry?.language?.name === languageCode &&
        typeof entry?.name === "string" &&
        entry.name.trim() !== ""
    );
    if (localized) {
      return localized.name.trim();
    }
  }

  if (typeof move?.name === "string" && move.name.trim() !== "") {
    return move.name.trim();
  }
  return null;
}

async function collectTargetMoveNames(pokemonIds) {
  const total = pokemonIds.length;
  const failedPokemonIds = [];
  const moveNameSet = new Set();
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= total) return;

      const pokemonId = pokemonIds[current];
      try {
        const payload = await fetchPokemonWithFallback(pokemonId);
        const localMoveNames = collectLevelUpMoveNames(payload);
        for (const name of localMoveNames) {
          moveNameSet.add(name);
        }
        completed += 1;
        console.log(`[pokemon ${completed}/${total}] fetched ${pokemonId}`);
      } catch (error) {
        failedPokemonIds.push(pokemonId);
        completed += 1;
        console.error(
          `[pokemon ${completed}/${total}] failed ${pokemonId}: ${error?.message ?? String(error)}`
        );
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, total) },
    () => worker()
  );
  await Promise.all(workers);

  if (failedPokemonIds.length > 0) {
    const retryTargets = [...failedPokemonIds];
    failedPokemonIds.length = 0;
    let retryCompleted = 0;
    console.warn(
      `[pokemon retry] retrying ${retryTargets.length} failed IDs`
    );

    for (const pokemonId of retryTargets) {
      try {
        const payload = await fetchPokemonWithFallback(pokemonId);
        const localMoveNames = collectLevelUpMoveNames(payload);
        for (const name of localMoveNames) {
          moveNameSet.add(name);
        }
        retryCompleted += 1;
        console.log(
          `[pokemon retry ${retryCompleted}/${retryTargets.length}] fetched ${pokemonId}`
        );
      } catch (error) {
        failedPokemonIds.push(pokemonId);
        retryCompleted += 1;
        console.error(
          `[pokemon retry ${retryCompleted}/${retryTargets.length}] failed ${pokemonId}: ${error?.message ?? String(error)}`
        );
      }
    }
  }

  return { moveNames: Array.from(moveNameSet).sort(), failedPokemonIds };
}

function toMoveCacheEntry(move) {
  const statChanges = Array.isArray(move?.stat_changes)
    ? move.stat_changes.map((entry) => ({
        stat: entry?.stat?.name ?? null,
        change: toNumberOrNull(entry?.change),
      }))
    : [];

  return {
    id: toNumberOrNull(move?.id),
    name: move?.name ?? null,
    nameJa: pickLocalizedMoveName(move),
    type: move?.type?.name ?? null,
    power: toNumberOrNull(move?.power),
    accuracy: toNumberOrNull(move?.accuracy),
    pp: toNumberOrNull(move?.pp),
    priority: toNumberOrNull(move?.priority),
    damageClass: move?.damage_class?.name ?? null,
    meta: {
      ailment: move?.meta?.ailment?.name ?? null,
      ailmentChance: toNumberOrNull(move?.meta?.ailment_chance),
      category: move?.meta?.category?.name ?? null,
      critRate: toNumberOrNull(move?.meta?.crit_rate),
      drain: toNumberOrNull(move?.meta?.drain),
      flinchChance: toNumberOrNull(move?.meta?.flinch_chance),
      healing: toNumberOrNull(move?.meta?.healing),
      maxHits: toNumberOrNull(move?.meta?.max_hits),
      minHits: toNumberOrNull(move?.meta?.min_hits),
      maxTurns: toNumberOrNull(move?.meta?.max_turns),
      minTurns: toNumberOrNull(move?.meta?.min_turns),
      statChance: toNumberOrNull(move?.meta?.stat_chance),
    },
    statChanges,
    learnMethodHint: {
      preferredVersionGroup: PREFERRED_VERSION_GROUP,
      learnMethod: TARGET_LEARN_METHOD,
    },
  };
}

async function fetchMovesCache(moveNames) {
  const total = moveNames.length;
  const byName = {};
  const failedMoveNames = [];
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= total) return;

      const moveName = moveNames[current];
      try {
        const payload = await fetchJsonWithRetry(
          `${POKEAPI_MOVE_ENDPOINT}/${encodeURIComponent(moveName)}`
        );
        byName[moveName] = toMoveCacheEntry(payload);
        completed += 1;
        console.log(`[move ${completed}/${total}] fetched ${moveName}`);
      } catch (error) {
        failedMoveNames.push(moveName);
        completed += 1;
        console.error(
          `[move ${completed}/${total}] failed ${moveName}: ${error?.message ?? String(error)}`
        );
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, total) },
    () => worker()
  );
  await Promise.all(workers);

  const orderedByName = {};
  for (const name of Object.keys(byName).sort()) {
    orderedByName[name] = byName[name];
  }

  return { byName: orderedByName, failedMoveNames };
}

async function writeOutput(byName, failedPokemonIds, failedMoveNames) {
  await fs.mkdir(dataDirPath, { recursive: true });

  const meta = {
    generatedAt: new Date().toISOString(),
    source: "PokeAPI",
    note: "Cache for representative-moves selection. Contains minimal move fields.",
  };

  if (failedPokemonIds.length > 0) {
    meta.failedPokemonIds = failedPokemonIds;
  }
  if (failedMoveNames.length > 0) {
    meta.failedMoveNames = failedMoveNames;
  }

  const payload = { meta, byName };
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const allPokemonData = await loadAllPokemonData();
  const pokemonIds = extractTargetIds(allPokemonData);
  if (pokemonIds.length === 0) {
    throw new Error("対象ポケモンIDが 0 件です。");
  }

  console.log(`Target pokemon IDs: ${pokemonIds.length}`);
  const { moveNames, failedPokemonIds } = await collectTargetMoveNames(pokemonIds);
  console.log(`Unique level-up moves extracted: ${moveNames.length}`);

  const { byName, failedMoveNames } = await fetchMovesCache(moveNames);
  await writeOutput(byName, failedPokemonIds, failedMoveNames);

  const generatedCount = Object.keys(byName).length;
  console.log(`Generated data/moves_cache.json: ${generatedCount} moves`);

  if (failedPokemonIds.length > 0) {
    console.error(
      `Failed pokemon IDs (${failedPokemonIds.length}): ${failedPokemonIds.join(", ")}`
    );
  }
  if (failedMoveNames.length > 0) {
    console.error(
      `Failed move names (${failedMoveNames.length}): ${failedMoveNames.join(", ")}`
    );
  }
  if (failedPokemonIds.length > 0 || failedMoveNames.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[fetch-moves-cache] failed:", error?.stack ?? error);
  process.exitCode = 1;
});
