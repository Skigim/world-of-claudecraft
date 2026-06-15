import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { localizeServerText, tServer, DICT as serverDICT } from "../src/ui/server_i18n";
import { DICT as adminDICT } from "../src/admin/i18n";
import {
  setLanguage, supportedLanguages,
  en, es, es_ES, fr_FR, fr_CA, en_CA, it_IT, de_DE, zh_CN, zh_TW, ko_KR, ja_JP, pt_BR, ru_RU,
} from "../src/ui/i18n";
import { talentTranslationManifest, renderTalentManifestEntry, hasTalentTitleOverride } from "../src/ui/talent_i18n";
import { ABILITIES } from "../src/sim/data";

const locales: Record<string, any> = { en, es, es_ES, fr_FR, fr_CA, en_CA, it_IT, de_DE, zh_CN, zh_TW, ko_KR, ja_JP, pt_BR, ru_RU };
const ph = (s: string) => [...String(s).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort().join(",");

// --- B1: the log-event path must localize server-sent friends/guild/who/world messages ---
describe("B1: server log-type messages localize through the log path", () => {
  it("all three hud matchers call AND return the localizeServerText fallback", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/ui/hud.ts"), "utf8");
    for (const fn of ["localizeSystemText", "localizeErrorText", "localizeLootText"]) {
      const start = src.indexOf(`private ${fn}(`);
      expect(start, `${fn} not found`).toBeGreaterThan(0);
      const body = src.slice(start, src.indexOf("\n  private ", start + 1));
      // Must both compute the fallback and return it (not just mention the symbol).
      expect(body, `${fn} must call localizeServerText`).toContain("localizeServerText(text)");
      expect(/const server = localizeServerText\(text\);\s*\n\s*if \(server !== null\) return server;/.test(body),
        `${fn} must return the localizeServerText result when non-null`).toBe(true);
    }
  });

  it("recognizes and localizes the actual server log-type messages in every locale", () => {
    const logMessages = [
      "Mira added to friends.",
      "Mira removed from friends.",
      "Bob has joined the guild.",
      "Bob has left the guild.",
      "Aldric is now the Guild Master of <Knights>.",
      "Mira has been removed from the guild by Bob.",
      "Bob is now Officer.",
      "You found the guild <Knights>! You are its Guild Master.",
      "You have left <Knights>.",
      "Mira has entered World of ClaudeCraft.",
      "Bob has left the world. (disconnected)",
      "Who: 3 players online on Stormforge.",
      "Who: 1 player online on Stormforge.",
      "Carl - level 12 warrior - Eastbrook Vale",
    ];
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      for (const m of logMessages) {
        const out = localizeServerText(m);
        expect(out, `${lang}: "${m}" should be recognized`).not.toBeNull();
        if (lang !== "en" && lang !== "en_CA") expect(out, `${lang}: "${m}" should not stay English`).not.toBe(m);
      }
    }
    setLanguage("en");
  });
});

// --- L3 / L4: extra server-message coverage ---
describe("L3/L4: additional server-message coverage", () => {
  it("localizes the ignore-list-loading error in every locale", () => {
    const msg = "Your ignore list is still loading. Try /who again in a moment.";
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      const out = localizeServerText(msg);
      expect(out, `${lang}`).not.toBeNull();
      if (lang !== "en" && lang !== "en_CA") expect(out, `${lang}`).not.toBe(msg);
    }
    setLanguage("en");
  });

  it("localizes the (combat) /who status flag", () => {
    setLanguage("es");
    const out = localizeServerText("Carl - level 12 warrior - Eastbrook Vale (combat)")!;
    expect(out).toContain("Carl");
    expect(out.toLowerCase()).not.toContain("(combat)");
    setLanguage("en");
  });
});

