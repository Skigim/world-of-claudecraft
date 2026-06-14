import { DUNGEONS, MOBS, NPCS, QUESTS, ZONES } from '../sim/data';

const MOB_IDS = [
  'forest_wolf', 'old_greyjaw', 'wild_boar', 'webwood_spider', 'mudfin_murloc', 'tunnel_rat',
  'vale_bandit', 'restless_bones', 'gorrak', 'mire_prowler', 'deepfen_murloc', 'mire_widow',
  'mirefen_broodmother', 'drowned_dead', 'fen_troll', 'grubjaw', 'gravecaller_cultist',
  'gravecaller_summoner', 'deacon_voss', 'ridge_stalker', 'deeprock_kobold', 'thornpeak_ogre',
  'ogre_crusher', 'warlord_drogmar', 'stormcrag_elemental', 'shardlord_kazzix',
  'wyrmcult_zealot', 'wyrmcult_necromancer', 'boneclad_revenant', 'crypt_shambler',
  'hollow_acolyte', 'bonechill_widow', 'sexton_marrow', 'morthen', 'bastion_revenant',
  'tidebound_acolyte', 'drowned_thrall', 'knight_commander_olen', 'vael_the_mistcaller',
  'sanctum_boneguard', 'sanctum_drakonid', 'raised_bonewalker', 'korgath_the_bound',
  'grand_necromancer_velkhar', 'korzul_the_gravewyrm',
] as const;

const NPC_IDS = [
  'the_merchant', 'marshal_redbrook', 'trader_wilkes', 'apothecary_lin', 'brother_aldric',
  'smith_haldren', 'fisherman_brandt', 'foreman_odell', 'warden_fenwick', 'brother_aldric_fen',
  'provisioner_hale', 'herbalist_yara', 'scout_maren', 'captain_thessaly',
  'brother_aldric_highwatch', 'scout_maren_highwatch', 'quartermaster_bree', 'armorer_hode',
  'loremaster_caddis',
] as const;

const QUEST_IDS = [
  'q_wolves', 'q_greyjaw', 'q_boars', 'q_spiders', 'q_murlocs', 'q_mine', 'q_bones',
  'q_supplies', 'q_whispers', 'q_names_of_the_dead', 'q_silence_the_call', 'q_rite',
  'q_hollow', 'q_sexton', 'q_gravecallers_trail', 'q_bandits', 'q_ringleader',
  'q_fenbridge_muster', 'q_prowlers', 'q_prowler_pelts', 'q_fen_supplies', 'q_deepfen',
  'q_idols', 'q_deepfen_purge', 'q_widows', 'q_broodmother', 'q_drowned',
  'q_drowned_censers', 'q_no_rest', 'q_trolls', 'q_troll_fetishes', 'q_grubjaw',
  'q_cult_camp', 'q_summoners', 'q_deacon', 'q_bastion_door', 'q_olen', 'q_mistcaller',
  'q_highwatch_summons', 'q_stalkers', 'q_stalker_pelts', 'q_kobold_tunnels',
  'q_glowing_wax', 'q_ogre_edges', 'q_ogre_totems', 'q_ogre_bounty', 'q_crushers',
  'q_drogmar', 'q_elementals', 'q_shard_cores', 'q_kazzix', 'q_zealots', 'q_cult_orders',
  'q_necromancers', 'q_revenants', 'q_revenant_vanguard', 'q_wyrm_sigils',
  'q_breaking_the_seal', 'q_voice_below', 'q_sanctum_gate', 'q_korgath', 'q_velkhar',
  'q_gravewyrm',
] as const;

const ZONE_IDS = ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'] as const;
const DUNGEON_IDS = ['hollow_crypt', 'sunken_bastion', 'gravewyrm_sanctum'] as const;

const OBJECTIVE_ITEM_IDS = [
  'greyjaw_fang', 'boar_hide', 'webwood_silk', 'supply_crate', 'gravecaller_sigil',
  'weathered_ledger_page', 'blessed_wax', 'ghostly_essence', 'morthen_grimoire',
  'fen_muster_order', 'mire_prowler_pelt', 'lost_caravan_goods', 'waterlogged_idol',
  'widow_venom_sac', 'rusted_censer', 'troll_fetish', 'grubjaw_tusk', 'cult_cipher',
  'bastion_ward_stone', 'highwatch_summons', 'ridge_stalker_pelt', 'glowing_wax',
  'ogre_war_totem', 'storm_core', 'kazzix_heartshard', 'wyrmcult_orders',
  'ritual_phylactery', 'gravewyrm_sigil', 'blessed_embers', 'sanctum_key_shard',
] as const;

type MobId = typeof MOB_IDS[number];
type NpcId = typeof NPC_IDS[number];
type QuestId = typeof QUEST_IDS[number];
type ZoneId = typeof ZONE_IDS[number];
type DungeonId = typeof DUNGEON_IDS[number];
type ObjectiveItemId = typeof OBJECTIVE_ITEM_IDS[number];

type MobTranslations = Record<MobId, { name: string }>;
type NpcTranslations = Record<NpcId, { name: string; title: string; greeting: string }>;
type QuestTranslation = { title: string; text: string; completion: string; objectives: Record<number, { label: string }> };
type QuestTranslations = Record<QuestId, QuestTranslation>;
type ZoneTranslations = Record<ZoneId, { name: string; welcome: string; pois: Record<number, { label: string }> }>;
type DungeonTranslations = Record<DungeonId, { name: string; enterText: string; leaveText: string }>;
type ObjectiveItemTranslations = Record<ObjectiveItemId, string>;

type Phase9Translations = {
  worldContent: {
    corpseName: string;
    dungeonExitName: string;
    dungeonPartyWarning: string;
    dungeonInstanceBusy: string;
  };
  entities: {
    mobs: MobTranslations;
    npcs: NpcTranslations;
    quests: QuestTranslations;
    zones: ZoneTranslations;
    dungeons: DungeonTranslations;
  };
};

type ObjectiveSpec =
  | { kind: 'kill'; mobId: MobId; mode?: 'slain' | 'rest' | 'silenced' }
  | { kind: 'collect'; itemId: ObjectiveItemId };

type LocaleText = {
  corpseName: string;
  dungeonExitName: string;
  dungeonPartyWarning: string;
  dungeonInstanceBusy: string;
  questText(title: string, objectives: string): string;
  questCompletion(title: string): string;
  kill(mob: string): string;
  rest(mob: string): string;
  silenced(mob: string): string;
  list(items: readonly string[]): string;
};

type LocaleData = {
  mobs: readonly string[];
  npcRows: readonly (readonly [string, string, string])[];
  questTitles: readonly string[];
  objectiveItems: readonly string[];
  zones: readonly (readonly [string, string, readonly string[]])[];
  dungeons: readonly (readonly [string, string, string])[];
};

const OBJECTIVE_SPECS: readonly (readonly ObjectiveSpec[])[] = [
  [{ kind: 'kill', mobId: 'forest_wolf' }],
  [{ kind: 'collect', itemId: 'greyjaw_fang' }],
  [{ kind: 'collect', itemId: 'boar_hide' }],
  [{ kind: 'kill', mobId: 'webwood_spider' }, { kind: 'collect', itemId: 'webwood_silk' }],
  [{ kind: 'kill', mobId: 'mudfin_murloc' }],
  [{ kind: 'kill', mobId: 'tunnel_rat' }],
  [{ kind: 'kill', mobId: 'restless_bones', mode: 'rest' }],
  [{ kind: 'collect', itemId: 'supply_crate' }],
  [{ kind: 'collect', itemId: 'gravecaller_sigil' }],
  [{ kind: 'collect', itemId: 'weathered_ledger_page' }],
  [{ kind: 'kill', mobId: 'restless_bones', mode: 'silenced' }],
  [{ kind: 'collect', itemId: 'blessed_wax' }, { kind: 'collect', itemId: 'ghostly_essence' }],
  [{ kind: 'kill', mobId: 'morthen' }],
  [{ kind: 'kill', mobId: 'sexton_marrow', mode: 'rest' }],
  [{ kind: 'collect', itemId: 'morthen_grimoire' }],
  [{ kind: 'kill', mobId: 'vale_bandit' }],
  [{ kind: 'kill', mobId: 'gorrak' }],
  [{ kind: 'collect', itemId: 'fen_muster_order' }],
  [{ kind: 'kill', mobId: 'mire_prowler' }],
  [{ kind: 'collect', itemId: 'mire_prowler_pelt' }],
  [{ kind: 'collect', itemId: 'lost_caravan_goods' }],
  [{ kind: 'kill', mobId: 'deepfen_murloc' }],
  [{ kind: 'collect', itemId: 'waterlogged_idol' }],
  [{ kind: 'kill', mobId: 'deepfen_murloc' }],
  [{ kind: 'kill', mobId: 'mire_widow' }, { kind: 'collect', itemId: 'widow_venom_sac' }],
  [{ kind: 'kill', mobId: 'mire_widow' }, { kind: 'kill', mobId: 'mirefen_broodmother' }],
  [{ kind: 'kill', mobId: 'drowned_dead', mode: 'rest' }],
  [{ kind: 'collect', itemId: 'rusted_censer' }],
  [{ kind: 'kill', mobId: 'drowned_dead', mode: 'rest' }],
  [{ kind: 'kill', mobId: 'fen_troll' }],
  [{ kind: 'collect', itemId: 'troll_fetish' }],
  [{ kind: 'collect', itemId: 'grubjaw_tusk' }],
  [{ kind: 'kill', mobId: 'gravecaller_cultist' }],
  [{ kind: 'kill', mobId: 'gravecaller_summoner' }, { kind: 'collect', itemId: 'cult_cipher' }],
  [{ kind: 'kill', mobId: 'deacon_voss' }],
  [{ kind: 'collect', itemId: 'bastion_ward_stone' }],
  [{ kind: 'kill', mobId: 'knight_commander_olen', mode: 'rest' }],
  [{ kind: 'kill', mobId: 'vael_the_mistcaller' }],
  [{ kind: 'collect', itemId: 'highwatch_summons' }],
  [{ kind: 'kill', mobId: 'ridge_stalker' }],
  [{ kind: 'collect', itemId: 'ridge_stalker_pelt' }],
  [{ kind: 'kill', mobId: 'deeprock_kobold' }],
  [{ kind: 'collect', itemId: 'glowing_wax' }],
  [{ kind: 'kill', mobId: 'thornpeak_ogre' }],
  [{ kind: 'collect', itemId: 'ogre_war_totem' }],
  [{ kind: 'kill', mobId: 'thornpeak_ogre' }],
  [{ kind: 'kill', mobId: 'ogre_crusher' }],
  [{ kind: 'kill', mobId: 'warlord_drogmar' }],
  [{ kind: 'kill', mobId: 'stormcrag_elemental' }],
  [{ kind: 'collect', itemId: 'storm_core' }],
  [{ kind: 'collect', itemId: 'kazzix_heartshard' }],
  [{ kind: 'kill', mobId: 'wyrmcult_zealot' }],
  [{ kind: 'kill', mobId: 'wyrmcult_zealot' }, { kind: 'collect', itemId: 'wyrmcult_orders' }],
  [{ kind: 'kill', mobId: 'wyrmcult_necromancer' }, { kind: 'collect', itemId: 'ritual_phylactery' }],
  [{ kind: 'kill', mobId: 'boneclad_revenant' }],
  [{ kind: 'kill', mobId: 'boneclad_revenant' }],
  [{ kind: 'collect', itemId: 'gravewyrm_sigil' }],
  [{ kind: 'collect', itemId: 'blessed_embers' }],
  [{ kind: 'kill', mobId: 'wyrmcult_zealot' }, { kind: 'kill', mobId: 'wyrmcult_necromancer' }],
  [{ kind: 'collect', itemId: 'sanctum_key_shard' }],
  [{ kind: 'kill', mobId: 'korgath_the_bound' }],
  [{ kind: 'kill', mobId: 'grand_necromancer_velkhar' }],
  [{ kind: 'kill', mobId: 'korzul_the_gravewyrm' }],
];

function normalizeSourceText(text: string): string {
  return text.replace(/\$N/g, '{playerName}').replace(/\$C/g, '{className}').replace(/\u2014/g, '-');
}

function orderedValues<T>(ids: readonly string[], source: Record<string, T>): T[] {
  return ids.map((id) => {
    const value = source[id];
    if (!value) throw new Error(`Missing Phase 9 source entry for ${id}`);
    return value;
  });
}

function stringsToRecord<TId extends string>(ids: readonly TId[], values: readonly string[], label: string): Record<TId, string> {
  if (values.length !== ids.length) {
    throw new Error(`${label} count mismatch: expected ${ids.length}, got ${values.length}`);
  }
  const record = {} as Record<TId, string>;
  ids.forEach((id, index) => {
    const value = values[index];
    if (!value) throw new Error(`Missing ${label} translation for ${id}`);
    record[id] = value;
  });
  return record;
}

function makeMobTranslations(values: readonly string[]): MobTranslations {
  const names = stringsToRecord(MOB_IDS, values, 'mob');
  const mobs = {} as MobTranslations;
  MOB_IDS.forEach((id) => { mobs[id] = { name: names[id] }; });
  return mobs;
}

function makeNpcTranslations(rows: readonly (readonly [string, string, string])[]): NpcTranslations {
  if (rows.length !== NPC_IDS.length) throw new Error(`NPC translation count mismatch: expected ${NPC_IDS.length}, got ${rows.length}`);
  const npcs = {} as NpcTranslations;
  NPC_IDS.forEach((id, index) => {
    const [name, title, greeting] = rows[index];
    if (!name || !title || !greeting) throw new Error(`Missing NPC translation for ${id}`);
    npcs[id] = { name, title, greeting };
  });
  return npcs;
}

function makeObjectiveItems(values: readonly string[]): ObjectiveItemTranslations {
  return stringsToRecord(OBJECTIVE_ITEM_IDS, values, 'quest objective item');
}

