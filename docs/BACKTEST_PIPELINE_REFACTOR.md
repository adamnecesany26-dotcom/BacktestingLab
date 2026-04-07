# Refactoring: předfiltrované moduly, rychlý backtest, View z cache, Results

Tento dokument je **jednotný plán** architektury požadovaného uživatelem. Slouží jako smlouva mezi produktem a implementací a jako **záchranný kontext** při ztrátě historie chatu.

---

## 0. Cíl a principy

### 0.1 Problém dnes

- Moduly (`get_zones`, Swing HL) se volají v kontextu, který se **liší mezi View, engine moduleOutputs a strategií** (MTF merge, délka okna, rostoucí `exec_df` v Backtraderu).
- Backtest je pomalý, protože se na **každém baru** nebo opakovaně přepočítává těžká logika.
- Výsledky a Detailed neodpovídají očekávání „co vidím = ve co strategie věří“.

### 0.2 Cílový stav (laicky)

1. **Jednou** projedeme celý datový soubor (nebo dohodnuté okno), vypočteme **trvalé artefakty** (H/L + trend + BOS, pak S/D zóny s životním cyklem).
2. Artefakty **uložíme** na backendu (soubory + metadata + verze vstupů).
3. **View** jen **čte** artefakty a kreslí podle TF — **nepřepočítává**.
4. **Strategie / engine** během backtestu **nemusí volat Python moduly** pro strukturu — jen **prochází předpočítané události** (touch, aktivní zóna, …) → backtest **minuty** i na 16+ letech.
5. **Změna kódu modulu nebo dat** → invalidace / znovu spuštění „action“ (precompute) přes UI (**Save results** / **Rebuild cache**).

**K bodu 4 (aktuální implementace vs cíl):** backtest s `use_sd_artifacts=1` **nepočítá** S/D modul v každém baru, ale **stále používá** stávající logiku strategie nad sloučenými zónami z Parquet (viz changelog 1.4 — *eventová O(n) fronta zatím ne*). Plná **událostní** smyčka z §4.1 zůstává rozšířením do budoucna.

### 0.3 Klíčová terminologie

| Termín | Význam |
|--------|--------|
| **Artifact** | Uložený výstup precomputu (JSON/Parquet + manifest). |
| **Dataset key** | `(instrument, data_file fingerprint nebo cesta, rozmezí času Volitelně)`. |
| **Module digest** | Hash zdrojového kódu modulu + verze schématu artefaktu. |
| **Precompute job** | Dávková akce: vstup = data + parametry modulu → výstup = artefakty. |
| **TF ladder** | 1Mo → 1W → 1D → 4H → 1H → 30m (pořadí dle zadání; musí být explicitně v konfiguraci). |

---

## Fáze 1 — Úložiště artefaktů a invalidace

### 1.1 Rozhodnutí

- Kořen např. `{project}/.feature_cache/` nebo `{project}/.backtest_artifacts/` (nekomitovat velké binárky do gitu; `.gitignore`).
- Struktura složek (návrh):

```
.backtest_artifacts/
  manifest.json                    # globální index (volitelně)
  {dataset_id}/
    hl/
      v1/
        manifest.json              # dataset_id, data_fingerprint, module_digests, tf list, created_at
        1Mo.parquet
        1W.parquet
        ...
        bos_1Mo.parquet
        trend_1Mo.parquet
    sd/
      v1/
        manifest.json
        zones.parquet              # nebo zones.jsonl pro jednoduchost v1
```

### 1.2 Manifest (povinná pole)

- `schema_version` (číslo; při breaking změně bump).
- `data_file`, `host_dataset_fingerprint` (stejný koncept jako dnes v engine).
- `time_range_start`, `time_range_end` (načtené z datasetu po filtrování „let“).
- `hl_module_digest`, `sd_module_digest` (hash + případně PATH).
- `params_snapshot` (JSON pro repro — H/L params, S/D params).
- Seznam TF, které byly počítány.