// --- H1: talent names never fall to raw word-substitution ---
describe("H1: every talent name resolves via override or ability name", () => {
  const abilityNames = new Set(Object.values(ABILITIES).map((a) => a.name));
  const nameEntries = talentTranslationManifest().filter((e) => e.field === "name");

  it("each talent name has an explicit override or is an ability name in every translated locale", () => {
    for (const lang of supportedLanguages) {
      if (lang === "en" || lang === "en_CA") continue;
      for (const e of nameEntries) {
        const ok = hasTalentTitleOverride(lang, e.source) || abilityNames.has(e.source);
        expect(ok, `${lang}: talent name "${e.source}" falls through to broken word-substitution`).toBe(true);
      }
    }
  });

  it("CJK talent names contain no leftover Latin words", () => {
    for (const lang of ["zh_CN", "zh_TW", "ja_JP", "ko_KR"] as const) {
      setLanguage(lang);
      for (const e of nameEntries) {
        const rendered = renderTalentManifestEntry(e);
        expect(/[A-Za-z]{2,}/.test(rendered), `${lang}: "${e.source}" -> "${rendered}" has leftover English`).toBe(false);
      }
    }
    setLanguage("en");
  });
});

// --- H2: game.* keeps required diacritics ---
describe("H2: game.* values keep required diacritics", () => {
  const stripped: Record<string, RegExp> = {
    es: /\b(Clasificacion|posicion|Campeon|Mitico|Especializacion|Maestria|Configuracion|Dano|cosmetica|maximo|proximamente|actualizacion|arbol|arboles|Aun)\b/,
    es_ES: /\b(Clasificacion|posicion|Campeon|Mitico|Especializacion|Maestria|Configuracion|Dano|cosmetica|maximo|proximamente|actualizacion|arbol|arboles|Aun)\b/,
    fr_FR: /\b(debloque|Reessayez|Eternel|Specialisation|Depenses|sauvegardee)\b/,
    fr_CA: /\b(debloque|Reessayez|Eternel|Specialisation|Depenses|sauvegardee)\b/,
    pt_BR: /\b(Posicao|Classificacao|Especializacao|Nivel|Voce|Funcao|nao)\b/,
    de_DE: /(naechsten|erhoeht|zurueck|Ueberschuss|Verfuegbar)/,
    // Italian: each listed form REQUIRES a final/internal accent in correct Italian
    // and has NO unaccented homograph, so a match means the diacritic was stripped.
    // (Deliberately excludes ambiguous forms like "abilita"/"necessita", which are
    // also valid unaccented 3rd-person verbs — "abilita il PvP" = "enables PvP".)
    it_IT: /\b(perche|piu|gia|citta|qualita|velocita|liberta|cosi|puo|universita|attivita|possibilita)\b/,
  };
  it("no accent-stripped forms remain in the game.* subtree", () => {
    for (const [lang, re] of Object.entries(stripped)) {
      const flat = JSON.stringify(locales[lang].game);
      const m = flat.match(re);
      expect(m, `${lang}: stripped form "${m?.[0]}" still present`).toBeNull();
    }
  });
});

// --- M1: quest narratives preserve {playerName} ---
describe("M1: quest narratives preserve {playerName}", () => {
  it("every locale keeps {playerName} wherever English uses it", () => {
    const enQuests = en.entities.quests as Record<string, any>;
    for (const lang of supportedLanguages) {
      const locQuests = locales[lang].entities.quests as Record<string, any>;
      for (const qid of Object.keys(enQuests)) {
        for (const field of ["text", "completion"] as const) {
          const ev = enQuests[qid]?.[field];
          if (typeof ev === "string" && ev.includes("{playerName}")) {
            const lv = locQuests[qid]?.[field];
            expect(typeof lv === "string" && lv.includes("{playerName}"), `${lang}.${qid}.${field} dropped {playerName}`).toBe(true);
          }
        }
      }
    }
  });
});

