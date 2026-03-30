/**
 * Dokumentace polí vracených S/D strategií v trade.zoneMeta.
 * Synchronizovat se strategií: strategies/sd_zone_strategy/main.py (meta dict u limitu).
 */
export const SD_ZONE_META_FIELDS: { key: string; description: string }[] = [
  { key: "zoneKey", description: "Interní klíč sloučené zóny (MTF merge)." },
  { key: "zoneName", description: "Demand nebo Supply." },
  { key: "primaryTf", description: "Hlavní timeframe zóny po merge." },
  { key: "mergedTfs", description: "Seznam TF v clusteru (pole řetězců)." },
  { key: "baseLength", description: "Počet barů base modulu S/D u pivotu." },
  { key: "impulseScore", description: "Skóre síly impulsu ze zóny (1–4)." },
  { key: "inducementCount", description: "Počet nalezených inducement úrovní." },
  { key: "inducementPoints", description: "Body inducementu (váhy typů)." },
  { key: "hadInducement", description: "true pokud inducementCount > 0." },
  { key: "hasTouch", description: "Zóna měla dotyk ceny před armováním (modul)." },
  { key: "hasGap", description: "Gap u pivotu (modul)." },
  { key: "zoneAgeBars", description: "Stáří zóny na TF: d_idx − pivotIdx." },
  { key: "pivotIdx", description: "Index pivotu na OHLC TF zóny." },
  { key: "entryModel", description: "limit | market_momentum — zvolený model vstupu (panel strategie)." },
  { key: "entryStyle", description: "limit_edge | limit_mid | market_momentum — odvozený / legacy styl vstupu." },
  { key: "entryMode", description: "edge | mid | pct — režim limitu (u limit_edge)." },
  { key: "entryPct", description: "Použito při entry_mode pct (0–1)." },
  { key: "entryLimit", description: "Plánovaná cena vstupu (limit nebo close u market momentum)." },
  { key: "stopPrice", description: "Počáteční stop." },
  { key: "targetPrice", description: "Cíl z target_rr × riziko (entry vs stop)." },
  { key: "targetRr", description: "Parametr target_rr použitý pro výpočet cíle." },
  { key: "preEntryDipPct", description: "Hloubka proti zóně po odchodu před vstupem (% výšky zóny)." },
  { key: "zoneHeight", description: "Výška zóny (value_high − value_low) v ceně." },
  { key: "zoneSizeBucket", description: "1 = malá … 3 = velká vs. běžící historie výšek zón v běhu." },
  { key: "trapZone", description: "true pokud cena po odchodu znovu zasáhla do zóny (retest hranice)." },
  { key: "zoneTimeframes", description: "Čárkou oddělené TF z param. strategie." },
  { key: "execTimeframe", description: "Exekuční TF (řetězec z parametrů)." },
];

/** Užitečná pole obchodu z engine (RunResponse.trades) pro vlastní metriky. */
export const TRADE_FIELDS_FOR_ANALYTICS: { key: string; description: string }[] = [
  { key: "pnl", description: "Realizovaný PnL obchodu v měně účtu." },
  { key: "type", description: "buy | sell (směr vstupu)." },
  { key: "entryPrice", description: "Vstupní cena." },
  { key: "exitPrice", description: "Výstupní cena." },
  { key: "entryDate", description: "Datum/čas vstupu (ISO)." },
  { key: "exitDate", description: "Datum/čas výstupu (ISO)." },
  { key: "barsHeld", description: "Počet držících barů." },
  { key: "holdingMinutes", description: "Držení v minutách (pokud engine počítá)." },
  { key: "mfe", description: "Maximum favorable excursion (peníze)." },
  { key: "mae", description: "Maximum adverse excursion (peníze)." },
  { key: "fees", description: "Poplatky." },
  { key: "slippageCost", description: "Náklad skluzu." },
  { key: "entryReason", description: "Důvod vstupu (pokud vyplněno)." },
  { key: "exitReason", description: "Důvod výstupu (pokud vyplněno)." },
  { key: "zoneMeta", description: "Objekt výše — metadata S/D strategie." },
];