function objectiveLabel(spec: ObjectiveSpec, mobs: MobTranslations, items: ObjectiveItemTranslations, text: LocaleText): string {
  if (spec.kind === 'collect') return items[spec.itemId];
  const mobName = mobs[spec.mobId].name;
  if (spec.mode === 'rest') return text.rest(mobName);
  if (spec.mode === 'silenced') return text.silenced(mobName);
  return text.kill(mobName);
}

function makeQuestTranslations(
  titles: readonly string[],
  mobs: MobTranslations,
  itemNames: ObjectiveItemTranslations,
  text: LocaleText,
): QuestTranslations {
  if (titles.length !== QUEST_IDS.length) throw new Error(`Quest title count mismatch: expected ${QUEST_IDS.length}, got ${titles.length}`);
  if (OBJECTIVE_SPECS.length !== QUEST_IDS.length) throw new Error('Quest objective spec count mismatch');
  const quests = {} as QuestTranslations;
  QUEST_IDS.forEach((id, index) => {
    const title = titles[index];
    const objectives = OBJECTIVE_SPECS[index].map((spec) => objectiveLabel(spec, mobs, itemNames, text));
    const objectiveRecord = {} as Record<number, { label: string }>;
    objectives.forEach((label, objectiveIndex) => { objectiveRecord[objectiveIndex] = { label }; });
    quests[id] = {
      title,
      text: text.questText(title, text.list(objectives)),
      completion: text.questCompletion(title),
      objectives: objectiveRecord,
    };
  });
  return quests;
}

function makeZoneTranslations(rows: readonly (readonly [string, string, readonly string[]])[]): ZoneTranslations {
  if (rows.length !== ZONE_IDS.length) throw new Error(`Zone translation count mismatch: expected ${ZONE_IDS.length}, got ${rows.length}`);
  const zones = {} as ZoneTranslations;
  ZONE_IDS.forEach((id, index) => {
    const [name, welcome, pois] = rows[index];
    const sourcePois = ZONES[index].pois;
    if (pois.length !== sourcePois.length) {
      throw new Error(`POI translation count mismatch for ${id}: expected ${sourcePois.length}, got ${pois.length}`);
    }
    const poiRecord = {} as Record<number, { label: string }>;
    pois.forEach((label, poiIndex) => { poiRecord[poiIndex] = { label }; });
    zones[id] = { name, welcome, pois: poiRecord };
  });
  return zones;
}

function makeDungeonTranslations(rows: readonly (readonly [string, string, string])[]): DungeonTranslations {
  if (rows.length !== DUNGEON_IDS.length) throw new Error(`Dungeon translation count mismatch: expected ${DUNGEON_IDS.length}, got ${rows.length}`);
  const dungeons = {} as DungeonTranslations;
  DUNGEON_IDS.forEach((id, index) => {
    const [name, enterText, leaveText] = rows[index];
    dungeons[id] = { name, enterText, leaveText };
  });
  return dungeons;
}

function makeEnglishPhase9(): Phase9Translations {
  const mobs = {} as MobTranslations;
  orderedValues(MOB_IDS, MOBS).forEach((mob) => { mobs[mob.id as MobId] = { name: mob.name }; });

  const npcs = {} as NpcTranslations;
  orderedValues(NPC_IDS, NPCS).forEach((npc) => {
    npcs[npc.id as NpcId] = {
      name: npc.name,
      title: npc.title,
      greeting: normalizeSourceText(npc.greeting),
    };
  });

  const quests = {} as QuestTranslations;
  orderedValues(QUEST_IDS, QUESTS).forEach((quest) => {
    const objectiveRecord = {} as Record<number, { label: string }>;
    quest.objectives.forEach((objective, objectiveIndex) => {
      objectiveRecord[objectiveIndex] = { label: objective.label };
    });
    quests[quest.id as QuestId] = {
      title: quest.name,
      text: normalizeSourceText(quest.text),
      completion: normalizeSourceText(quest.completionText),
      objectives: objectiveRecord,
    };
  });

  const zones = {} as ZoneTranslations;
  ZONES.forEach((zone) => {
    const poiRecord = {} as Record<number, { label: string }>;
    zone.pois.forEach((poi, index) => { poiRecord[index] = { label: poi.label }; });
    zones[zone.id as ZoneId] = {
      name: zone.name,
      welcome: normalizeSourceText(zone.welcome),
      pois: poiRecord,
    };
  });

  const dungeons = {} as DungeonTranslations;
  orderedValues(DUNGEON_IDS, DUNGEONS).forEach((dungeon) => {
    dungeons[dungeon.id as DungeonId] = {
      name: dungeon.name,
      enterText: normalizeSourceText(dungeon.enterText),
      leaveText: normalizeSourceText(dungeon.leaveText),
    };
  });

  return {
    worldContent: {
      corpseName: '{name} (corpse)',
      dungeonExitName: '{name} Exit',
      dungeonPartyWarning: '{name} is meant for a full party of {count}. Tread carefully.',
      dungeonInstanceBusy: 'All instances of {name} are busy. Try again soon.',
    },
    entities: { mobs, npcs, quests, zones, dungeons },
  };
}

function makeLocalePhase9(data: LocaleData, text: LocaleText): Phase9Translations {
  const mobs = makeMobTranslations(data.mobs);
  const npcs = makeNpcTranslations(data.npcRows);
  const objectiveItems = makeObjectiveItems(data.objectiveItems);
  return {
    worldContent: {
      corpseName: text.corpseName,
      dungeonExitName: text.dungeonExitName,
      dungeonPartyWarning: text.dungeonPartyWarning,
      dungeonInstanceBusy: text.dungeonInstanceBusy,
    },
    entities: {
      mobs,
      npcs,
      quests: makeQuestTranslations(data.questTitles, mobs, objectiveItems, text),
      zones: makeZoneTranslations(data.zones),
      dungeons: makeDungeonTranslations(data.dungeons),
    },
  };
}

const esText: LocaleText = {
  corpseName: '{name} (cadáver)',
  dungeonExitName: 'Salida de {name}',
  dungeonPartyWarning: '{name} está pensado para un grupo completo de {count}. Avanza con cuidado.',
  dungeonInstanceBusy: 'Todas las instancias de {name} están ocupadas. Inténtalo de nuevo pronto.',
  questText: (title, objectives) => `Para "${title}", completa estos objetivos: ${objectives}.`,
  questCompletion: (title) => `Has completado "${title}". Tu ayuda cambia el destino de esta región.`,
  kill: (mob) => `${mob} abatido`,
  rest: (mob) => `${mob} devuelto al descanso`,
  silenced: (mob) => `${mob} silenciado`,
  list: (items) => items.join(', '),
};

const frText: LocaleText = {
  corpseName: '{name} (cadavre)',
  dungeonExitName: 'Sortie de {name}',
  dungeonPartyWarning: '{name} est prévu pour un groupe complet de {count}. Avancez prudemment.',
  dungeonInstanceBusy: 'Toutes les instances de {name} sont occupées. Réessayez bientôt.',
  questText: (title, objectives) => `Pour "${title}", accomplissez ces objectifs: ${objectives}.`,
  questCompletion: (title) => `"${title}" est terminé. Votre aide compte pour toute la région.`,
  kill: (mob) => `${mob} tué`,
  rest: (mob) => `${mob} rendu au repos`,
  silenced: (mob) => `${mob} réduit au silence`,
  list: (items) => items.join(', '),
};

const itText: LocaleText = {
  corpseName: '{name} (cadavere)',
  dungeonExitName: 'Uscita da {name}',
  dungeonPartyWarning: '{name} è pensato per un gruppo completo di {count}. Procedi con cautela.',
  dungeonInstanceBusy: 'Tutte le istanze di {name} sono occupate. Riprova tra poco.',
  questText: (title, objectives) => `Per "${title}", completa questi obiettivi: ${objectives}.`,
  questCompletion: (title) => `"${title}" è completata. La regione ricorderà il tuo aiuto.`,
  kill: (mob) => `${mob} ucciso`,
  rest: (mob) => `${mob} restituito al riposo`,
  silenced: (mob) => `${mob} messo a tacere`,
  list: (items) => items.join(', '),
};

const deText: LocaleText = {
  corpseName: '{name} (Leichnam)',
  dungeonExitName: 'Ausgang von {name}',
  dungeonPartyWarning: '{name} ist für eine vollständige Gruppe von {count} gedacht. Geh vorsichtig vor.',
  dungeonInstanceBusy: 'Alle Instanzen von {name} sind belegt. Versuch es bald erneut.',
  questText: (title, objectives) => `Für "${title}" erfülle diese Ziele: ${objectives}.`,
  questCompletion: (title) => `"${title}" ist abgeschlossen. Deine Hilfe stärkt diese Region.`,
  kill: (mob) => `${mob} getötet`,
  rest: (mob) => `${mob} zur Ruhe gelegt`,
  silenced: (mob) => `${mob} zum Schweigen gebracht`,
  list: (items) => items.join(', '),
};

const zhCnText: LocaleText = {
  corpseName: '{name}（尸体）',
  dungeonExitName: '{name}出口',
  dungeonPartyWarning: '{name}适合{count}人完整队伍挑战。请谨慎前进。',
  dungeonInstanceBusy: '{name}的所有副本都已被占用。请稍后再试。',
  questText: (title, objectives) => `执行“${title}”：完成这些目标：${objectives}。`,
  questCompletion: (title) => `“${title}”已经完成。你的援手让这片地区得以喘息。`,
  kill: (mob) => `击败${mob}`,
  rest: (mob) => `让${mob}安息`,
  silenced: (mob) => `使${mob}沉寂`,
  list: (items) => items.join('、'),
};

const zhTwText: LocaleText = {
  corpseName: '{name}（屍體）',
  dungeonExitName: '{name}出口',
  dungeonPartyWarning: '{name}適合{count}人完整隊伍挑戰。請謹慎前進。',
  dungeonInstanceBusy: '{name}的所有副本都已被占用。請稍後再試。',
  questText: (title, objectives) => `執行「${title}」：完成這些目標：${objectives}。`,
  questCompletion: (title) => `「${title}」已完成。你的援手讓這片地區得以喘息。`,
  kill: (mob) => `擊敗${mob}`,
  rest: (mob) => `讓${mob}安息`,
  silenced: (mob) => `使${mob}沉寂`,
  list: (items) => items.join('、'),
};

const koText: LocaleText = {
  corpseName: '{name} (시체)',
  dungeonExitName: '{name} 출구',
  dungeonPartyWarning: '{name}은 {count}명의 완전한 파티를 위해 마련된 곳입니다. 조심해서 나아가십시오.',
  dungeonInstanceBusy: '{name}의 모든 인스턴스가 사용 중입니다. 잠시 후 다시 시도하십시오.',
  questText: (title, objectives) => `"${title}" 임무를 위해 다음 목표를 완료하십시오: ${objectives}.`,
  questCompletion: (title) => `"${title}" 임무를 완료했습니다. 이 지역에 큰 도움이 되었습니다.`,
  kill: (mob) => `${mob} 처치`,
  rest: (mob) => `${mob} 안식시킴`,
  silenced: (mob) => `${mob} 침묵시킴`,
  list: (items) => items.join(', '),
};

const jaText: LocaleText = {
  corpseName: '{name}（死体）',
  dungeonExitName: '{name}の出口',
  dungeonPartyWarning: '{name}は{count}人のフルパーティ向けです。慎重に進んでください。',
  dungeonInstanceBusy: '{name}のインスタンスはすべて使用中です。少し待ってから再試行してください。',
  questText: (title, objectives) => `「${title}」では次の目標を達成してください: ${objectives}。`,
  questCompletion: (title) => `「${title}」は完了しました。この地に大きな助けとなりました。`,
  kill: (mob) => `${mob}を討伐`,
  rest: (mob) => `${mob}を安息させる`,
  silenced: (mob) => `${mob}を沈黙させる`,
  list: (items) => items.join('、'),
};

const ptText: LocaleText = {
  corpseName: '{name} (cadáver)',
  dungeonExitName: 'Saída de {name}',
  dungeonPartyWarning: '{name} foi feito para um grupo completo de {count}. Avance com cuidado.',
  dungeonInstanceBusy: 'Todas as instâncias de {name} estão ocupadas. Tente novamente em breve.',
  questText: (title, objectives) => `Para "${title}", cumpra estes objetivos: ${objectives}.`,
  questCompletion: (title) => `"${title}" foi concluída. Sua ajuda fortalece esta região.`,
  kill: (mob) => `${mob} abatido`,
  rest: (mob) => `${mob} devolvido ao descanso`,
  silenced: (mob) => `${mob} silenciado`,
  list: (items) => items.join(', '),
};

const ruText: LocaleText = {
  corpseName: '{name} (труп)',
  dungeonExitName: 'Выход из {name}',
  dungeonPartyWarning: '{name} рассчитано на полную группу из {count} игроков. Продвигайтесь осторожно.',
  dungeonInstanceBusy: 'Все копии {name} заняты. Попробуйте еще раз чуть позже.',
  questText: (title, objectives) => `Для задания "${title}" выполните цели: ${objectives}.`,
  questCompletion: (title) => `Задание "${title}" выполнено. Ваша помощь укрепила этот край.`,
  kill: (mob) => `${mob}: убито`,
  rest: (mob) => `${mob}: упокоено`,
  silenced: (mob) => `${mob}: усмирено`,
  list: (items) => items.join(', '),
};

