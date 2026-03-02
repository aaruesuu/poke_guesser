import { allPokemonData } from "./all-pokemon-data.js";

const STORAGE_KEY = "poke-guesser/debut-filters/v1";
const HAS_LOCAL_STORAGE = typeof localStorage !== "undefined";

const BASE_SECTIONS = [
  { heading: "第一世代", options: [
    { id: "red-green", label: "赤緑/青/ピカチュウ", titles: ["赤緑"] },
  ] },
  { heading: "第二世代", options: [
    { id: "gs", label: "金銀/クリスタル", titles: ["金銀"] },
  ] },
  { heading: "第三世代", options: [
    { id: "rs", label: "RS", titles: ["RS"] },
    { id: "frlg", label: "FRLG", titles: ["FRLG"] },
    { id: "emerald", label: "エメラルド", titles: ["エメラルド"] },
  ] },
  { heading: "第四世代", options: [
    { id: "dp", label: "DP", titles: ["DP"] },
    { id: "pt", label: "Pt", titles: ["Pt"] },
  ] },
  { heading: "第五世代", options: [
    { id: "bw", label: "BW", titles: ["BW"] },
    { id: "b2w2", label: "B2W2", titles: ["B2W2"] },
  ] },
  { heading: "第六世代", options: [
    { id: "xy", label: "XY", titles: ["XY"] },
    { id: "oras", label: "ORAS", titles: ["ORAS"] },
  ] },
  { heading: "第七世代", options: [
    { id: "sm", label: "SM", titles: ["SM"] },
    { id: "usum", label: "USUM", titles: ["USUM"] },
  ] },
  { heading: "第八世代", options: [
    { id: "swsh", label: "剣盾", titles: ["剣盾"] },
    { id: "letsgo", label: "ピカブイ", titles: ["ピカブイ"] },
    { id: "arceus", label: "アルセウス", titles: ["アルセウス"] },
  ] },
  { heading: "第九世代", options: [
    { id: "sv", label: "SV", titles: ["SV"] },
    { id: "za", label: "ZA", titles: ["ZA"] },
  ] },
  { heading: "外伝作品", options: [
    { id: "go", label: "ポケモンGO", titles: ["ポケモンGO"] },
    { id: "home", label: "ポケモンHOME", titles: ["ポケモンHOME"] },
  ] },
];

const DATA_DEBUT_TITLES = new Set(
  Object.values(allPokemonData)
    .map((p) => p.debutTitle)
    .filter(Boolean)
);

const TITLE_COUNTS = Object.values(allPokemonData).reduce((counts, pokemon) => {
  const title = pokemon.debutTitle;
  if (!title) return counts;
  counts[title] = (counts[title] || 0) + 1;
  return counts;
}, {});
const KNOWN_TITLES = new Set(
  BASE_SECTIONS.flatMap((section) => section.options.flatMap((opt) => opt.titles))
);

const ALL_TITLES = new Set([...DATA_DEBUT_TITLES, ...KNOWN_TITLES]);

const extraTitles = [...DATA_DEBUT_TITLES].filter((title) => !KNOWN_TITLES.has(title));

function buildSections() {
  if (extraTitles.length === 0) {
    return BASE_SECTIONS;
  }

  return [
    ...BASE_SECTIONS,
    {
      heading: "その他",
      options: extraTitles.map((title) => ({
        id: `extra-${title}`,
        label: title,
        titles: [title],
      })),
    },
  ];
}

let selectedTitles = loadSelection();

function loadSelection() {
  try {
    if (!HAS_LOCAL_STORAGE) return new Set(DATA_DEBUT_TITLES);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set(DATA_DEBUT_TITLES);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DATA_DEBUT_TITLES);
    const filtered = parsed.filter((title) => ALL_TITLES.has(title));
    return new Set(filtered.length ? filtered : DATA_DEBUT_TITLES);
  } catch (e) {
    console.warn("[Settings] failed to load selection", e);
    return new Set(DATA_DEBUT_TITLES);
  }
}

function persistSelection() {
  if (!HAS_LOCAL_STORAGE) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...selectedTitles]));
  } catch (e) {
    console.warn("[Settings] failed to save selection", e);
  }
}

function setSelection(next) {
  const filtered = new Set([...next].filter((title) => ALL_TITLES.has(title)));
  selectedTitles = filtered;
  persistSelection();
}

export function getDebutFilterSections() {
  return buildSections();
}

export function getDebutTitleCounts() {
  return { ...TITLE_COUNTS };
}

export function getActiveDebutTitles() {
  return new Set(selectedTitles);
}

export function setDebutTitlesEnabled(titles, enabled) {
  const next = new Set(selectedTitles);
  titles.forEach((title) => {
    if (!ALL_TITLES.has(title)) return;
    if (enabled) {
      next.add(title);
    } else {
      next.delete(title);
    }
  });
  setSelection(next);
  return getActiveDebutTitles();
}

export function selectAllDebutTitles() {
  const next = new Set(ALL_TITLES);
  setSelection(next);
  return getActiveDebutTitles();
}

export function clearAllDebutTitles() {
  setSelection(new Set());
  return getActiveDebutTitles();
}

export function filterPokemonNamesByDebut(names) {
  const active = selectedTitles.size ? selectedTitles : DATA_DEBUT_TITLES;
  const usableTitles = [...active].filter((title) => DATA_DEBUT_TITLES.has(title));
  if (usableTitles.length === 0) {
    return names;
  }
  const activeSet = new Set(usableTitles);
  return names.filter((name) => activeSet.has(allPokemonData[name]?.debutTitle));
}

export function getDebutSelectionSummary() {
  const total = DATA_DEBUT_TITLES.size;
  const selected = selectedTitles.size;
  const effectiveSelected = [...selectedTitles].filter((title) => DATA_DEBUT_TITLES.has(title)).length;
  const usingFallback = effectiveSelected === 0;
  return { selected, effectiveSelected, total, usingFallback };
}