### 1.3 Invalidace

- **Data změna** (jiný fingerprint / mtime souboru) → starý `dataset_id` nepoužitelný; UI nabídne přepočet.
- **Změna kódu modulu** (jiný digest) → přepočet dotčené větve (H/L nutné před S/D).
- Explicitní **uživatelský Rebuild** v UI.

### 1.4 Context recovery (ztráta kontextu)

- **Co je hotové:** konvence cesty, manifest, pravidla invalidace.
- **Závislosti:** žádné na strategii.
- **Riziko:** Windows path + paralelní joby → mutex na `dataset_id` složku.
- **Test:** stejná data 2× → stejný digest → cache hit; po úpravě `Swing_HL.py` → miss.

---

## Fáze 2 — H/L precompute pipeline

### 2.1 Vstupy

- Cesta k OHLC (parquet/csv/txt — stejné loadery jako engine kde možné).
- Seznam TF: `1Mo, 1W, 1D, 4H, 1H, 30m` (konfigurovatelné pole, ne magické řetězce v 10 místech).
- Parametry modulu (VIEW_PARAMS / nový `HL_PRECOMPUTE_PARAMS`).

### 2.2 Logika (požadavky uživatele) — Major multidědičnost

- Na **každém TF** identifikovat **Swing H/L body** na plné sérii po resamplu daného TF.
- **Major** swing úrovně platí jen v tomto smyslu:
  - **1M (1MO):** žádné major úrovně.
  - **1W:** major body pouze ze zdroje **1M**.
  - **1D:** major body ze zdrojů **1M** a **1W**.
  - **4H, 1H, 30m:** major body ze **všech** zdrojů **1M + 1W + 1D** (intraday „nejnižší“ major vrstva zahrnuje denní úrovně i hrubší).

Tabulku drží [`backend/app/services/hl_artifact_spec.py`](../backend/app/services/hl_artifact_spec.py) (`MAJOR_SOURCES_BY_CHART_TF`, `PRECOMPUTE_TF_LADDER`).

- **Internal** H/L z **child** TF (jemnější) — specifikovat propojení časové osy (implementace fáze 2).
- **BOS** úrovně: stejný precompute pass, uložit per TF nebo agregovaně podle modulu.
- **Trend** (skóre / režim / směr): uložit časové řady nebo segmenty (formát domluvit: např. `trend_4h.parquet`: `timestamp, score, state`).

### 2.3 Výstupy (artefakty)

- Pro každý TF soubor(ech) s body: swing high/low, major high/low, internal high/low, případně odkazy na `bar_index` a `iso_time`).
- BOS a trend samostatné soubory nebo sloupce v jednom — podle velikosti.

### 2.4 Context recovery

- **Vstup:** Fáze 1 úložiště.
- **Výstup:** `hl/*/manifest.json` + parquet.
- **Major na 1M:** žádné; na 1W/1D/intradenních viz §2.2 a `hl_artifact_spec.py`.
- **Test:** porovnání výstupu na krátkém okně s dnešním `Swing_HL.get_line/detect` (sanity), ne nutně bit-perfect.

---

## Fáze 3 — S/D precompute pipeline

### 3.1 Závislost

- **Bez H/L artefaktů → ERROR** (uživatelsky srozumitelná zpráva: „Spusť nejdřív H/L precompute“).

### 3.2 Vstupy

- OHLC (stejný dataset key jako H/L).
- Načtené H/L + BOS + trend artefakty.
- Parametry S/D modulu.

### 3.3 Výstup zóny (povinná pole — dle zadání)

Pro každou zónu uložit minimálně:

| Pole | Popis |
|------|--------|
| `zone_id` | Stabilní ID v rámci datasetu+verze |
| `kind` | supply / demand |
| `born_at` | čas vzniku |
| `died_at` | čas zániku (nullable dokud žije na konci sample) |
| `price_low`, `price_high` | meze zóny |
| `range_size` | rozpětí |
| `base_length` | int |
| `has_inducement` | bool |
| `impulse_score` | číselné zhodnocení |
| `touch1` | `{ at, price }` první touch po departure |
| `touch2` | `{ at, price }` druhý touch po dalším departure |
| `max_age_before_death` | např. v běžných barech nebo v čase |
| `with_trend` | bool (nebo enum supply/demand vs trend) |

### 3.4 Pravidla zániku (pouze tato — striktně)

1. Po **druhém** touch **s rezervou** (definovat „rezerva“: ATR, % zóny, počet barů?)
2. **Cena extrémně daleko** od zóny (parametr vzdálenosti)
3. **Close** pod zónou (demand) / nad zónou (supply)
4. **Konflikt** nové zóny na podobném místě/čase → **novější má přednost** (definovat overlap v čase + ceně)

### 3.5 Context recovery

- **Schema version** v manifestu S/D; při změně pravidel zániku bump.
- **Idempotence:** stejný vstup → stejné `zone_id` (nebo hash z geometrie+čas).
- **Test:** unit testy na syntetických 20 svících pro každé pravidlo zániku.

---

## Fáze 4 — Engine a strategie: konzumace artefaktů

### 4.1 Nový backtest flow

1. Na začátku runu: `dataset_id` + načtení SD artefaktu (a případně H/L pro validaci).
2. Pokud chybí → **400** s jasnou instrukcí (UI: tlačítko Build).
3. **Backtrader** iteruje **exec TF** bary synchronně s časovou osou artefaktu:
   - předpočítaný seznam **událostí**: např. `TOUCH1`, `TOUCH2`, `ZONE_DEATH`, `ZONE_ACTIVE_WINDOW`.
4. Strategie je **tenká vrstva**:
   - konfigurace z menu (viz fáze 6),
   vstup na 1. nebo 2. touch,
   hrana/střed zóny,
   SL mapování,
   RRR,
   filtrace zón.

### 4.2 Logika vstupu (uživatelský popis → spec)

- „**Touch zóny + zóna aktivní** → potvrzení entry“
- **Entry price** = hrana zóny (dle volby edge/mid/pct)
- **Stop** = druhá hrana nebo varianty z menu
- **TP** = `entry ± (risk) * RRR` s korektním směrem long/short

### 4.3 Výkon

- Očekávání: Jedna pass O(n) přes bary + binární vyhledávání v událostech → **řády minut** na dlouhé historii.

### 4.4 Context recovery

- Starý kód strategie (`get_zones` v `next`) se **nepoužívá** v novém režimu, pokud je zapnuto `use_sd_artifacts` a runner nastaví `USE_SD_ARTIFACTS` + cestu k Parquet (jinak běží legacy větev).
- Zachovat dočasně legacy path pro rollback.

---

## Fáze 5 — View: pouze čtení artefaktů

### 5.1 Chování

- **Žádný** přepočet v `/api/view` pro H/L a S/D při `use_artifacts: true`.
- Request: `data_file`, `years`, `chart_timeframe`, volitelně časové okno (`start_iso` / `end_iso`); volitelně **`artifact_dataset_id`** (jinak se `dataset_id` odvodí stejně jako u precomputu z fingerprintu + years).
- Odpověď: OHLC (slice) + markery/zóny z artefaktu **přemapované** na osu grafu (`artifact_status`, `artifact_banner`, `dataset_id`).

### 5.2 H/L View

- Vrstvy: Swing, Major, Internal, BOS, trend — přepínače ve **viditelnosti** (stejný koncept jako dnes „Hide & Show“).

### 5.3 S/D View

- Zóny supply/demand.
- **Touch1** = oranžová, **Touch2** = červená (barva sjednotit v design tokenech).
- Text v zóně: `Impulse: x, Base len: x, Induce: yes/no` (+ případně další zkráceně).

### 5.4 Context recovery