const esData: LocaleData = {
  mobs: [
    'Lobo del bosque', 'Viejo Greyjaw', 'Jabalí salvaje', 'Acechador de Webwood', 'Merodeador Aletabarro', 'Excavador Rata de Túnel',
    'Bandido del Valle', 'Huesos inquietos', 'Gorrak el Despiadado', 'Merodeador del lodazal', 'Chasqueador de Deepfen', 'Viuda de Mirefen',
    'La Madre de la nidada', 'Muerto ahogado', 'Trol de Mirefen', 'Grubjaw el Glotón', 'Cultista Gravecaller', 'Invocador Gravecaller',
    'Diácono Voss', 'Acechador de la cresta', 'Tunelador de Deep Rock', 'Ogro de Thornpeak', 'Triturador de Thornpeak', 'Señor de la guerra Drogmar',
    'Elemental de Stormcrag', 'Señor de fragmentos Kazzix', 'Fanático del Culto del Wyrm', 'Nigromante del Culto del Wyrm', 'Aparecido de hueso',
    'Tambaleante de la Cripta', 'Acólito del Hueco', 'Viuda Huesofrío', 'Sacristán Marrow', 'Morthen el Gravecaller', 'Aparecido del Bastión',
    'Acólito atado a la marea', 'Siervo ahogado', 'Caballero comandante Olen', 'Vael el Mistcaller', 'Guardahuesos del Santuario', 'Dracónido del Santuario',
    'Caminahuesos alzado', 'Korgath el Encadenado', 'Gran nigromante Velkhar', 'Korzul el Gravewyrm',
  ],
  npcRows: [
    ['El Mercader', 'Guardián del Mercado Mundial', 'Bienvenido al Mercado Mundial, {className}. Compra a aventureros de cada rincón del reino o vende tus propias mercancías.'],
    ['Mariscal Redbrook', 'Mariscal de la ciudad', 'Ten la hoja cerca, {className}. El Valle ya no es lo que era.'],
    ['Comerciante Wilkes', 'Proveedor', 'Pan fresco, agua limpia y precios justos. ¿Qué necesitas?'],
    ['Boticaria Lin', 'Herborista', 'Ten cuidado al pisar en los bosques orientales, amigo.'],
    ['Hermano Aldric', 'Sacerdote del Valle', 'Que la Luz te guarde. Ni siquiera los muertos descansan últimamente.'],
    ['Herrero Haldren', 'Armero y forjador', 'Cuidado con las chispas, {className}. El buen acero separa una cicatriz de una tumba.'],
    ['Pescador Brandt', 'Viejo lobo de agua', 'Grlmurlgrl... perdón, llevo demasiado tiempo oyendo a esos hombres pez.'],
    ['Capataz Odell', 'Capataz de la mina', '¡Toda la excavación está llena de esas alimañas con velas en la cabeza!'],
    ['Guardián Fenwick', 'Guardián de Fenbridge', 'Alto en la puerta, {className}. Más allá de los juncos, la ciénaga mata por nosotros.'],
    ['Hermano Aldric', 'Sacerdote del Valle', 'Que la Luz te mantenga sobre el agua, {playerName}. Los muertos de esta ciénaga no duermen: vadean.'],
    ['Proveedor Hale', 'Proveedor', 'Botas secas, pan seco y pólvora seca: en Fenbridge consigues dos de tres en un buen día.'],
    ['Herborista Yara', 'Herborista', 'Cuida el matorral al oeste del camino. Las telarañas están espesas como velamen.'],
    ['Exploradora Maren', 'Exploradora del mariscal', 'Pies silenciosos y una hoja corta te mantienen con vida. Habla rápido: debo volver a los juncos.'],
    ['Capitana Thessaly', 'Capitana de Highwatch', 'Doscientos años ha resistido este muro, {className}. No caerá bajo mi guardia, aunque gime.'],
    ['Hermano Aldric', 'Sacerdote del Valle', 'De un patio de capilla al techo del mundo... el rastro termina aquí. Siento que la montaña escucha.'],
    ['Exploradora Maren', 'Exploradora del mariscal', 'Seguí a los cultistas contigo por la ciénaga y el rastro llegó aquí. Las cumbres son peores, {className}. Mantente alerta.'],
    ['Intendente Bree', 'Intendente de Highwatch', 'Lana, galleta dura y botas herradas: Highwatch vive de las tres, y apenas tengo existencias.'],
    ['Armero Hode', 'Maestro armero', 'La forja está caliente y la piedra gira. Si corta, lo vendo.'],
    ['Maestro de saber Caddis', 'Maestro de saber', 'Cuida la pizarra suelta, {className}. La montaña está inquieta últimamente y quiero saber por qué.'],
  ],
  questTitles: [
    'Lobos a la puerta', 'El viejo lobo', 'Pieles de Bristleback', 'Amenaza de Webwood', 'Problemas en el lago', 'Ratas en la mina',
    'Los muertos inquietos', 'Suministros robados', 'Susurros bajo tierra', 'Los nombres de los muertos', 'Silenciar la llamada',
    'El rito vinculante', 'Dentro del Hueco', 'La campana del sacristán', 'El rastro del Gravecaller', 'Bandidos del Valle',
    'El cabecilla', 'Reunión en Fenbridge', 'Dientes de la ciénaga', 'Pieles para la calzada', 'La caravana perdida',
    'El Deepfen se agita', 'Ídolos de las profundidades', 'De vuelta a los bajíos', 'Seda y veneno', 'La Madre de la nidada',
    'Los muertos ahogados', 'Incensarios de las profundidades', 'Sin descanso entre los juncos', 'Túmulos de Mirefen',
    'Fetiche y hueso', 'El Glotón', 'Togas en los juncos', 'Detener la invocación', 'El diácono de la ciénaga',
    'El Bastión Sumergido', 'La vergüenza del caballero comandante', 'El Mistcaller', 'La guardia de las cumbres',
    'Acechadores en la cresta', 'El invierno llega a Highwatch', 'Problemas de Deeprock', 'Cera extraña', 'Ogros en las colinas',
    'Tótems de guerra', 'La recompensa de la capitana', 'Romper el campamento de guerra', 'Señor de la guerra Drogmar',
    'La montaña despierta', 'Núcleos de la tormenta', 'El señor de fragmentos', 'Cánticos en el viento', 'Órdenes de abajo',
    'El anillo de filacterias', 'Los campos de aparecidos', 'Huesos de la vanguardia', 'Sigilos del Wyrm', 'Romper el sello',
    'La voz de abajo', 'La puerta del Santuario', 'El guardián encadenado', 'El gran nigromante', 'Korzul el Gravewyrm',
  ],
  objectiveItems: [
    'Colmillo del viejo Greyjaw', 'Piel de jabalí erizada', 'Glándula de seda de Webwood', 'Caja de suministros robada',
    'Sigilo de Gravecaller', 'Página de registro desgastada', 'Sebo bendito', 'Esencia fantasmal', 'Grimorio de Morthen',
    'Orden de reunión de Fenbridge', 'Piel de merodeador del lodazal', 'Mercancías de la caravana perdida', 'Ídolo empapado',
    'Saco de veneno de viuda', 'Incensario oxidado', 'Fetiche trol de Mirefen', 'Colmillo de Grubjaw', 'Cifra Gravecaller',
    'Piedra guardiana del Bastión', 'Citación de Highwatch', 'Piel de acechador de la cresta', 'Cera resplandeciente',
    'Tótem de guerra ogro', 'Núcleo de tormenta', 'Fragmento del corazón de Kazzix', 'Órdenes del Culto del Wyrm',
    'Filacteria ritual', 'Sigilo del Gravewyrm', 'Brasas benditas', 'Fragmento de llave del santuario',
  ],
  zones: [
    ['Valle de Eastbrook', 'Busca al mariscal Redbrook en la ciudad: tiene trabajo para ti.', ['Eastbrook', 'Senda de lobos', 'Prado de jabalíes', 'Lago Espejo', 'Webwood', 'Mina de cobre', 'Campamento bandido', 'Capilla caída']],
    ['Ciénaga de Mirefen', 'Preséntate ante el guardián Fenwick en la puerta de Fenbridge.', ['Fenbridge', 'Juncos de merodeadores', 'Bajíos de Deepfen', 'Matorral de viudas', 'Capilla ahogada', 'Túmulos trol', 'Campamento Gravecaller', 'El Bastión Sumergido']],
    ['Alturas de Thornpeak', 'La capitana Thessaly sostiene el muro de Highwatch a duras penas.', ['Highwatch', 'Cresta del acechador', 'Madrigueras Deeprock', 'Colinas ogro', 'Campamento de guerra de Drogmar', 'Stormcrag', 'Tiendas del Culto del Wyrm', 'Campos de aparecidos', 'Santuario del Gravewyrm']],
  ],
  dungeons: [
    ['La Cripta Hueca', 'Desciendes a la Cripta Hueca...', 'Vuelves a subir a la luz del día.'],
    ['El Bastión Sumergido', 'Vadeas hacia las profundidades del Bastión Sumergido...', 'Sales de la oscuridad ahogada.'],
    ['Santuario del Gravewyrm', 'El aire se vuelve frío. Algo inmenso respira abajo...', 'Sales tambaleándote al viento de la montaña.'],
  ],
};

const frData: LocaleData = {
  mobs: [
    'Loup des bois', 'Vieux Greyjaw', 'Sanglier sauvage', 'Rôdeur de Webwood', 'Rôdeur Aileron-de-boue', 'Terrassier Rat des tunnels',
    'Bandit du Val', 'Ossements agités', "Gorrak l'Impitoyable", 'Rôdeur du bourbier', 'Happeur de Deepfen', 'Veuve de Mirefen',
    'La Mère des couvées', 'Mort noyé', 'Troll de Mirefen', 'Grubjaw le Glouton', 'Cultiste Gravecaller', 'Invocateur Gravecaller',
    'Diacre Voss', 'Traqueur de crête', 'Tunnelier de Deeprock', 'Ogre de Thornpeak', 'Broyeur de Thornpeak', 'Seigneur de guerre Drogmar',
    'Élémentaire de Stormcrag', 'Seigneur des éclats Kazzix', 'Zélote du Culte du Wyrm', 'Nécromancien du Culte du Wyrm', "Revenant caparaçonné d'os",
    'Traînard de la crypte', 'Acolyte du Creux', 'Veuve Frissos', 'Sacristain Marrow', 'Morthen le Gravecaller', 'Revenant du Bastion',
    'Acolyte lié aux marées', 'Serviteur noyé', 'Chevalier-commandant Olen', 'Vael le Mistcaller', 'Garde-os du Sanctuaire', 'Drakonide du Sanctuaire',
    'Marche-os relevé', "Korgath l'Enchaîné", 'Grand nécromancien Velkhar', 'Korzul le Gravewyrm',
  ],
  npcRows: [
    ['Le Marchand', 'Gardien du Marché mondial', 'Bienvenue au Marché mondial, {className}. Achetez aux aventuriers du royaume ou proposez vos propres marchandises.'],
    ['Maréchal Redbrook', 'Maréchal de la ville', "Gardez votre lame près de vous, {className}. Le Val n'est plus ce qu'il était."],
    ['Marchand Wilkes', 'Fournisseur', 'Pain frais, eau claire, prix honnêtes. Que puis-je vous servir ?'],
    ['Apothicaire Lin', 'Herboriste', "Faites attention où vous mettez les pieds dans les bois de l'est, ami."],
    ['Frère Aldric', 'Prêtre du Val', 'Que la Lumière vous garde. Même les morts ne trouvent plus le repos ici.'],
    ['Forgeron Haldren', "Armurier et fabricant d'armes", "Attention aux étincelles, {className}. Un bon acier sépare une cicatrice d'une tombe."],
    ['Pêcheur Brandt', 'Vieux loup de mer', "Grlmurlgrl... pardon, j'écoute ces hommes-poissons depuis trop longtemps."],
    ['Contremaître Odell', 'Contremaître de la mine', 'Toute la mine grouille de ces vermines à chandelles !'],
    ['Gardien Fenwick', 'Gardien de Fenbridge', 'Halte à la porte, {className}. Au-delà des roseaux, la fange tue pour nous.'],
    ['Frère Aldric', 'Prêtre du Val', "Que la Lumière vous garde hors de l'eau, {playerName}. Les morts de ce marais ne dorment pas: ils pataugent."],
    ['Approvisionneur Hale', 'Fournisseur', 'Bottes sèches, pain sec, poudre sèche: à Fenbridge, deux sur trois est une bonne journée.'],
    ['Herboriste Yara', 'Herboriste', "Méfiez-vous du fourré à l'ouest de la route. Les toiles sont épaisses comme des voiles."],
    ['Éclaireuse Maren', 'Éclaireuse du maréchal', 'Des pas silencieux et une lame courte vous gardent en vie. Parlez vite, je dois retourner aux roseaux.'],
    ['Capitaine Thessaly', 'Capitaine de Highwatch', 'Ce mur tient depuis deux cents ans, {className}. Il ne cédera pas sous ma garde, mais il gémit.'],
    ['Frère Aldric', 'Prêtre du Val', "D'un cimetière de chapelle au toit du monde... la piste s'achève ici. Je sens la montagne écouter."],
    ['Éclaireuse Maren', 'Éclaireuse du maréchal', "J'ai suivi les cultistes dans le marais avec vous, et la piste mène ici. Les pics sont pires, {className}. Restez vigilant."],
    ['Quartier-maître Bree', 'Quartier-maître de Highwatch', 'Laine, biscuit dur et bottes ferrées: Highwatch vit de ces trois choses, et je manque de tout.'],
    ['Armurier Hode', 'Maître armurier', 'La forge est chaude et la meule tourne. Si ça coupe, je le vends.'],
    ['Maître du savoir Caddis', 'Maître du savoir', 'Méfiez-vous des schistes instables, {className}. La montagne est agitée ces temps-ci, et je veux savoir pourquoi.'],
  ],
  questTitles: [
    'Des loups à la porte', 'Le vieux loup', 'Peaux de Bristleback', 'La menace de Webwood', 'Troubles au lac', 'Des rats dans la mine',
    'Les morts sans repos', 'Fournitures volées', 'Murmures sous terre', 'Les noms des morts', "Faire taire l'appel", 'Le rite de lien',
    'Dans le Creux', 'La cloche du sacristain', 'La piste du Gravecaller', 'Bandits du Val', 'Le chef de bande', 'Rassemblement à Fenbridge',
    'Les crocs de la fange', 'Des peaux pour la chaussée', 'La caravane perdue', "Le Deepfen s'agite", 'Idoles des profondeurs',
    'Retour aux hauts-fonds', 'Soie et venin', 'La Mère des couvées', 'Les morts noyés', 'Encensoirs des profondeurs',
    'Pas de repos dans les roseaux', 'Tertres de Mirefen', 'Fétiche et os', 'Le Glouton', 'Robes dans les roseaux',
    "Arrêter l'invocation", 'Le diacre du bourbier', 'Le Bastion englouti', 'La honte du chevalier-commandant', 'Le Mistcaller',
    'La garde sur les pics', 'Traqueurs sur la crête', "L'hiver vient à Highwatch", 'Troubles à Deeprock', 'Cire étrange',
    'Ogres des contreforts', 'Totems de guerre', 'La prime de la capitaine', 'Briser le camp de guerre', 'Seigneur de guerre Drogmar',
    "La montagne s'éveille", 'Coeurs de la tempête', 'Le seigneur des éclats', 'Chants sur le vent', "Ordres d'en bas",
    "L'anneau des phylactères", 'Les champs des revenants', "Os de l'avant-garde", 'Sigils du Wyrm', 'Briser le sceau',
    "La voix d'en bas", 'La porte du Sanctuaire', 'Le gardien lié', 'Le grand nécromancien', 'Korzul le Gravewyrm',
  ],
  objectiveItems: [
    'Croc du vieux Greyjaw', 'Peau de sanglier hérissée', 'Glande de soie de Webwood', 'Caisse de fournitures volée',
    'Sceau de Gravecaller', 'Page de registre usée', 'Suif béni', 'Essence spectrale', 'Grimoire de Morthen',
    'Ordre de rassemblement de Fenbridge', 'Peau de rôdeur du bourbier', 'Marchandises de la caravane perdue', 'Idole détrempée',
    'Sac à venin de veuve', 'Encensoir rouillé', 'Fétiche troll de Mirefen', 'Défense de Grubjaw', 'Chiffre de Gravecaller',
    'Pierre de garde du Bastion', 'Convocation de Highwatch', 'Peau de traqueur de crête', 'Cire luisante', 'Totem de guerre ogre',
    'Coeur de tempête', 'Éclat de coeur de Kazzix', 'Ordres du Culte du Wyrm', 'Phylactère rituel', 'Sceau du Gravewyrm',
    'Braises bénies', 'Éclat de clé du sanctuaire',
  ],
  zones: [
    ["Val d'Eastbrook", 'Trouvez le maréchal Redbrook en ville: il a du travail pour vous.', ['Eastbrook', 'Piste des loups', 'Pré aux sangliers', 'Lac Miroir', 'Webwood', 'Mine de cuivre', 'Camp des bandits', 'Chapelle tombée']],
    ['Marais de Mirefen', 'Présentez-vous au gardien Fenwick à la porte de Fenbridge.', ['Fenbridge', 'Roseaux des rôdeurs', 'Hauts-fonds de Deepfen', 'Fourré des veuves', 'Chapelle noyée', 'Tertres trolls', 'Campement Gravecaller', 'Le Bastion englouti']],
    ['Hauteurs de Thornpeak', 'La capitaine Thessaly tient le mur de Highwatch, à peine.', ['Highwatch', 'Crête du traqueur', 'Terriers de Deeprock', 'Contreforts ogres', 'Camp de guerre de Drogmar', 'Stormcrag', 'Tentes du Culte du Wyrm', 'Champs des revenants', 'Sanctuaire du Gravewyrm']],
  ],
  dungeons: [
    ['La Crypte creuse', 'Vous descendez dans la Crypte creuse...', 'Vous remontez à la lumière du jour.'],
    ['Le Bastion englouti', 'Vous pataugez dans les profondeurs du Bastion englouti...', "Vous sortez de l'obscurité noyée."],
    ['Sanctuaire du Gravewyrm', "L'air devient froid. Quelque chose d'immense respire en bas...", 'Vous titubez dans le vent de la montagne.'],
  ],
};

