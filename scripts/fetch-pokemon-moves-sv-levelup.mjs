import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const allPokemonDataPath = path.join(projectRoot, "js", "all-pokemon-data.js");
const dataDirPath = path.join(projectRoot, "data");
const outputPath = path.join(dataDirPath, "pokemon_moves_sv_levelup.json");

const POKEAPI_POKEMON_ENDPOINT = "https://pokeapi.co/api/v2/pokemon";
const POKEAPI_SPECIES_ENDPOINT = "https://pokeapi.co/api/v2/pokemon-species";
const PREFERRED_VERSION_GROUP = "scarlet-violet";
const TARGET_LEARN_METHOD = "level-up";

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
      error.retriable = retriable;
      throw error;
    } catch (error) {
      const wrappedError =
        error?.name === "AbortError"
          ? Object.assign(new Error(`Timeout ${REQUEST_TIMEOUT_MS}ms`), {
              retriable: true,
            })
          : error;

      lastError = wrappedError;
      const retriable =
        wrappedError?.retriable === true || wrappedError?.name === "TypeError";
      if (!retriable || attempt === MAX_RETRIES) break;

      await sleep(BACKOFF_BASE_MS * 2 ** attempt);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error(`fetch failed: ${url}`);
}

async function fetchPokemonWithFallback(id) {
  try {
    return await fetchJsonWithRetry(`${POKEAPI_POKEMON_ENDPOINT}/${id}`);
  } catch (primaryError) {
    const species = await fetchJsonWithRetry(`${POKEAPI_SPECIES_ENDPOINT}/${id}`);
    const defaultVariety =
      species?.varieties?.find((entry) => entry?.is_default) ??
      species?.varieties?.[0] ??
      null;
    const fallbackUrl = defaultVariety?.pokemon?.url;
    if (!fallbackUrl) throw primaryError;
    return await fetchJsonWithRetry(fallbackUrl);
  }
}

function toNumberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function extractLevelUpMovesFromPokemon(pokemonPayload) {
  const moves = Array.isArray(pokemonPayload?.moves) ? pokemonPayload.moves : [];
  const byName = new Map();

  for (const moveEntry of moves) {
    const name = moveEntry?.move?.name;
    if (!name) continue;

    const details = Array.isArray(moveEntry?.version_group_details)
      ? moveEntry.version_group_details
      : [];

    const levelUpDetails = details.filter(
      (detail) => detail?.move_learn_method?.name === TARGET_LEARN_METHOD
    );
    if (levelUpDetails.length === 0) continue;

    const svDetails = levelUpDetails.filter(
      (detail) => detail?.version_group?.name === PREFERRED_VERSION_GROUP
    );

    let selectedLevel = 0;
    let selectedVersionGroup = null;

    if (svDetails.length > 0) {
      selectedLevel = svDetails.reduce(
        (max, detail) => Math.max(max, toNumberOrZero(detail?.level_learned_at)),
        0
      );
      selectedVersionGroup = PREFERRED_VERSION_GROUP;
    } else {
      const firstDetail = levelUpDetails[0];
      selectedLevel = toNumberOrZero(firstDetail?.level_learned_at);
      selectedVersionGroup = firstDetail?.version_group?.name ?? null;
    }

    const prev = byName.get(name);
    if (!prev || selectedLevel > prev.level) {
      byName.set(name, {
        name,
        level: selectedLevel,
        versionGroup: selectedVersionGroup,
      });
    }
  }

  return Array.from(byName.values()).sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return a.name.localeCompare(b.name);
  });
}

async function fetchAllPokemonMoves(ids) {
  const total = ids.length;
  const byId = {};
  const failedPokemonIds = [];

  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= total) return;

      const id = ids[current];
      try {
        const pokemonPayload = await fetchPokemonWithFallback(id);
        const extracted = extractLevelUpMovesFromPokemon(pokemonPayload);
        byId[String(id)] = { moves: extracted };
        completed += 1;
        console.log(`[pokemon ${completed}/${total}] fetched ${id}`);
      } catch (error) {
        failedPokemonIds.push(id);
        byId[String(id)] = { moves: [] };
        completed += 1;
        console.error(
          `[pokemon ${completed}/${total}] failed ${id}: ${error?.message ?? String(error)}`
        );
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, total) },
    () => worker()
  );
  await Promise.all(workers);

  return { byId, failedPokemonIds };
}

async function writeOutput(byId, failedPokemonIds) {
  await fs.mkdir(dataDirPath, { recursive: true });

  const meta = {
    generatedAt: new Date().toISOString(),
    source: "PokeAPI",
    preferredVersionGroup: PREFERRED_VERSION_GROUP,
    learnMethod: TARGET_LEARN_METHOD,
  };
  if (failedPokemonIds.length > 0) {
    meta.failedPokemonIds = failedPokemonIds;
  }

  const payload = { meta, byId };
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const allPokemonData = await loadAllPokemonData();
  const ids = extractTargetIds(allPokemonData);
  if (ids.length === 0) {
    throw new Error("対象ポケモンIDが 0 件です。");
  }

  console.log(`Target pokemon IDs: ${ids.length}`);
  const { byId, failedPokemonIds } = await fetchAllPokemonMoves(ids);
  await writeOutput(byId, failedPokemonIds);

  const generatedCount = Object.keys(byId).length;
  console.log(`Generated data/pokemon_moves_sv_levelup.json: ${generatedCount} pokemon`);

  if (failedPokemonIds.length > 0) {
    console.error(
      `Failed pokemon IDs (${failedPokemonIds.length}): ${failedPokemonIds.join(", ")}`
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[fetch-pokemon-moves-sv-levelup] failed:", error?.stack ?? error);
  process.exitCode = 1;
});