- Fallback: pokud artefakt chybí → prázdný graf + banner „Spusť Save results / Build“.
- View demo režimy buď zrušit, nebo omezit jen na „slice OHLC bez modulů“.

---

## Fáze 6 — UI workflow a tlačítka

### 6.1 Nové akce

- Vedle **View**: **Save results** (nebo **Build features**) — spustí:
  1. H/L precompute (pokud needed)
  2. S/D precompute (pokud needed)
- Indikátor stavu: `Fresh` / `Stale (data)` / `Stale (code)` / `Building…` / `Error`.

### 6.2 Konfigurace S/D strategie (v BacktestSettings)

Uživatel požaduje:

- Vstup jen na **1. nebo 2. touch**
- **Entry styl:** hrana / střed zóny (+ případně pct)
- **Stop:** druhá hrana / hrana + % / 75 % zóny / 50 % zóny (směrově specifikovat pro long/short)
- **RRR** číslo
- **Filtry zón:** max base length, inducement ano/ne, max stáří (default bez limitu), pouze **with trend** (range = obě)

### 6.3 Context recovery

- Job může běžet async (Redis/Celery zjednodušeně nejdřív **sync** s progress v UI pro MVP).
- Práva: stejná jako run (Firebase actor).

---

## Fáze 7 — Refactoring Results

### 7.1 Detailed záložka

- **View mód identický** s hlavním View (stejný render komponent / stejný datový formát).
- Navíc overlay **entry/exit** z výsledku backtestu (každý run vrátí kompletní seznam obchodů s cenami a časy).
- Jedna codebase pro „kreslení z artefaktu“ — Detailed jen přidá trade layer.

### 7.2 Stat bloky / metriky

- **Méně USD absolutně**, více:
  - **%** return, drawdown %, win rate
  - **R-multiple** distribuce (průměr, medián, tail)
- Definovat přesný set KPI (samostatný poddokument v PR).

### 7.3 Equity

- **Dva grafy pod sebou:**
  1. Equity v **USD** (nebo měně účtu)
  2. Equity v **R-multiple** (kumulativně normalizované podle risk na obchod)

### 7.4 Context recovery

- Typy `Trade` v `shared/types`: volitelně `initialRiskUsd`, `tradeR` (engine je může doplnit; UI zatím odvozuje R ze `zoneMeta` + `pnl`, kde jde).
- `ResultsView`: equity + R, StatBlocks, Detailed + volitelné vrstvy z artefaktů (viz changelog 1.7).

---

## Fáze 8 — Migrace, rollout, rizika

### 8.1 Pořadí dodání (doporučené)

1. Fáze 1 (úložiště) + jeden ruční skript „build hl“ bez UI.
2. Fáze 2 H/L výstup + validace na 1 instrumentu.
3. Fáze 3 S/D výstup + validace pravidel zániku.
4. Fáze 6 minimální UI (Build) + status.
5. Fáze 5 View read-only.
6. Fáze 4 engine/strategie.
7. Fáze 7 Results.

### 8.2 Rizika

- **Správnost** životního cyklu zóny složitější než dnešní `get_zones`; nutné grafické golden testy.
- **Velikost artefaktů** pro 16 let 30m → parquet + komprese.
- **Konzistence času** (ISO, timezone) — stejný postup jako u Vás v `detailedTradesWindow` / engine.

### 8.3 Co zůstane z legacy

- Dočasně ponechat starý runner path pod feature flagem pro porovnání.
- **Parametr strategie** `use_sd_artifacts` (`0` = live moduly `get_zones` / merge v paměti, `1` = `zones.parquet` pod `dataset_id`). Runner vždy přepíše `USE_SD_ARTIFACTS` a `SD_ARTIFACT_ZONES_PATH` v prostředí workeru podle tohoto parametru, aby **host shell / `.env` nemohly omylem zapnout artefakty** u legacy runu.
- Chybí-li Parquet při `use_sd_artifacts=1`, run končí srozumitelnou chybou (viz `runner.py`); není tichý fallback na legacy.