const deData: LocaleData = {
  mobs: [
    'Waldwolf', 'Alter Greyjaw', 'Wilder Eber', 'Webwood-Lauerer', 'Schlammflossen-Schleicher', 'Tunnelratten-Gräber',
    'Talbandit', 'Ruhelose Knochen', 'Gorrak der Gnadenlose', 'Moorpirscher', 'Deepfen-Schnapper', 'Mirefen-Witwe',
    'Die Brutmutter', 'Ertrunkener Toter', 'Mirefen-Troll', 'Grubjaw der Vielfraß', 'Gravecaller-Kultist', 'Gravecaller-Beschwörer',
    'Diakon Voss', 'Gratpirscher', 'Deeprock-Tunnelgräber', 'Thornpeak-Oger', 'Thornpeak-Zermalmer', 'Kriegsherr Drogmar',
    'Stormcrag-Elementar', 'Splitterlord Kazzix', 'Wyrmkult-Eiferer', 'Wyrmkult-Nekromant', 'Knochengepanzerter Wiedergänger',
    'Gruftschlurfer', 'Akolyth der Höhlung', 'Knochenkälte-Witwe', 'Küster Marrow', 'Morthen der Gravecaller', 'Bastion-Wiedergänger',
    'Gezeitengebundener Akolyth', 'Ertrunkener Knecht', 'Ritterkommandant Olen', 'Vael der Mistcaller', 'Heiligtums-Knochenwache',
    'Heiligtumsdrakonid', 'Erhobener Knochenläufer', 'Korgath der Gebundene', 'Großnekromant Velkhar', 'Korzul der Gravewyrm',
  ],
  npcRows: [
    ['Der Händler', 'Hüter des Weltmarkts', 'Willkommen auf dem Weltmarkt, {className}. Kaufe von Abenteurern aus dem ganzen Reich oder biete deine eigenen Waren an.'],
    ['Marschall Redbrook', 'Stadtmarschall', 'Halte deine Klinge nah, {className}. Das Tal ist nicht mehr, was es war.'],
    ['Händler Wilkes', 'Proviantmeister', 'Frisches Brot, klares Wasser, faire Preise. Was brauchst du?'],
    ['Apothekerin Lin', 'Kräuterkundige', 'Pass im östlichen Wald auf, wohin du trittst, Freund.'],
    ['Bruder Aldric', 'Priester des Tals', 'Das Licht behüte dich. Selbst die Toten finden hier seit Kurzem keine Ruhe.'],
    ['Schmied Haldren', 'Rüstungs- und Waffenschmied', 'Achte auf die Funken, {className}. Guter Stahl trennt eine Narbe von einem Grab.'],
    ['Fischer Brandt', 'Alter Seebär', 'Grlmurlgrl... verzeih, ich habe diesen Fischmenschen zu lange zugehört.'],
    ['Vorarbeiter Odell', 'Minenvorarbeiter', 'Der ganze Stollen wimmelt von diesen Kerzenkopf-Schädlingen!'],
    ['Wärter Fenwick', 'Wärter von Fenbridge', 'Halt am Tor, {className}. Hinter dem Schilf tötet das Moor für uns.'],
    ['Bruder Aldric', 'Priester des Tals', 'Das Licht halte dich über Wasser, {playerName}. Die Toten in diesem Moor schlafen nicht: sie waten.'],
    ['Proviantmeister Hale', 'Proviantmeister', 'Trockene Stiefel, trockenes Brot, trockenes Pulver: In Fenbridge bekommst du an guten Tagen zwei davon.'],
    ['Kräuterkundige Yara', 'Kräuterkundige', 'Meide das Dickicht westlich der Straße. Die Netze sind diese Saison dick wie Segeltuch.'],
    ['Späherin Maren', 'Späherin des Marschalls', 'Leise Schritte und eine kurze Klinge halten dich am Leben. Sprich schnell, ich muss zurück ins Schilf.'],
    ['Hauptmann Thessaly', 'Hauptmann von Highwatch', 'Zweihundert Jahre steht diese Mauer, {className}. Unter meiner Wache bricht sie nicht, auch wenn sie ächzt.'],
    ['Bruder Aldric', 'Priester des Tals', 'Vom Kapellenhof im Tal bis zum Dach der Welt... die Spur endet hier. Ich spüre, wie der Berg lauscht.'],
    ['Späherin Maren', 'Späherin des Marschalls', 'Ich verfolgte mit dir Kultisten durch das Moor, und die Spur führte hierher. Die Gipfel sind schlimmer, {className}. Bleib wachsam.'],
    ['Quartiermeisterin Bree', 'Quartiermeisterin von Highwatch', 'Wolle, Hartzwieback und beschlagene Stiefel: Highwatch lebt von allen dreien, und mir fehlt alles.'],
    ['Rüstungsschmied Hode', 'Meisterrüster', 'Die Esse ist heiß und der Schleifstein dreht sich. Wenn es schneidet, verkaufe ich es.'],
    ['Lehrmeister Caddis', 'Lehrmeister', 'Achte auf lockeren Schiefer, {className}. Der Berg ist unruhig geworden, und ich will wissen warum.'],
  ],
  questTitles: [
    'Wölfe vor der Tür', 'Der alte Wolf', 'Bristleback-Häute', 'Bedrohung aus Webwood', 'Ärger am See', 'Ratten in der Mine',
    'Die ruhelosen Toten', 'Gestohlene Vorräte', 'Flüstern darunter', 'Die Namen der Toten', 'Den Ruf verstummen lassen',
    'Der Bindungsritus', 'In die Höhlung', 'Die Glocke des Küsters', 'Die Spur des Gravecallers', 'Banditen des Tals',
    'Der Rädelsführer', 'Musterung in Fenbridge', 'Zähne des Moors', 'Felle für den Damm', 'Die verlorene Karawane',
    'Deepfen regt sich', 'Götzen aus der Tiefe', 'Zurück in die Untiefen', 'Seide und Gift', 'Die Brutmutter',
    'Die ertrunkenen Toten', 'Räuchergefäße aus der Tiefe', 'Keine Ruhe im Schilf', 'Hügelgräber von Mirefen',
    'Fetisch und Knochen', 'Der Vielfraß', 'Roben im Schilf', 'Die Beschwörung stoppen', 'Der Diakon des Moors',
    'Die versunkene Bastion', 'Die Schande des Ritterkommandanten', 'Der Mistcaller', 'Die Wacht auf den Gipfeln',
    'Pirscher auf dem Grat', 'Der Winter kommt nach Highwatch', 'Ärger in Deeprock', 'Seltsames Wachs', 'Oger in den Vorbergen',
    'Totems des Krieges', 'Das Kopfgeld der Hauptfrau', 'Das Kriegslager brechen', 'Kriegsherr Drogmar', 'Der Berg erwacht',
    'Kerne des Sturms', 'Der Splitterlord', 'Gesänge im Wind', 'Befehle von unten', 'Der Ring der Phylakterien',
    'Die Wiedergängerfelder', 'Knochen der Vorhut', 'Siegel des Wyrms', 'Das Siegel brechen', 'Die Stimme von unten',
    'Das Tor des Heiligtums', 'Der gebundene Wächter', 'Der Großnekromant', 'Korzul der Gravewyrm',
  ],
  objectiveItems: [
    'Zahn des alten Greyjaw', 'Borstige Eberhaut', 'Seidendrüse von Webwood', 'Gestohlene Vorratskiste', 'Gravecaller-Siegel',
    'Verwitterte Buchseite', 'Gesegneter Talg', 'Geisterhafte Essenz', 'Morthens Grimoire', 'Musterungsbefehl von Fenbridge',
    'Balg eines Moorpirschers', 'Waren der verlorenen Karawane', 'Durchnässtes Götzenbild', 'Witwengiftsack', 'Rostiges Räuchergefäß',
    'Mirefen-Trollfetisch', 'Grubjaws Hauer', 'Gravecaller-Chiffre', 'Bastion-Wachstein', 'Einberufung von Highwatch',
    'Balg eines Gratpirschers', 'Glühendes Wachs', 'Ogerkriegstotem', 'Sturmkern', 'Kazzix Herzsplitter', 'Befehle des Wyrmkults',
    'Rituelles Seelengefäß', 'Gravewyrm-Siegel', 'Gesegnete Glut', 'Heiligtums-Schlüsselsplitter',
  ],
  zones: [
    ['Eastbrook-Tal', 'Suche Marschall Redbrook in der Stadt: Er hat Arbeit für dich.', ['Eastbrook', 'Wolfslauf', 'Eberwiese', 'Spiegelsee', 'Webwood', 'Kupfermine', 'Banditenlager', 'Gefallene Kapelle']],
    ['Mirefen-Moor', 'Melde dich bei Wärter Fenwick am Tor von Fenbridge.', ['Fenbridge', 'Pirscher-Schilf', 'Deepfen-Untiefen', 'Witwendickicht', 'Ertrunkene Kapelle', 'Trollhügel', 'Gravecaller-Lager', 'Die versunkene Bastion']],
    ['Thornpeak-Höhen', 'Hauptmann Thessaly hält die Mauer von Highwatch, gerade so.', ['Highwatch', 'Pirschergrat', 'Deeprock-Baue', 'Ogervorberge', 'Drogmars Kriegslager', 'Stormcrag', 'Wyrmkult-Zelte', 'Wiedergängerfelder', 'Gravewyrm-Heiligtum']],
  ],
  dungeons: [
    ['Die Hohle Gruft', 'Du steigst in die Hohle Gruft hinab...', 'Du kletterst zurück ins Tageslicht.'],
    ['Die versunkene Bastion', 'Du watest in die versunkene Bastion hinab...', 'Du kletterst aus der ertrinkenden Dunkelheit.'],
    ['Gravewyrm-Heiligtum', 'Die Luft wird kalt. Etwas Gewaltiges atmet in der Tiefe...', 'Du taumelst zurück in den Bergwind.'],
  ],
};