// --- H3: server_i18n + admin DICT completeness (the Record<string,string> dicts lack : typeof en) ---
describe("H3: DICT key parity, non-empty values, placeholder integrity", () => {
  function checkDict(dict: Record<string, Record<string, string>>, label: string) {
    const enKeys = Object.keys(dict.en);
    // Every supported locale must be PRESENT in the DICT (iterating Object.keys(dict)
    // alone would silently pass a DICT that is simply missing a locale).
    for (const lang of supportedLanguages) {
      expect(Object.prototype.hasOwnProperty.call(dict, lang), `${label} missing locale ${lang}`).toBe(true);
    }
    for (const lang of Object.keys(dict)) {
      expect(Object.keys(dict[lang]).length, `${label} ${lang} key count`).toBe(enKeys.length);
      for (const k of enKeys) {
        const v = dict[lang][k];
        expect(typeof v === "string" && v.trim().length > 0, `${label} ${lang}.${k} empty/missing`).toBe(true);
        expect(ph(v), `${label} ${lang}.${k} placeholders`).toBe(ph(dict.en[k]));
      }
    }
  }
  it("server_i18n DICT is complete across all locales", () => checkDict(serverDICT as any, "server"));
  it("admin DICT is complete across all locales", () => checkDict(adminDICT as any, "admin"));

  it("L7: no admin DICT value contains raw HTML markup", () => {
    for (const lang of Object.keys(adminDICT)) {
      for (const [k, v] of Object.entries((adminDICT as any)[lang])) {
        expect(/[<>]/.test(v as string), `admin ${lang}.${k} contains < or >`).toBe(false);
      }
    }
  });

  // H3b: copied-English guard — checkDict above never compares a value to English,
  // so untranslated/copied English would pass. This catches NEW copied-English while
  // allowing a fixed set of legitimate cognates / brand / borrowed terms / format strings.
  const COPIED_ALLOW = new Set<string>([
    // server: French "combat" is a real word; "online" is the borrowed term in it/de/pt.
    "server::fr_FR::who.statusCombat", "server::fr_CA::who.statusCombat",
    "server::it_IT::who.statusOnline", "server::de_DE::who.statusOnline", "server::pt_BR::who.statusOnline",
    // admin: brand title, "{count} h" format, and accepted cognates/borrowings.
    "admin::es::detail.lengthHours", "admin::es_ES::detail.lengthHours",
    "admin::fr_FR::app.title", "admin::fr_FR::online.colSession", "admin::fr_FR::detail.colActions",
    "admin::fr_FR::report.colMessage", "admin::fr_FR::dialog.action", "admin::fr_FR::detail.lengthHours",
    "admin::fr_CA::online.colSession", "admin::fr_CA::detail.colActions", "admin::fr_CA::report.colMessage",
    "admin::fr_CA::dialog.action", "admin::fr_CA::detail.lengthHours",
    "admin::it_IT::app.title", "admin::it_IT::auth.password", "admin::it_IT::stats.uptime",
    "admin::it_IT::characters.colAccount", "admin::it_IT::moderation.colAccount", "admin::it_IT::moderation.badgeOnline",
    "admin::it_IT::reason.cheating", "admin::it_IT::dialog.account", "admin::it_IT::detail.accountNum",
    "admin::it_IT::detail.lengthHours",
    "admin::de_DE::app.title", "admin::de_DE::nav.moderation", "admin::de_DE::detail.status",
    "admin::de_DE::moderation.title", "admin::de_DE::moderation.colStatus", "admin::de_DE::moderation.badgeOnline",
    "admin::de_DE::detail.lengthHours",
    "admin::pt_BR::app.title", "admin::pt_BR::detail.status", "admin::pt_BR::moderation.colStatus",
    "admin::pt_BR::moderation.badgeOnline", "admin::pt_BR::detail.lengthHours",
  ]);
  function checkNoCopiedEnglish(dict: Record<string, Record<string, string>>, label: string) {
    const en = dict.en;
    for (const lang of Object.keys(dict)) {
      if (lang === "en" || lang === "en_CA") continue;
      for (const k of Object.keys(en)) {
        const v = dict[lang][k];
        if (v !== en[k]) continue;
        const letters = (v.match(/[A-Za-z]/g) || []).length;
        const onlyPh = v.replace(/\{[^}]*\}/g, "").replace(/[^A-Za-z]/g, "").length === 0;
        if (letters < 4 || onlyPh || (!/\s/.test(v.trim()) && letters < 6)) continue;
        const id = `${label}::${lang}::${k}`;
        expect(COPIED_ALLOW.has(id), `${id} copies English ("${v}") and is not allowlisted — translate it or allowlist if a genuine cognate`).toBe(true);
      }
    }
  }
  it("H3b: server DICT has no un-allowlisted copied-English", () => checkNoCopiedEnglish(serverDICT as any, "server"));
  it("H3b: admin DICT has no un-allowlisted copied-English", () => checkNoCopiedEnglish(adminDICT as any, "admin"));
});