### 8.4 Rollback a provoz

| Situace | Akce |
|--------|------|
| Porovnání s chováním před artefakty | V panelu strategie `use_sd_artifacts = 0` a běžný backtest. |
| Artefakty zastaralé (data / kód) | Build znovu (fáze 6) nebo dočasně `use_sd_artifacts = 0`. |
| Korektnost vs. starý životní cyklus zóny | Dva runy stejné konfigurace: 0 vs 1; srovnání equity / počtu obchodů (očekávej rozdíly — artefakt má jiné pravidla zániku v precomputu). |
| Velké `.parquet` (16+ let jemný TF) | `.backtest_artifacts` v `.gitignore`; případně úklid starých `dataset_id` ručně. |
| Čas / timezone | Stejný dataset a ISO pravidla jako View a `detailedTradesWindow`; při rozdílu zkontrolovat fingerprint a `years`. |

---

## Příloha A — Checklist „ztráta kontextu“ (per fáze)

| Fáze | Hlavní soubory (očekávané) | Co nezlomit |
|------|----------------------------|-------------|
| 1 | `.backtest_artifacts/`, [`artifact_store.py`](../backend/app/services/artifact_store.py), root `.gitignore` | Engine data path security |
| 2 | `hl_precompute.py` (nový), `hl_artifact_spec.py`, `Swing_HL.py` | Parita TF + Major tabulka |
| 3 | [`sd_precompute.py`](../backend/app/services/sd_precompute.py), [`sd_artifact_spec.py`](../backend/app/services/sd_artifact_spec.py), `examples/sd_zones.py` | H/L manifest povinný; stejný `dataset_id` |
| 4 | [`runner.py`](../backend/app/services/runner.py) (`USE_SD_ARTIFACTS` / `SD_ARTIFACT_ZONES_PATH`), [`sd_zone_merge.py`](../backend/app/services/sd_zone_merge.py) (`build_merged_sd_zones_from_artifact`), [`sd_zone_strategy/main.py`](../strategies/sd_zone_strategy/main.py) | Broker, commission; `dataset_id` musí sedět s precomputem |
| 5 | [`view.py`](../backend/app/api/view.py), [`view_artifacts.py`](../backend/app/services/view_artifacts.py), `StrategyViewChart.tsx`, [`api.ts`](../frontend/lib/api.ts) | OAuth / API; `dataset_id` = stejný výpočet jako precompute |
| 6 | [`artifacts.py`](../backend/app/api/artifacts.py), [`artifact_api_service.py`](../backend/app/services/artifact_api_service.py), `StrategyViewChart.tsx`, [`api.ts`](../frontend/lib/api.ts), [`sd_zone_strategy/main.py`](../strategies/sd_zone_strategy/main.py) (PARAMS 6.2) | Build může trvat minuty — později async job; zámky precompute |
| 7 | `ResultsView.tsx`, `AnalyticsView.tsx`, typy | Firestore save |

---

## Příloha B — Otevřené otázky k dořešení v implementaci

1. **Rezerva po druhém touch** — přesná definice (ATR okno? pevný počet barů?).
2. **„Extrémně vzdálená“ cena** — stejné jako dnešní `zone_trading_far_*` nebo nový parametr?
3. **Trend souladu** — zdroj pravdy: precomputed trend série vs. okénkové skóre?
4. **Concurrent builds** — singleflight na `dataset_id`.

---

## Příloha C — Finální audit plánu (stav vs 8 fází)

**Závěr: plán není splněn na 100 %.** Jádro pipeline (úložiště, precompute H/L a S/D, View z cache, build v UI, backtest z Parquet, Results vylepšení, rollout) je **nasazeno v repositáři**. Níže odchylky od „ideálního“ znění §0.2 / §4.1 / §3.4.