const itData: LocaleData = {
  mobs: [
    'Lupo della foresta', 'Vecchio Greyjaw', 'Cinghiale selvatico', 'Predatore di Webwood', 'Predatore Pinnalimo', 'Scavatore ratto di galleria',
    'Bandito della Valle', 'Ossa irrequiete', 'Gorrak lo Spietato', 'Predatore del pantano', 'Murloc di Deepfen', 'Vedova di Mirefen',
    'Madre della covata', 'Morto annegato', 'Troll di Mirefen', 'Grubjaw il Goloso', 'Cultista Gravecaller', 'Evocatore Gravecaller',
    'Diacono Voss', 'Braccatore della cresta', 'Coboldo di Deeprock', 'Ogre di Thornpeak', 'Frantumatore ogre', 'Signore della guerra Drogmar',
    'Elementale di Stormcrag', 'Signore dei frammenti Kazzix', 'Zelota del Culto del Wyrm', 'Negromante del Culto del Wyrm',
    'Revenant corazzato di ossa', 'Barcollante della cripta', 'Accolito del Vuoto', 'Vedova Freddosso', 'Sagrestano Marrow',
    'Morthen il Gravecaller', 'Revenant del Bastione', 'Accolito legato alla marea', 'Servo annegato', 'Cavaliere comandante Olen',
    'Vael il Mistcaller', 'Guardiano osseo del Santuario', 'Draconide del Santuario', 'Camminatore di ossa risorto',
    'Korgath il Vincolato', 'Grande negromante Velkhar', 'Korzul il Gravewyrm',
  ],
  npcRows: [
    ['Il Mercante', 'Custode del Mercato Mondiale', 'Benvenuto al Mercato Mondiale, {className}. Compra dagli avventurieri del reame o vendi le tue merci.'],
    ['Maresciallo Redbrook', 'Maresciallo cittadino', 'Tieni la lama vicina, {className}. La Valle non è più quella di una volta.'],
    ['Mercante Wilkes', 'Fornitore', 'Pane fresco, acqua pulita e prezzi onesti. Che cosa ti serve?'],
    ['Speziale Lin', 'Erborista', 'Fai attenzione a dove metti i piedi nei boschi orientali, amico.'],
    ['Fratello Aldric', 'Sacerdote della Valle', 'Che la Luce ti protegga. Nemmeno i morti trovano più riposo qui.'],
    ['Fabbro Haldren', 'Armaiolo e fabbro', 'Attento alle scintille, {className}. Il buon acciaio separa una cicatrice da una tomba.'],
    ['Pescatore Brandt', 'Vecchio lupo di mare', 'Grlmurlgrl... scusa, ho ascoltato quegli uomini pesce troppo a lungo.'],
    ['Caposquadra Odell', 'Caposquadra della miniera', 'Tutta la galleria brulica di quei parassiti con la candela in testa!'],
    ['Custode Fenwick', 'Custode di Fenbridge', 'Fermo al cancello, {className}. Oltre le canne, la palude uccide per noi.'],
    ['Fratello Aldric', 'Sacerdote della Valle', 'Che la Luce ti mantenga fuori dall acqua, {playerName}. I morti di questa palude non dormono: guadano.'],
    ['Provveditore Hale', 'Fornitore', 'Stivali asciutti, pane secco e polvere asciutta: a Fenbridge, due su tre è una buona giornata.'],
    ['Erborista Yara', 'Erborista', 'Sta lontano dal folto a ovest della strada. Le ragnatele sono spesse come vele.'],
    ['Esploratrice Maren', 'Esploratrice del maresciallo', 'Passi silenziosi e una lama corta ti tengono in vita. Parla in fretta: devo tornare alle canne.'],
    ['Capitano Thessaly', 'Capitano di Highwatch', 'Questo muro resiste da duecento anni, {className}. Non cadrà sotto la mia guardia, anche se geme.'],
    ['Fratello Aldric', 'Sacerdote della Valle', 'Dal camposanto della cappella al tetto del mondo... la pista finisce qui. Sento la montagna ascoltare.'],
    ['Esploratrice Maren', 'Esploratrice del maresciallo', 'Ho seguito i cultisti nella palude con te, e la pista porta qui. Le cime sono peggiori, {className}. Resta vigile.'],
    ['Quartiermastro Bree', 'Quartiermastro di Highwatch', 'Lana, gallette dure e stivali ferrati: Highwatch vive di queste tre cose, e a me manca tutto.'],
    ['Armaiolo Hode', 'Maestro armaiolo', 'La forgia è calda e la mola gira. Se taglia, lo vendo.'],
    ['Maestro del sapere Caddis', 'Maestro del sapere', 'Fai attenzione allo scisto instabile, {className}. La montagna è inquieta da qualche tempo, e voglio sapere perché.'],
  ],
  questTitles: [
    'Lupi alla porta', 'Il vecchio lupo', 'Pelli di Bristleback', 'La minaccia di Webwood', 'Problemi al lago', 'Ratti nella miniera',
    'I morti inquieti', 'Scorte rubate', 'Sussurri nel sottosuolo', 'I nomi dei morti', 'Zittire il richiamo', 'Il rito del vincolo',
    'Nel Vuoto', 'La campana del sagrestano', 'La traccia del Gravecaller', 'Banditi della Valle', 'Il capo', 'Adunata a Fenbridge',
    'Zanne del pantano', 'Pelli per la strada rialzata', 'La carovana perduta', 'Deepfen si agita', 'Idoli delle profondità',
    'Ritorno ai bassifondi', 'Seta e veleno', 'La Madre della covata', 'I morti annegati', 'Incensieri delle profondità',
    'Nessun riposo tra le canne', 'Tumuli di Mirefen', 'Feticcio e ossa', 'Il Goloso', 'Vesti tra le canne', 'Fermare la chiamata',
    'Il diacono del pantano', 'Il Bastione Sommerso', 'La vergogna del cavaliere comandante', 'Il Mistcaller', 'La guardia sulle cime',
    'Braccatori sulla cresta', 'Inverno a Highwatch', 'Problemi a Deeprock', 'Cera strana', 'Ogre nelle colline', 'Totem di guerra',
    'La taglia del capitano', 'Spezzare il campo di guerra', 'Signore della guerra Drogmar', 'La montagna si sveglia',
    'Nuclei della tempesta', 'Il signore dei frammenti', 'Canti nel vento', 'Ordini dal basso', 'Anello di filatteri',
    'Campi dei revenant', 'Ossa di avanguardia', 'Sigilli del Wyrm', 'Rompere il sigillo', 'La voce dal basso',
    'La porta del Santuario', 'Il guardiano vincolato', 'Il grande negromante', 'Korzul il Gravewyrm',
  ],
  objectiveItems: [
    'Zanna del vecchio Greyjaw', 'Pelle di cinghiale irsuta', 'Ghiandola di seta di Webwood', 'Cassa di scorte rubata',
    'Sigillo Gravecaller', 'Pagina di registro consunta', 'Sego benedetto', 'Essenza spettrale', 'Grimorio di Morthen',
    'Ordine di adunata di Fenbridge', 'Pelle di predatore del pantano', 'Merci della carovana perduta', 'Idolo fradicio',
    'Sacca velenifera di vedova', 'Incensiere arrugginito', 'Feticcio troll di Mirefen', 'Zanna di Grubjaw',
    'Cifrario Gravecaller', 'Pietra di guardia del Bastione', 'Convocazione di Highwatch', 'Pelle di braccatore della cresta',
    'Cera luminosa', 'Totem di guerra ogre', 'Nucleo della tempesta', 'Frammento del cuore di Kazzix', 'Ordini del Culto del Wyrm',
    'Filatterio rituale', 'Sigillo del Gravewyrm', 'Braci benedette', 'Frammento di chiave del santuario',
  ],
  zones: [
    ['Valle di Eastbrook', 'Cerca il maresciallo Redbrook in città: ha lavoro per te.', ['Eastbrook', 'Sentiero dei lupi', 'Prato dei cinghiali', 'Lago Specchio', 'Webwood', 'Miniera di rame', 'Campo dei banditi', 'Cappella caduta']],
    ['Palude di Mirefen', 'Presentati al custode Fenwick al cancello di Fenbridge.', ['Fenbridge', 'Canne dei predatori', 'Bassifondi di Deepfen', 'Folto delle vedove', 'Cappella annegata', 'Tumuli troll', 'Campo Gravecaller', 'Il Bastione Sommerso']],
    ['Alture di Thornpeak', 'Il capitano Thessaly tiene a stento il muro di Highwatch.', ['Highwatch', 'Cresta del braccatore', 'Tane di Deeprock', 'Colline degli ogre', 'Campo di guerra di Drogmar', 'Stormcrag', 'Tende del Culto del Wyrm', 'Campi dei revenant', 'Santuario del Gravewyrm']],
  ],
  dungeons: [
    ['La Cripta Vuota', 'Scendi nella Cripta Vuota...', 'Risali alla luce del giorno.'],
    ['Il Bastione Sommerso', 'Guadi nelle profondità del Bastione Sommerso...', 'Esci dall oscurità annegata.'],
    ['Santuario del Gravewyrm', 'L aria si fa fredda. Qualcosa di immenso respira sotto...', 'Barcolli di nuovo nel vento di montagna.'],
  ],
};

const zhCnData: LocaleData = {
  mobs: [
    '森林狼', '老灰颚', '野猪', '网木潜伏者', '泥鳍潜伏者', '地道鼠掘地者', '谷地强盗', '不宁骸骨', '无情者戈拉克',
    '泥沼潜伏兽', '深沼钳咬鱼人', '泥沼寡妇蛛', '蛛母', '溺亡死者', '泥沼巨魔', '贪食者格鲁布颚', '唤墓者教徒',
    '唤墓者召唤师', '执事沃斯', '山脊潜猎者', '深岩掘地者', '荆峰食人魔', '荆峰粉碎者', '督军德罗格玛',
    '风暴岩元素', '碎片领主卡兹克斯', '龙教狂热者', '龙教死灵法师', '骨甲亡魂', '墓穴蹒跚者', '空洞侍僧',
    '寒骨寡妇蛛', '司事马罗', '唤墓者莫森', '堡垒亡魂', '潮缚侍僧', '溺亡奴仆', '骑士指挥官奥伦',
    '唤雾者维尔', '圣所骨卫', '圣所龙人', '复生骨行者', '被缚者科加斯', '大死灵法师维尔卡', '墓龙科祖尔',
  ],
  npcRows: [
    ['商人', '世界市场守护者', '欢迎来到世界市场，{className}。从王国各地的冒险者手中购买，或出售你自己的货物。'],
    ['雷德布鲁克元帅', '城镇元帅', '刀别离手，{className}。山谷已经不是从前的山谷了。'],
    ['威尔克斯商人', '补给商', '新鲜面包，清水，公道价格。你需要什么？'],
    ['林药剂师', '草药师', '在东边林地里落脚要小心，朋友。'],
    ['奥德里克修士', '山谷牧师', '愿圣光护佑你。如今连死者也无法在这里安息。'],
    ['哈德伦铁匠', '护甲与武器匠', '小心火星，{className}。好钢能把伤疤和坟墓隔开。'],
    ['布兰特渔夫', '老水手', '咕噜鱼噜... 抱歉，我听那些鱼人说话太久了。'],
    ['奥德尔工头', '矿井工头', '整条矿道都挤满了那些头顶蜡烛的害虫！'],
    ['芬威克守望者', '芬桥守望者', '在门口停下，{className}。芦苇后面的沼泽会替我们杀人。'],
    ['奥德里克修士', '山谷牧师', '愿圣光让你不沉入水下，{playerName}。这片湿地的死者不睡觉，他们在泥水中跋涉。'],
    ['海尔补给官', '补给商', '干靴子，干面包，干火药：在芬桥，一天能有两样就算不错。'],
    ['雅拉草药师', '草药师', '小心路西边的灌木丛。这里的蛛网厚得像船帆。'],
    ['玛伦斥候', '元帅的斥候', '安静的脚步和短刃能保命。快说，我得回芦苇地去。'],
    ['瑟萨莉队长', '高望队长', '这面墙已经站了两百年，{className}。只要我守着它，它就不会倒，虽然它正在呻吟。'],
    ['奥德里克修士', '山谷牧师', '从礼拜堂墓地到世界屋脊... 线索到这里结束。我感觉山正在聆听。'],
    ['玛伦斥候', '元帅的斥候', '我和你一起在湿地追踪那些邪教徒，而线索通向这里。群峰更糟，{className}。保持警惕。'],
    ['布里军需官', '高望军需官', '羊毛，硬饼，铁掌靴：高望靠这三样维持，而我什么都缺。'],
    ['霍德护甲匠', '护甲大师', '炉火正旺，砂轮正转。能砍的东西，我都卖。'],
    ['凯迪斯博学者', '博学者', '小心松动的页岩，{className}。这座山近来不安，我想知道原因。'],
  ],
  questTitles: [
    '门前群狼', '老狼', '硬鬃皮', '网木之患', '湖边麻烦', '矿洞里的鼠患', '不宁的死者', '被盗的补给', '地下低语',
    '死者之名', '让呼唤沉寂', '束缚仪式', '进入空洞', '司事的钟', '唤墓者的踪迹', '谷地强盗', '匪首',
    '芬桥集结', '沼泽之牙', '修筑栈道的毛皮', '失踪商队', '深沼躁动', '深处的神像', '回到浅滩',
    '丝与毒', '蛛母', '溺亡死者', '深处香炉', '芦苇中不得安息', '泥沼坟丘', '护符与白骨', '贪食者',
    '芦苇中的灰袍', '阻止召唤', '泥沼执事', '沉没堡垒', '骑士指挥官的耻辱', '唤雾者', '群峰守望',
    '山脊上的潜猎者', '冬日将至高望', '深岩麻烦', '奇异蜡块', '山麓食人魔', '战争图腾', '队长的悬赏',
    '击破战争营地', '督军德罗格玛', '山脉苏醒', '风暴核心', '碎片领主', '风中圣歌', '来自地下的命令',
    '护命匣之环', '亡魂战场', '先锋之骨', '墓龙徽记', '破除封印', '地下之声', '圣所大门',
    '被缚守护者', '大死灵法师', '墓龙科祖尔',
  ],
  objectiveItems: [
    '老灰颚的尖牙', '硬鬃野猪皮', '网木丝腺', '被盗补给箱', '唤墓者徽记', '风化账页', '祝福油脂', '幽魂精华',
    '莫森的魔典', '芬桥集结令', '泥沼潜伏者毛皮', '遗失商队货物', '浸水神像', '寡妇毒囊', '生锈香炉',
    '泥沼巨魔护符', '格鲁布颚的獠牙', '唤墓者密文', '堡垒护符石', '高望召令', '山脊潜猎者毛皮',
    '发光蜡块', '食人魔战争图腾', '风暴核心', '卡兹克斯的心裂片', '龙教命令', '仪式护命匣',
    '墓龙徽记', '祝福余烬', '圣所钥匙碎片',
  ],
  zones: [
    ['东溪谷', '去镇上找雷德布鲁克元帅，他有任务交给你。', ['东溪', '狼径', '野猪草地', '镜湖', '网木林', '铜矿坑', '强盗营地', '倒塌礼拜堂']],
    ['泥沼湿地', '到芬桥大门向守望者芬威克报到。', ['芬桥', '潜伏者芦苇地', '深沼浅滩', '寡妇灌木丛', '溺没礼拜堂', '巨魔坟丘', '唤墓者营地', '沉没堡垒']],
    ['荆峰高地', '瑟萨莉队长勉强守住高望城墙。', ['高望', '潜猎者山脊', '深岩洞穴', '食人魔山麓', '德罗格玛战争营地', '风暴岩', '龙教帐篷', '亡魂战场', '墓龙圣所']],
  ],
  dungeons: [
    ['空洞墓穴', '你走下空洞墓穴...', '你重新爬回日光之下。'],
    ['沉没堡垒', '你涉水进入沉没堡垒深处...', '你爬出溺水般的黑暗。'],
    ['墓龙圣所', '空气变得冰冷。下方有庞然之物在呼吸...', '你踉跄回到山风之中。'],
  ],
};