// --- H1b: no two talents in the same class tree may render with the same name ---
describe("H1b: talent names are unique within a class tree", () => {
  const nameEntries = talentTranslationManifest().filter((e) => e.field === "name");
  it("has zero same-tree name collisions in any translated locale", () => {
    for (const lang of supportedLanguages) {
      if (lang === "en" || lang === "en_CA") continue;
      setLanguage(lang);
      const perClass = new Map<string, Map<string, Set<string>>>();
      for (const e of nameEntries) {
        const rendered = renderTalentManifestEntry(e);
        const cls = (e as any).classId as string;
        if (!perClass.has(cls)) perClass.set(cls, new Map());
        const m = perClass.get(cls)!;
        if (!m.has(rendered)) m.set(rendered, new Set());
        m.get(rendered)!.add(e.source);
      }
      for (const [cls, m] of perClass) {
        for (const [rendered, sources] of m) {
          expect(sources.size, `${lang} ${cls}: "${rendered}" used by [${[...sources].join(", ")}]`).toBe(1);
        }
      }
    }
    setLanguage("en");
  });
});

// --- M1b: /who status flags localize at the FRAGMENT level (not just whole-string) ---
describe("M1b: /who status flags localize within the row", () => {
  const statuses: [string, string][] = [
    ["combat", "who.statusCombat"], ["dead", "who.statusDead"], ["dungeon", "who.statusDungeon"], ["afk", "who.statusAfk"],
  ];
  it("localizes combat/dead/dungeon/afk inside the /who row in every locale", () => {
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      for (const [flag, key] of statuses) {
        const out = localizeServerText(`Carl - level 12 warrior - Eastbrook Vale (${flag})`);
        expect(out, `${lang}: "(${flag})" row not recognized`).not.toBeNull();
        const localized = tServer(key);
        expect(out!.includes(`(${localized})`), `${lang}: ${flag} -> expected "(${localized})" in "${out}"`).toBe(true);
        if (localized !== flag) {
          expect(out!.includes(`(${flag})`), `${lang}: English "(${flag})" leaked in "${out}"`).toBe(false);
        }
      }
    }
    setLanguage("en");
  });
});

// --- M1c: entity quest + NPC greeting strings keep their FULL placeholder set ---
describe("M1c: entity strings preserve every placeholder (incl {className})", () => {
  const phSet = (s: string) => new Set([...String(s).matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]));
  function checkFields(enRoot: Record<string, any>, getLoc: (lang: string) => Record<string, any>, kind: string, fields: string[]) {
    for (const lang of supportedLanguages) {
      const loc = getLoc(lang);
      for (const id of Object.keys(enRoot)) {
        for (const field of fields) {
          const ev = enRoot[id]?.[field];
          if (typeof ev !== "string") continue;
          const enPh = phSet(ev);
          if (enPh.size === 0) continue;
          const lv = loc[id]?.[field];
          const lvPh = phSet(typeof lv === "string" ? lv : "");
          for (const p of enPh) {
            expect(lvPh.has(p), `${lang} ${kind}.${id}.${field} dropped {${p}} (has [${[...lvPh].join(",")}])`).toBe(true);
          }
        }
      }
    }
  }
  it("quests keep text/completion placeholders", () => {
    checkFields(en.entities.quests as any, (l) => locales[l].entities.quests as any, "quest", ["text", "completion"]);
  });
  it("NPC greetings keep {className}/{playerName}", () => {
    checkFields(en.entities.npcs as any, (l) => locales[l].entities.npcs as any, "npc", ["greeting"]);
  });
});

// --- H4b: every shipped talent name resolves via override or ability, and renders
// non-empty & (for non-en) differs from English unless a deliberate cognate override. ---
describe("H4b: talent-name resolution is complete (no silent English fallthrough)", () => {
  const abilityNames = new Set(Object.values(ABILITIES).map((a) => a.name));
  const nameEntries = talentTranslationManifest().filter((e) => e.field === "name");
  it("renders non-empty for every name in every locale and never word-salads a new name", () => {
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      for (const e of nameEntries) {
        const rendered = renderTalentManifestEntry(e);
        expect(rendered.trim().length, `${lang}: "${e.source}" rendered empty`).toBeGreaterThan(0);
        if (lang !== "en" && lang !== "en_CA") {
          // must resolve via an explicit override or be an ability name (which tEntity localizes)
          const resolved = hasTalentTitleOverride(lang, e.source) || abilityNames.has(e.source);
          expect(resolved, `${lang}: "${e.source}" has no override and is not an ability name (would fall through to raw English)`).toBe(true);
        }
      }
    }
    setLanguage("en");
  });
});