| Fáze | Stav | Shrnutí |
|------|------|---------|
| **1** | **Splněno** | [`artifact_store.py`](../backend/app/services/artifact_store.py), `.backtest_artifacts/` v [`.gitignore`](../.gitignore), manifesty per `dataset_id` pod `hl/v1`, `sd/v1`. Globální index v kořeni artefaktů zůstává volitelný. |
| **2** | **Splněno (MVP)** | [`hl_precompute.py`](../backend/app/services/hl_precompute.py), [`hl_artifact_spec.py`](../backend/app/services/hl_artifact_spec.py) (Major dle §2.2), zámky, CLI. |
| **3** | **Částečně** | [`sd_precompute.py`](../backend/app/services/sd_precompute.py) + `zones.parquet`; závislost na H/L manifestu. Přísná pravidla zániku §3.4 a syntetické testy „20 svíček na pravidlo“ nejsou ve všech bodech dokončené jako samostatná sada (viz changelog 1.3 odvozené pole). |
| **4** | **Částečně** | Runner + strategie: `use_sd_artifacts`, načtení Parquet, merge přes [`sd_zone_merge.py`](../backend/app/services/sd_zone_merge.py). **Chybí** popsaný model **předpočítaných událostí** (TOUCH1/2, ZONE_DEATH, …) a O(n) fronta z §4.1 — stáj aktuálně odpovídá „stejný stavový stroj jako u live get_zones“ (changelog 1.4). |
| **5** | **Částečně (MVP)** | [`view_artifacts.py`](../backend/app/services/view_artifacts.py) + `POST /api/view` s `use_artifacts`; UI [`StrategyViewChart.tsx`](../frontend/components/StrategyViewChart.tsx). Barvy touch / texty v zónách: ok, plné „design tokeny“ jako jednotný theme file nejsou povinně vymáhány. |
| **6** | **Splněno (MVP)** | [`artifacts.py`](../backend/app/api/artifacts.py), [`artifact_api_service.py`](../backend/app/services/artifact_api_service.py), build + stav ve View; PARAMS 6.2 ve strategii (viz changelog 1.6). Async job může přijít později. |
| **7** | **Splněno (MVP)** | Dvojí equity, R-metriky, Detailed + artefakty (`ResultsView`, `tradeMetrics`, …). Samostatný KPI poddokument volitelný. |
| **8** | **Splněno** | §8.3–8.4, sanitizace `USE_SD_ARTIFACTS` v runneru při legacy runu. |

**Doporučené další kroky pro „100 %“ dle původního spekulativního rozsahu:** (1) event-driven konzumace zón v engine §4.1, (2) doplnit testovatelnost pravidel zániku §3.4, (3) případný globální artifact index / singleflight buildů (Příloha B).

---

*Verze dokumentu: 1.9 — finální audit osmi fází (Příloha C); opravy §0.2, §5.1, §7.4, Příloha A řádek 8.*

### Changelog