const zhTwData: LocaleData = {
  ...zhCnData,
  mobs: zhCnData.mobs.map((name) => name
    .replace(/森林/g, '森林').replace(/狼/g, '狼').replace(/亡魂/g, '亡魂').replace(/龙/g, '龍').replace(/唤/g, '喚')),
  npcRows: [
    ['商人', '世界市場守護者', '歡迎來到世界市場，{className}。向王國各地的冒險者購買，或出售你自己的貨物。'],
    ['雷德布魯克元帥', '城鎮元帥', '刀別離手，{className}。山谷已經不是從前的山谷了。'],
    ['威爾克斯商人', '補給商', '新鮮麵包，清水，公道價格。你需要什麼？'],
    ['林藥劑師', '草藥師', '在東邊林地裡落腳要小心，朋友。'],
    ['奧德里克修士', '山谷牧師', '願聖光護佑你。如今連死者也無法在這裡安息。'],
    ['哈德倫鐵匠', '護甲與武器匠', '小心火星，{className}。好鋼能把傷疤和墳墓隔開。'],
    ['布蘭特漁夫', '老水手', '咕嚕魚嚕... 抱歉，我聽那些魚人說話太久了。'],
    ['奧德爾工頭', '礦井工頭', '整條礦道都擠滿了那些頭頂蠟燭的害蟲！'],
    ['芬威克守望者', '芬橋守望者', '在門口停下，{className}。蘆葦後面的沼澤會替我們殺人。'],
    ['奧德里克修士', '山谷牧師', '願聖光讓你不沉入水下，{playerName}。這片濕地的死者不睡覺，他們在泥水中跋涉。'],
    ['海爾補給官', '補給商', '乾靴子，乾麵包，乾火藥：在芬橋，一天能有兩樣就算不錯。'],
    ['雅拉草藥師', '草藥師', '小心路西邊的灌木叢。這裡的蛛網厚得像船帆。'],
    ['瑪倫斥候', '元帥的斥候', '安靜的腳步和短刃能保命。快說，我得回蘆葦地去。'],
    ['瑟薩莉隊長', '高望隊長', '這面牆已經站了兩百年，{className}。只要我守著它，它就不會倒，雖然它正在呻吟。'],
    ['奧德里克修士', '山谷牧師', '從禮拜堂墓地到世界屋脊... 線索到這裡結束。我感覺山正在聆聽。'],
    ['瑪倫斥候', '元帥的斥候', '我和你一起在濕地追蹤那些邪教徒，而線索通向這裡。群峰更糟，{className}。保持警惕。'],
    ['布里軍需官', '高望軍需官', '羊毛，硬餅，鐵掌靴：高望靠這三樣維持，而我什麼都缺。'],
    ['霍德護甲匠', '護甲大師', '爐火正旺，砂輪正轉。能砍的東西，我都賣。'],
    ['凱迪斯博學者', '博學者', '小心鬆動的頁岩，{className}。這座山近來不安，我想知道原因。'],
  ],
  questTitles: zhCnData.questTitles.map((name) => name.replace(/龙/g, '龍').replace(/唤/g, '喚').replace(/门/g, '門')),
  objectiveItems: zhCnData.objectiveItems.map((name) => name.replace(/龙/g, '龍').replace(/唤/g, '喚').replace(/箱/g, '箱')),
  zones: [
    ['東溪谷', '去鎮上找雷德布魯克元帥，他有任務交給你。', ['東溪', '狼徑', '野豬草地', '鏡湖', '網木林', '銅礦坑', '強盜營地', '倒塌禮拜堂']],
    ['泥沼濕地', '到芬橋大門向守望者芬威克報到。', ['芬橋', '潛伏者蘆葦地', '深沼淺灘', '寡婦灌木叢', '溺沒禮拜堂', '巨魔墳丘', '喚墓者營地', '沉沒堡壘']],
    ['荊峰高地', '瑟薩莉隊長勉強守住高望城牆。', ['高望', '潛獵者山脊', '深岩洞穴', '食人魔山麓', '德羅格瑪戰爭營地', '風暴岩', '龍教帳篷', '亡魂戰場', '墓龍聖所']],
  ],
  dungeons: [
    ['空洞墓穴', '你走下空洞墓穴...', '你重新爬回日光之下。'],
    ['沉沒堡壘', '你涉水進入沉沒堡壘深處...', '你爬出溺水般的黑暗。'],
    ['墓龍聖所', '空氣變得冰冷。下方有龐然之物在呼吸...', '你踉蹌回到山風之中。'],
  ],
};

const koData: LocaleData = {
  ...zhCnData,
  mobs: [
    '숲늑대', '늙은 그레이죠', '야생 멧돼지', '그물나무 잠복자', '진흙지느러미 잠복자', '굴쥐 채굴꾼', '계곡 도적',
    '불안한 뼈무더기', '무자비한 고라크', '수렁 배회자', '딥펜 무는이', '마이어펜 과부거미', '거미어미',
    '익사한 망자', '마이어펜 트롤', '대식가 그럽죠', '무덤부름 교단원', '무덤부름 소환사', '부제 보스',
    '산등성이 추적자', '깊은바위 굴꾼', '쏜피크 오우거', '쏜피크 분쇄자', '전쟁군주 드로그마르',
    '스톰크래그 정령', '파편군주 카직스', '고룡교단 광신도', '고룡교단 강령술사', '뼈갑옷 망령',
    '묘실 비틀거림꾼', '공허의 수행사제', '뼈서리 과부거미', '성구지기 매로우', '무덤부름 모르덴',
    '요새 망령', '조수결속 수행사제', '익사한 노예', '기사대장 올렌', '안개부름 바엘', '성소 뼈수호자',
    '성소 드라코니드', '되살아난 뼈걸음꾼', '속박된 코르가스', '대강령술사 벨카르', '무덤고룡 코르줄',
  ],
  npcRows: [
    ['상인', '세계 시장 관리자', '세계 시장에 오신 것을 환영합니다, {className}. 왕국의 모험가들에게서 물건을 사거나 자신의 물건을 내놓으십시오.'],
    ['레드브룩 원수', '마을 원수', '검을 가까이 두십시오, {className}. 계곡은 더 이상 예전 같지 않습니다.'],
    ['상인 윌크스', '보급상', '갓 구운 빵, 맑은 물, 정직한 가격입니다. 무엇이 필요하십니까?'],
    ['약제사 린', '약초상', '동쪽 숲에서 발 디딜 곳을 조심하십시오, 친구여.'],
    ['알드릭 수사', '계곡의 사제', '빛이 그대를 지켜 주기를. 이곳에서는 죽은 자들조차 이제 안식을 얻지 못합니다.'],
    ['대장장이 할드렌', '방어구 및 무기 제작자', '불꽃을 조심하십시오, {className}. 좋은 강철은 흉터와 무덤을 가릅니다.'],
    ['어부 브란트', '늙은 뱃사람', '그르멀그르... 죄송합니다. 저 물고기 인간들 말을 너무 오래 들었습니다.'],
    ['감독관 오델', '광산 감독관', '갱도 전체가 머리에 촛불을 단 해충들로 들끓고 있습니다!'],
    ['감시관 펜윅', '펜브리지 감시관', '문 앞에서 멈추십시오, {className}. 갈대 너머의 수렁은 우리 대신 사람을 죽입니다.'],
    ['알드릭 수사', '계곡의 사제', '빛이 그대를 물 위에 머물게 하기를, {playerName}. 이 습지의 죽은 자들은 잠들지 않고 물을 헤칩니다.'],
    ['보급관 헤일', '보급상', '마른 장화, 마른 빵, 마른 화약: 펜브리지에서는 셋 중 둘만 있어도 좋은 날입니다.'],
    ['약초상 야라', '약초상', '길 서쪽의 덤불을 조심하십시오. 거미줄이 돛처럼 두껍습니다.'],
    ['정찰병 마렌', '원수의 정찰병', '조용한 발걸음과 짧은 칼날이 목숨을 지킵니다. 빨리 말하십시오. 갈대밭으로 돌아가야 합니다.'],
    ['대장 테살리', '하이워치 대장', '이 성벽은 이백 년을 버텼습니다, {className}. 내가 지키는 동안 무너지지는 않겠지만, 신음하고 있습니다.'],
    ['알드릭 수사', '계곡의 사제', '예배당 묘지에서 세상의 지붕까지... 흔적은 여기서 끝납니다. 산이 듣고 있음을 느낍니다.'],
    ['정찰병 마렌', '원수의 정찰병', '당신과 함께 습지에서 광신도들을 추적했고, 그 흔적은 여기로 이어졌습니다. 봉우리는 더 위험합니다, {className}. 경계를 늦추지 마십시오.'],
    ['병참장교 브리', '하이워치 병참장교', '양모, 딱딱한 건빵, 쇠박은 장화: 하이워치는 이 세 가지로 버티지만 나는 전부 부족합니다.'],
    ['방어구 제작자 호드', '장인 방어구 제작자', '화덕은 뜨겁고 숫돌은 돌고 있습니다. 베는 물건이라면 팝니다.'],
    ['현자 캐디스', '현자', '느슨한 혈암을 조심하십시오, {className}. 산이 요즘 불안정해졌고, 나는 그 이유를 알고 싶습니다.'],
  ],
  questTitles: [
    '문 앞의 늑대들', '늙은 늑대', '성난등 가죽', '그물나무의 위협', '호숫가의 골칫거리', '광산의 쥐들',
    '쉬지 못하는 죽은 자', '도난당한 보급품', '아래의 속삭임', '죽은 자들의 이름', '부름을 침묵시키기',
    '속박 의식', '공허 속으로', '성구지기의 종', '무덤부름의 흔적', '계곡의 도적들', '우두머리',
    '펜브리지 소집', '수렁의 이빨', '둑길을 위한 가죽', '잃어버린 대상단', '딥펜의 동요', '깊은 곳의 우상',
    '얕은 물가로', '비단과 독', '거미어미', '익사한 망자들', '깊은 곳의 향로', '갈대밭에 안식은 없다',
    '마이어펜 봉분', '부적과 뼈', '대식가', '갈대밭의 로브', '소환 저지', '수렁의 부제', '가라앉은 요새',
    '기사대장의 치욕', '안개부름', '봉우리의 감시', '산등성이의 추적자', '하이워치에 겨울이 온다',
    '깊은바위 문제', '이상한 밀랍', '구릉의 오우거', '전쟁 토템', '대장의 현상금', '전쟁 야영지 파괴',
    '전쟁군주 드로그마르', '산이 깨어난다', '폭풍의 핵', '파편군주', '바람 위의 성가', '아래에서 온 명령',
    '성물함의 고리', '망령 들판', '선봉대의 뼈', '고룡의 인장', '봉인 깨기', '아래의 목소리', '성소의 문',
    '속박된 수호자', '대강령술사', '무덤고룡 코르줄',
  ],
  objectiveItems: [
    '늙은 그레이죠의 송곳니', '억센 멧돼지 가죽', '그물나무 비단샘', '도난당한 보급 상자', '무덤부름 인장',
    '풍화된 장부 페이지', '축복받은 수지', '유령 정수', '모르덴의 마법서', '펜브리지 소집 명령서',
    '수렁 배회자 가죽', '잃어버린 대상단 물품', '물먹은 우상', '과부 독주머니', '녹슨 향로',
    '마이어펜 트롤 부적', '그럽죠의 엄니', '무덤부름 암호문', '요새 수호석', '하이워치 소환장',
    '산등성이 추적자 가죽', '빛나는 밀랍', '오우거 전쟁 토템', '폭풍 핵', '카직스의 심장파편',
    '고룡교단 명령서', '의식 성물함', '무덤고룡 인장', '축복받은 불씨', '성소 열쇠 조각',
  ],
  zones: [
    ['이스트브룩 골짜기', '마을의 레드브룩 원수를 찾아가십시오. 그가 당신에게 맡길 일이 있습니다.', ['이스트브룩', '늑대길', '멧돼지 초원', '거울호수', '그물나무숲', '구리 광산', '도적 야영지', '무너진 예배당']],
    ['마이어펜 습지', '펜브리지 문에서 감시관 펜윅에게 보고하십시오.', ['펜브리지', '배회자 갈대밭', '딥펜 얕은 물', '과부거미 덤불', '가라앉은 예배당', '트롤 봉분', '무덤부름 야영지', '가라앉은 요새']],
    ['쏜피크 고지', '테살리 대장이 간신히 하이워치 성벽을 지키고 있습니다.', ['하이워치', '추적자 산등성이', '딥록 굴', '오우거 구릉', '드로그마르 전쟁 야영지', '스톰크래그', '고룡교단 천막', '망령 들판', '무덤고룡 성소']],
  ],
  dungeons: [
    ['텅 빈 묘실', '텅 빈 묘실로 내려갑니다...', '다시 햇빛 아래로 올라옵니다.'],
    ['가라앉은 요새', '가라앉은 요새의 깊은 곳으로 물을 헤치며 들어갑니다...', '물에 잠긴 어둠에서 빠져나옵니다.'],
    ['무덤고룡 성소', '공기가 차가워집니다. 아래에서 거대한 무언가가 숨 쉽니다...', '산바람 속으로 비틀거리며 돌아옵니다.'],
  ],
};

const jaData: LocaleData = {
  ...zhCnData,
  mobs: [
    '森の狼', '老グレイジョー', '野生の猪', 'ウェブウッドの潜伏者', '泥ひれの潜伏者', 'トンネルラット掘り',
    '谷の盗賊', '安らがぬ骨', '無慈悲なるゴラック', '沼の徘徊者', 'ディープフェンのスナッパー', 'マイアフェンのウィドウ',
    '群れの母', '溺れ死者', 'マイアフェン・トロル', '大食いグラブジョー', 'グレイブコーラーの信徒',
    'グレイブコーラーの召喚師', '助祭ヴォス', '尾根の追跡者', 'ディープロックの坑夫', 'ソーンピーク・オーガ',
    'ソーンピークの粉砕者', '将軍ドログマー', 'ストームクラッグの精霊', '破片卿カジックス',
    'ワーム教団の狂信者', 'ワーム教団の死霊術師', '骨まといの亡霊', '墓所のよろめき手',
    '虚ろの侍祭', '骨冷えのウィドウ', '墓守マロウ', '墓呼びのモーセン', '砦の亡霊',
    '潮縛りの侍祭', '溺れた下僕', '騎士司令官オレン', '霧呼びのヴァエル', '聖所の骨衛兵',
    '聖所のドラコニッド', '甦った骨歩き', '縛られしコルガス', '大死霊術師ヴェルカー', '墓ワームのコルズル',
  ],
  npcRows: [
    ['商人', '世界市場の守り手', '世界市場へようこそ、{className}。王国中の冒険者から買うことも、自分の品を売ることもできます。'],
    ['レッドブルック元帥', '町の元帥', '刃を近くに置いておきなさい、{className}。谷はもう昔のままではありません。'],
    ['商人ウィルクス', '補給商', '焼きたてのパン、澄んだ水、正直な値段です。何が必要ですか？'],
    ['薬師リン', '薬草師', '東の森では足元に気をつけてください、友よ。'],
    ['アルドリック修道士', '谷の司祭', '光があなたを守りますように。ここでは死者でさえ安らげなくなりました。'],
    ['鍛冶師ハルドレン', '防具と武器の鍛冶師', '火花に気をつけなさい、{className}。良い鋼は傷跡と墓を分けます。'],
    ['漁師ブラント', '老いた船乗り', 'グルマーログル... 失礼、魚人どもの声を聞きすぎました。'],
    ['監督官オデル', '鉱山監督', '坑道全体が頭にろうそくを立てた害虫どもでいっぱいです！'],
    ['番人フェンウィック', 'フェンブリッジの番人', '門で止まりなさい、{className}。葦の向こうでは沼が我々の代わりに命を奪います。'],
    ['アルドリック修道士', '谷の司祭', '光があなたを水の上に留めますように、{playerName}。この湿地の死者は眠らず、水を歩きます。'],
    ['補給係ヘイル', '補給商', '乾いた靴、乾いたパン、乾いた火薬。フェンブリッジでは三つのうち二つあれば上出来です。'],
    ['薬草師ヤラ', '薬草師', '道の西の茂みに気をつけてください。蜘蛛の巣が帆のように厚くなっています。'],
    ['斥候マレン', '元帥の斥候', '静かな足取りと短い刃が命を守ります。手短に。葦原へ戻らねばなりません。'],
    ['隊長テサリー', 'ハイウォッチ隊長', 'この壁は二百年立ち続けています、{className}。私が守る限り崩れませんが、悲鳴を上げています。'],
    ['アルドリック修道士', '谷の司祭', '礼拝堂の墓地から世界の屋根まで... 足跡はここで終わります。山が耳を澄ませているのを感じます。'],
    ['斥候マレン', '元帥の斥候', 'あなたと共に湿地で信徒を追いました。そして足跡はここへ続いています。峰はさらに危険です、{className}。油断しないで。'],
    ['需品係ブリー', 'ハイウォッチ需品係', '羊毛、堅パン、鋲打ちの靴。ハイウォッチはこの三つで保っていますが、私はすべて不足しています。'],
    ['防具師ホード', '熟練防具師', '炉は熱く、砥石は回っています。切れるものなら売ります。'],
    ['博識者キャディス', '博識者', '崩れやすい頁岩に気をつけてください、{className}。山は近ごろ落ち着きがなく、その理由を知りたいのです。'],
  ],
  questTitles: [
    '戸口の狼', '老いた狼', 'ブリッスルバックの皮', 'ウェブウッドの脅威', '湖の騒ぎ', '鉱山の鼠',
    '安らがぬ死者', '盗まれた物資', '地下の囁き', '死者の名', '呼び声を沈めよ', '束縛の儀式',
    '虚ろへ', '墓守の鐘', '墓呼びの足跡', '谷の盗賊', '首領', 'フェンブリッジ集結', '沼の牙',
    '土手道のための毛皮', '失われた隊商', 'ディープフェンの目覚め', '深みの偶像', '浅瀬へ戻せ',
    '絹と毒', '群れの母', '溺れし死者', '深みの香炉', '葦の中に安息なし', 'マイアフェンの塚',
    '護符と骨', '大食らい', '葦の中のローブ', '召喚を止めろ', '沼の助祭', '沈んだ砦',
    '騎士司令官の恥', '霧呼び', '峰の見張り', '尾根の追跡者', 'ハイウォッチに冬来たる',
    'ディープロックの問題', '奇妙な蝋', '麓のオーガ', '戦のトーテム', '隊長の懸賞金',
    '戦営を砕け', '将軍ドログマー', '山が目覚める', '嵐の核', '破片卿', '風の上の詠唱',
    '下からの命令', '経箱の輪', '亡霊の野', '先鋒の骨', 'ワームの印章', '封印を破る',
    '下なる声', '聖所の門', '縛られた守護者', '大死霊術師', '墓ワームのコルズル',
  ],
  objectiveItems: [
    '老グレイジョーの牙', '剛毛猪の皮', 'ウェブウッドの絹腺', '盗まれた補給箱', 'グレイブコーラーの印章',
    '風化した帳簿のページ', '祝福された獣脂', '幽霊のエッセンス', 'モーセンの魔導書', 'フェンブリッジ召集令',
    '沼の徘徊者の毛皮', '失われた隊商の物資', '水浸しの偶像', '寡婦蜘蛛の毒嚢', '錆びた香炉',
    'マイアフェン・トロルの護符', 'グラブジョーの牙', 'グレイブコーラーの暗号', '砦の護り石',
    'ハイウォッチ召喚状', '尾根の追跡者の毛皮', '光る蝋', 'オーガ戦のトーテム', '嵐の核',
    'カジックスの心臓片', 'ワーム教団の命令書', '儀式の経箱', '墓ワームの印章', '祝福された残り火',
    '聖所の鍵片',
  ],
  zones: [
    ['イーストブルック渓谷', '町のレッドブルック元帥を訪ねてください。あなたに頼みたい仕事があります。', ['イーストブルック', '狼の道', '猪の草地', '鏡の湖', 'ウェブウッド', '銅鉱山', '盗賊の野営地', '倒れた礼拝堂']],
    ['マイアフェン湿地', 'フェンブリッジの門で番人フェンウィックに報告してください。', ['フェンブリッジ', '徘徊者の葦原', 'ディープフェンの浅瀬', '寡婦蜘蛛の茂み', '沈んだ礼拝堂', 'トロルの塚', 'グレイブコーラーの野営地', '沈んだ砦']],
    ['ソーンピーク高地', 'テサリー隊長がかろうじてハイウォッチの壁を保っています。', ['ハイウォッチ', '追跡者の尾根', 'ディープロックの巣穴', 'オーガの丘陵', 'ドログマーの戦営', 'ストームクラッグ', 'ワーム教団の天幕', '亡霊の野', '墓ワームの聖所']],
  ],
  dungeons: [
    ['虚ろの墓所', '虚ろの墓所へ降りていきます...', '日の光の下へ戻ります。'],
    ['沈んだ砦', '沈んだ砦の深みへ水をかき分けて進みます...', '水に沈む闇から抜け出します。'],
    ['墓ワームの聖所', '空気が冷たくなります。下で巨大な何かが息をしています...', '山風の中へよろめき戻ります。'],
  ],
};

const ptData: LocaleData = {
  mobs: [
    'Lobo da floresta', 'Velho Greyjaw', 'Javali selvagem', 'Espreitador de Webwood', 'Espreitador Barbatana-de-lodo', 'Escavador rato de túnel',
    'Bandido do Vale', 'Ossos inquietos', 'Gorrak o Impiedoso', 'Espreitador do brejo', 'Murloc de Deepfen', 'Viúva de Mirefen',
    'Mãe da ninhada', 'Morto afogado', 'Troll de Mirefen', 'Grubjaw o Glutão', 'Cultista Gravecaller', 'Invocador Gravecaller',
    'Diácono Voss', 'Rastreador da crista', 'Kobold de Deeprock', 'Ogro de Thornpeak', 'Esmagador ogro', 'Senhor da guerra Drogmar',
    'Elemental de Stormcrag', 'Senhor dos fragmentos Kazzix', 'Zelote do Culto do Wyrm', 'Necromante do Culto do Wyrm',
    'Revenante encouraçado de ossos', 'Cambaleante da cripta', 'Acólito do Vazio', 'Viúva Frio-osso', 'Sacristão Marrow',
    'Morthen o Gravecaller', 'Revenante do Bastião', 'Acólito preso à maré', 'Servo afogado', 'Cavaleiro-comandante Olen',
    'Vael o Mistcaller', 'Guarda-osso do Santuário', 'Draconídeo do Santuário', 'Andarilho de ossos erguido',
    'Korgath o Acorrentado', 'Grande necromante Velkhar', 'Korzul o Gravewyrm',
  ],
  npcRows: [
    ['O Mercador', 'Guardião do Mercado Mundial', 'Bem-vindo ao Mercado Mundial, {className}. Compre de aventureiros do reino ou venda suas próprias mercadorias.'],
    ['Marechal Redbrook', 'Marechal da cidade', 'Mantenha a lâmina por perto, {className}. O Vale já não é o mesmo.'],
    ['Comerciante Wilkes', 'Fornecedor', 'Pão fresco, água limpa e preços honestos. Do que você precisa?'],
    ['Boticária Lin', 'Herbalista', 'Cuidado onde pisa nas matas do leste, amigo.'],
    ['Irmão Aldric', 'Sacerdote do Vale', 'Que a Luz proteja você. Nem os mortos encontram descanso aqui ultimamente.'],
    ['Ferreiro Haldren', 'Armeiro e ferreiro', 'Cuidado com as faíscas, {className}. Bom aço separa uma cicatriz de uma sepultura.'],
    ['Pescador Brandt', 'Velho lobo do mar', 'Grlmurlgrl... perdão, ouvi esses homens-peixe por tempo demais.'],
    ['Capataz Odell', 'Capataz da mina', 'Toda a galeria está cheia desses vermes com vela na cabeça!'],
    ['Guardião Fenwick', 'Guardião de Fenbridge', 'Pare no portão, {className}. Além dos juncos, o pântano mata por nós.'],
    ['Irmão Aldric', 'Sacerdote do Vale', 'Que a Luz mantenha você acima da água, {playerName}. Os mortos deste pântano não dormem: eles vadearam.'],
    ['Fornecedor Hale', 'Fornecedor', 'Botas secas, pão seco e pólvora seca: em Fenbridge, dois de três já é um bom dia.'],
    ['Herbalista Yara', 'Herbalista', 'Cuidado com o matagal a oeste da estrada. As teias estão grossas como velas de navio.'],
    ['Batedora Maren', 'Batedora do marechal', 'Passos silenciosos e uma lâmina curta mantêm você vivo. Fale depressa: preciso voltar aos juncos.'],
    ['Capitã Thessaly', 'Capitã de Highwatch', 'Este muro resiste há duzentos anos, {className}. Não cairá sob minha guarda, embora já gema.'],
    ['Irmão Aldric', 'Sacerdote do Vale', 'Do cemitério da capela ao teto do mundo... a trilha termina aqui. Sinto a montanha ouvindo.'],
    ['Batedora Maren', 'Batedora do marechal', 'Segui os cultistas pelo pântano com você, e a trilha leva até aqui. Os picos são piores, {className}. Fique alerta.'],
    ['Intendente Bree', 'Intendente de Highwatch', 'Lã, biscoito duro e botas ferradas: Highwatch vive dessas três coisas, e estou sem tudo.'],
    ['Armeiro Hode', 'Mestre armeiro', 'A forja está quente e a pedra gira. Se corta, eu vendo.'],
    ['Mestre do saber Caddis', 'Mestre do saber', 'Cuidado com a ardósia solta, {className}. A montanha anda inquieta, e quero saber por quê.'],
  ],
  questTitles: [
    'Lobos à porta', 'O velho lobo', 'Peles de Bristleback', 'A ameaça de Webwood', 'Problemas no lago', 'Ratos na mina',
    'Os mortos inquietos', 'Suprimentos roubados', 'Sussurros no subsolo', 'Os nomes dos mortos', 'Silenciar o chamado',
    'O rito de vínculo', 'Para o Vazio', 'O sino do sacristão', 'A trilha do Gravecaller', 'Bandidos do Vale', 'O chefe',
    'Concentração em Fenbridge', 'Dentes do brejo', 'Peles para a passarela', 'A caravana perdida', 'Deepfen se agita',
    'Ídolos das profundezas', 'De volta aos baixios', 'Seda e veneno', 'A Mãe da ninhada', 'Os mortos afogados',
    'Incensários das profundezas', 'Sem descanso nos juncos', 'Túmulos de Mirefen', 'Fetiche e osso', 'O Glutão',
    'Vestes nos juncos', 'Deter a invocação', 'O diácono do brejo', 'O Bastião Submerso', 'A vergonha do cavaleiro-comandante',
    'O Mistcaller', 'A guarda nos picos', 'Rastreadores na crista', 'O inverno chega a Highwatch', 'Problemas em Deeprock',
    'Cera estranha', 'Ogros nas colinas', 'Totens de guerra', 'A recompensa da capitã', 'Quebrar o acampamento de guerra',
    'Senhor da guerra Drogmar', 'A montanha desperta', 'Núcleos da tempestade', 'O senhor dos fragmentos', 'Cânticos no vento',
    'Ordens de baixo', 'O anel de filactérios', 'Campos de revenantes', 'Ossos da vanguarda', 'Sigilos do Wyrm',
    'Quebrar o selo', 'A voz de baixo', 'O portão do Santuário', 'O guardião acorrentado', 'O grande necromante',
    'Korzul o Gravewyrm',
  ],
  objectiveItems: [
    'Presa do velho Greyjaw', 'Pele eriçada de javali', 'Glândula de seda de Webwood', 'Caixa de suprimentos roubada',
    'Sigilo Gravecaller', 'Página de registro gasta', 'Sebo abençoado', 'Essência espectral', 'Grimório de Morthen',
    'Ordem de concentração de Fenbridge', 'Pele de espreitador do brejo', 'Mercadorias da caravana perdida', 'Ídolo encharcado',
    'Bolsa de veneno de viúva', 'Incensário enferrujado', 'Fetiche troll de Mirefen', 'Presa de Grubjaw', 'Cifra Gravecaller',
    'Pedra guardiã do Bastião', 'Convocação de Highwatch', 'Pele de rastreador da crista', 'Cera brilhante',
    'Totem de guerra ogro', 'Núcleo da tempestade', 'Fragmento do coração de Kazzix', 'Ordens do Culto do Wyrm',
    'Filactério ritual', 'Sigilo do Gravewyrm', 'Brasas abençoadas', 'Fragmento de chave do santuário',
  ],
  zones: [
    ['Vale de Eastbrook', 'Procure o marechal Redbrook na cidade: ele tem trabalho para você.', ['Eastbrook', 'Trilha dos lobos', 'Campo dos javalis', 'Lago Espelho', 'Webwood', 'Mina de cobre', 'Acampamento bandido', 'Capela caída']],
    ['Pântano de Mirefen', 'Apresente-se ao guardião Fenwick no portão de Fenbridge.', ['Fenbridge', 'Juncos dos espreitadores', 'Baixios de Deepfen', 'Matagal das viúvas', 'Capela afogada', 'Túmulos troll', 'Acampamento Gravecaller', 'O Bastião Submerso']],
    ['Alturas de Thornpeak', 'A capitã Thessaly mal segura o muro de Highwatch.', ['Highwatch', 'Crista do rastreador', 'Tocas de Deeprock', 'Colinas ogro', 'Acampamento de guerra de Drogmar', 'Stormcrag', 'Tendas do Culto do Wyrm', 'Campos de revenantes', 'Santuário do Gravewyrm']],
  ],
  dungeons: [
    ['A Cripta Vazia', 'Você desce para a Cripta Vazia...', 'Você volta à luz do dia.'],
    ['O Bastião Submerso', 'Você avança pela água até as profundezas do Bastião Submerso...', 'Você sai da escuridão afogada.'],
    ['Santuário do Gravewyrm', 'O ar fica frio. Algo imenso respira abaixo...', 'Você cambaleia de volta ao vento da montanha.'],
  ],
};