- **1.9** — **Finální audit:** Příloha C (tabulka stavu fází 1–8); upřesnění §0.2 (aktuální vs cílový backtest), §5.1 (`artifact_dataset_id`, ne `artifact_manifest_id`), §7.4 (`initialRiskUsd` / `tradeR`); doplněn řádek fáze 8 v Příloze A.
- **1.8** — **Fáze 8:** `runner.py` při `use_sd_artifacts=0` nastaví `USE_SD_ARTIFACTS=0` a odebere `SD_ARTIFACT_ZONES_PATH` z env předaného enginu (ochrana před únikem z host OS). Doplněny §8.3–8.4 (rollback, provoz) a řádek tabulky Přílohy A pro fázi 8.
- **1.7** — Results (`ResultsView`): záložka Equity — druhý graf **kumulativního R** (odhad ze `zoneMeta` + PnL, kde jde); metriky — blok **R-multiple (obchody)** v rozbalitelných blocích; pořadí statů upřednostňuje % a odkládá USD; Detailed — volitelné **vrstvy z `.backtest_artifacts`** (stejný tok jako View: `POST /api/view` + `use_artifacts`). Typy `Trade`: volitelně `initialRiskUsd`, `tradeR`. Soubory: `tradeMetrics.ts`, `viewArtifactAdapter.ts`, `StatBlocks.tsx`, `EquityChart.tsx`, `sdZoneMetaHelp.ts`.
- **1.6** — UI: ve View řádek „Cache (dataset)“ — badge (Fresh / Stale / missing H|S/D / Error), **Build features** (sync H/L → S/D), **Obnovit stav**. API: `POST /api/artifacts/status`, `POST /api/artifacts/build` (stejné `data_file` + `years` jako View; `zone_timeframes` z otevřené strategie při synchronizaci). Služba [`artifact_api_service.py`](../backend/app/services/artifact_api_service.py). Strategie: PARAMS + panel pro `entry_min_touch_tier`, filtry zón (`max_zone_age_bars`, `allow_zones_with_touch`, impulse, `use_sd_artifacts`, `sd_artifact_only_with_trend`); merge artefaktu přidává `has_touch2`. Test `test_artifacts_api.py`. **MVP:** varianty stopu „75 % / 50 % zóny“ z plánu zatím jen přes stávající `stop_offset_pct`; plný enum stopů lze doplnit později.
- **1.5** — View: POST `/api/view` s `use_artifacts: true` načte H/L Parquet (`swings` / `internals` / `majors` / `bos` / `trend`) pro TF z manifestu odpovídající `chart_timeframe` (fallback první TF z žebříčku v manifestu) a přemapuje markery na osu `df_chart`; S/D z `sd/v1/zones.parquet` přes `zone_dict_from_artifact_row` + hranice zón = indexy aktuálního grafu; odpověď obsahuje `artifact_status`, `artifact_banner`, `dataset_id`. UI: zaškrtnutí „H/L + S/D z cache“ v `StrategyViewChart`. Testy: `backend/tests/test_view_artifacts.py`.
- **1.4** — Backtest: `use_sd_artifacts=1` v parametrech strategie → runner ověří `zones.parquet` pod stejným `dataset_id` jako run; env `USE_SD_ARTIFACTS` + `SD_ARTIFACT_ZONES_PATH`. Strategie načte Parquet v `start()` a použije `build_merged_sd_zones_from_artifact` (ISO remap na indexy aktuálního `zoh`). Parametr `sd_artifact_only_with_trend`. Parquet má `range_start_at` / `range_end_at`. Eventová O(n) fronta zatím ne — stejný obchodní stavový stroj jako u live `get_zones`.
- **1.3** — S/D precompute: vyžaduje `hl/v1/manifest.json` (stejný `dataset_id`), volitelná shoda `hl_module_digest`; volá `examples.sd_zones.get_zones` na OHLC resamplovaném podle `zone_timeframes`; výstup `sd/v1/zones.parquet` + manifest (`sd_module_digest` z `examples/sd_zones.py`, odkaz na H/L manifest); `with_trend` z `hl/v1/{tf}_trend.parquet` tam, kde TF existuje v H/L artefaktu; `touch2_*` zatím null; zámek `.sd_precompute.lock`; CLI `python -m app.services.sd_precompute`. Odvozené `died_at` / `max_age_before_death` z `end_idx` (v1 aproximace).
- **1.2** — Pipeline H/L precompute: načtení OHLC (stejné ořezání jako view), žebříček `PRECOMPUTE_TF_LADDER`, Parquet (`swings`, `internals`, `majors`, `bos`, `trend` z `get_line`) v `hl/v1/`, manifest; jemnější TF než nativní krok se přeskočí; zámek `.hl_precompute.lock`; CLI `python -m app.services.hl_precompute`. Měsíční resample v `sd_zone_merge.pandas_rule_for_zone_tf` (`1M` → `1ME`).
- **1.1** — Upřesnění Major H/L podle TF; přidán kód fáze 1 (`artifact_store`, `hl_artifact_spec`, testy).
- **1.0** — výchozí plán.