const ruData: LocaleData = {
  mobs: [
    'Лесной волк', 'Старый Серочелюст', 'Дикий кабан', 'Паук-скрытень Вебвуда', 'Илогривый скрытень', 'Копатель Туннельная Крыса',
    'Долинный бандит', 'Беспокойные кости', 'Горрак Безжалостный', 'Болотный хищник', 'Глубинный щелкун', 'Мирефенская вдова',
    'Матка выводка', 'Утопший мертвец', 'Мирефенский тролль', 'Грубджо Обжора', 'Культист Могильного Зова', 'Призыватель Могильного Зова',
    'Дьякон Восс', 'Хребтовый охотник', 'Глубокоскальный туннельщик', 'Огр Терновых Пиков', 'Крушитель Терновых Пиков',
    'Воевода Дрогмар', 'Элементаль Грозового Утеса', 'Осколочный владыка Каззикс', 'Фанатик Культа Вирма',
    'Некромант Культа Вирма', 'Костепанцирный ревенант', 'Склепный шатун', 'Послушник Пустоти', 'Ледяная вдова',
    'Пономарь Марроу', 'Мортен Могильный Зов', 'Ревенант бастиона', 'Приливный послушник', 'Утопший раб',
    'Рыцарь-командор Олен', 'Ваэль Зовущий Туман', 'Костяной страж святилища', 'Драконид святилища',
    'Поднятый костеход', 'Коргат Связанный', 'Верховный некромант Велхар', 'Корзул Могильный Вирм',
  ],
  npcRows: [
    ['Торговец', 'Хранитель мирового рынка', 'Добро пожаловать на Мировой рынок, {className}. Покупайте у искателей приключений всего королевства или выставляйте свои товары.'],
    ['Маршал Редбрук', 'Городской маршал', 'Держите клинок рядом, {className}. Долина уже не та, что прежде.'],
    ['Торговец Уилкс', 'Снабженец', 'Свежий хлеб, чистая вода, честные цены. Что вам нужно?'],
    ['Аптекарь Лин', 'Травница', 'Осторожнее ступайте в восточных лесах, друг.'],
    ['Брат Алдрик', 'Жрец долины', 'Да хранит вас Свет. Даже мертвым здесь нынче нет покоя.'],
    ['Кузнец Халдрен', 'Бронник и оружейник', 'Берегитесь искр, {className}. Хорошая сталь отделяет шрам от могилы.'],
    ['Рыбак Брандт', 'Старый моряк', 'Грлмурлгрл... простите, слишком долго слушал этих рыболюдей.'],
    ['Прораб Оделл', 'Горный прораб', 'Вся выработка кишит этими свечеголовыми паразитами!'],
    ['Страж Фенвик', 'Страж Фенбриджа', 'Стойте у ворот, {className}. За камышом топь убивает за нас.'],
    ['Брат Алдрик', 'Жрец долины', 'Да удержит вас Свет над водой, {playerName}. Мертвые в этой топи не спят: они бредут.'],
    ['Снабженец Хейл', 'Снабженец', 'Сухие сапоги, сухой хлеб и сухой порох: в Фенбридже в хороший день есть два из трех.'],
    ['Травница Яра', 'Травница', 'Берегитесь чащи к западу от дороги. Паутина нынче толста, как парусина.'],
    ['Разведчица Марен', 'Разведчица маршала', 'Тихие шаги и короткий клинок сохраняют жизнь. Говорите быстро, мне пора в камыши.'],
    ['Капитан Тессали', 'Капитан Хайвотча', 'Двести лет эта стена стоит, {className}. При мне она не падет, хотя уже стонет.'],
    ['Брат Алдрик', 'Жрец долины', 'От кладбища часовни до крыши мира... след заканчивается здесь. Я чувствую, как гора слушает.'],
    ['Разведчица Марен', 'Разведчица маршала', 'Я выслеживала культистов в топи рядом с вами, и след привел сюда. Вершины хуже, {className}. Будьте начеку.'],
    ['Квартирмейстер Бри', 'Квартирмейстер Хайвотча', 'Шерсть, сухари и подбитые железом сапоги: Хайвотч держится на этом, а мне не хватает всего.'],
    ['Бронник Ходе', 'Мастер-бронник', 'Горн горяч, точило крутится. Если режет, я это продаю.'],
    ['Хранитель знаний Каддис', 'Хранитель знаний', 'Осторожнее с рыхлым сланцем, {className}. Гора стала беспокойной, и я намерен узнать почему.'],
  ],
  questTitles: [
    'Волки у дверей', 'Старый волк', 'Шкуры щетиноспинов', 'Угроза Вебвуда', 'Беда у озера', 'Крысы в шахте',
    'Беспокойные мертвецы', 'Украденные припасы', 'Шепот внизу', 'Имена мертвых', 'Заглушить зов', 'Обряд связывания',
    'В Пустоту', 'Колокол пономаря', 'След Могильного Зова', 'Бандиты долины', 'Главарь', 'Сбор у Фенбриджа',
    'Зубы топи', 'Шкуры для настила', 'Потерянный караван', 'Глубокая Топь шевелится', 'Идолы глубин', 'Назад на отмели',
    'Шелк и яд', 'Матка выводка', 'Утопшие мертвецы', 'Кадила из глубин', 'Нет покоя в камышах', 'Курганы Мирефена',
    'Фетиш и кость', 'Обжора', 'Робы в камышах', 'Остановить призыв', 'Дьякон топи', 'Затонувший бастион',
    'Позор рыцаря-командора', 'Зовущий Туман', 'Дозор на пиках', 'Охотники на хребте', 'Зима идет в Хайвотч',
    'Беда Глубокоскалья', 'Странный воск', 'Огры у предгорий', 'Тотемы войны', 'Награда капитана',
    'Сломать военный лагерь', 'Воевода Дрогмар', 'Гора просыпается', 'Ядра бури', 'Осколочный владыка',
    'Песнопения на ветру', 'Приказы снизу', 'Кольцо филактерий', 'Поля ревенантов', 'Кости авангарда',
    'Сигилы Вирма', 'Сломать печать', 'Голос снизу', 'Врата святилища', 'Связанный страж', 'Верховный некромант',
    'Корзул Могильный Вирм',
  ],
  objectiveItems: [
    'Клык старого Серочелюста', 'Щетинистая кабанья шкура', 'Шелковая железа Вебвуда', 'Украденный ящик припасов',
    'Сигил Могильного Зова', 'Выветренная страница книги учета', 'Благословенное сало', 'Призрачная эссенция',
    'Гримуар Мортена', 'Приказ о сборе в Фенбридже', 'Шкура болотного хищника', 'Товары пропавшего каравана',
    'Размокший идол', 'Ядовитый мешочек вдовы', 'Ржавое кадило', 'Фетиш тролля Мирефена', 'Клык Грубджо',
    'Шифр Могильного Зова', 'Обереговый камень бастиона', 'Призыв Хайвотча', 'Шкура хребтового охотника',
    'Светящийся воск', 'Боевой тотем огра', 'Ядро бури', 'Осколок сердца Каззикса', 'Приказы Культа Вирма',
    'Ритуальная филактерия', 'Сигил Могильного Вирма', 'Благословенные угли', 'Осколок ключа святилища',
  ],
  zones: [
    ['Истврукская долина', 'Найдите в городе маршала Редбрука: у него есть для вас работа.', ['Истврук', 'Волчья тропа', 'Кабанья поляна', 'Зеркальное озеро', 'Вебвуд', 'Медный рудник', 'Лагерь бандитов', 'Павшая часовня']],
    ['Мирефенская топь', 'Доложите стражу Фенвику у ворот Фенбриджа.', ['Фенбридж', 'Камыши хищников', 'Отмели Глубокой Топи', 'Вдовья чаща', 'Утонувшая часовня', 'Курганы троллей', 'Лагерь Могильного Зова', 'Затонувший бастион']],
    ['Терновые высоты', 'Капитан Тессали едва удерживает стену Хайвотча.', ['Хайвотч', 'Хребет охотника', 'Норы Глубокоскалья', 'Огрские предгорья', 'Военный лагерь Дрогмара', 'Грозовой Утес', 'Шатры Культа Вирма', 'Поля ревенантов', 'Святилище Могильного Вирма']],
  ],
  dungeons: [
    ['Пустая крипта', 'Вы спускаетесь в Пустую крипту...', 'Вы выбираетесь обратно к дневному свету.'],
    ['Затонувший бастион', 'Вы спускаетесь в Затонувший бастион по воде...', 'Вы выбираетесь из тонущей тьмы.'],
    ['Святилище Могильного Вирма', 'Воздух холодеет. Внизу дышит нечто огромное...', 'Вы пошатываясь выходите на горный ветер.'],
  ],
};

export const phase9 = {
  en: makeEnglishPhase9(),
  es: makeLocalePhase9(esData, esText),
  es_ES: {} as Phase9Translations,
  fr_FR: makeLocalePhase9(frData, frText),
  fr_CA: {} as Phase9Translations,
  en_CA: makeEnglishPhase9(),
  it_IT: makeLocalePhase9(itData, itText),
  de_DE: makeLocalePhase9(deData, deText),
  zh_CN: makeLocalePhase9(zhCnData, zhCnText),
  zh_TW: makeLocalePhase9(zhTwData, zhTwText),
  ko_KR: makeLocalePhase9(koData, koText),
  ja_JP: makeLocalePhase9(jaData, jaText),
  pt_BR: makeLocalePhase9(ptData, ptText),
  ru_RU: makeLocalePhase9(ruData, ruText),
};

phase9.es_ES = phase9.es;
phase9.fr_CA = phase9.fr_FR;
