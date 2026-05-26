# Audit: S/D zóny (BOS, swingy) — `sd_zones_hl_indicator.pine`

Jednostránkový přehled podle rolí. **Závěry o edge** vyžadují vlastní měření (walk-forward, out-of-sample); níže jsou měřitelné metriky a rizika.

## Měřitelné metriky (doporučení)

| Metrika | Proč |
|--------|------|
| Podíl zón **STALE** (pre-READY purge) vs celkový počet vzniků | Kolik „neakčních“ zón systém odfiltruje. |
| **READY včas**: medián `readyBar − bornBar` | Lag mezi vznikem zóny a obchodovatelným odchodem. |
| **MFE po READY** (×ATR) do touch/konce | Síla reakce po splnění READY. |
| Počet obchodů / měsíc a průměrný **R** podle režimu READY (Close vs Close+knot) | Kompromis rychlost vs šum. |

## Role 1 — Institucionální trader

- **Smysl:** S/D + BOS je **heuristika struktury**, ne samostatná alfa. Edge typicky sedí v kontextu (likvidita, session, korelace, režim volatility).
- **Udržitelnost:** Bez explicitních pravidel „okno akce“ po READY vznikají pozdní signály; STALE a MFE metriky to adresují.
- **Multi-instrument / TF:** ATR normalizace pomáhá; defaulty stejně kalibrovat podle třídy aktiva (FX / index / crypto).

## Role 2 — Prop firm trader

- **Challenges:** Často limitují **drawdown** a **frekvenci** — pozdní READY zhoršuje plánování vstupu v časově omezeném okně evaluace.
- **STALE purge:** Snižuje počet zón, u kterých „hlavní pohyb“ už proběhl před obchodovatelným READY.

## Role 3 — Retail trader

- **Vnímání:** Pending (šedá) vs READY (plná barva) musí být jasné; volitelný **Close+knot** READY zrychluje reakci za cenu více šumu.
- **Transparentnost:** Filtry v skupině „Metadata“ ovlivňují jen **zobrazení**, ne nutně CREATE (stejný vzor jako score SHOW vs CREATE).

## Role 4 — Quant

- **Hypotéza:** Každá událost musí mít definici na baru: vznik zóny, READY (Close / knot), touch po READY, STALE sekvence, zánik (`zEndReason`).
- **Oddělení:** Detekce vs vizuální filtry — aby backtest a graf mluvily stejnou řečí.

## Role 5 — Statistik / matematik

- **Riziko přeučení:** Mnoho vstupů ⇒ walk-forward, penalizace složitosti, reportovat intervaly spolehlivosti, ne jen bodové odhady.
- **Nestacionarita:** Režimy trhu mění distribuce impulsů; globální jeden soubor parametrů může selhat.

## Role 6 — Senior developer (Pine)

- **Limity:** `max_*_count`, `max_bars_back` — STALE scan je omezen oknem `uStaleMaxBars` a offsety ≤ 5000.
- **Správnost:** Purge zóny přes swap s posledním prvkem + `array.pop` na všech paralelních polích; synchronizace přes `f_sync_zone_arrays`.

## Shrnutí

Strategie **dává smysl** jako strukturovaný filtr; **dlouhodobý edge** není zaručen geometrií zóny samotné. **Přenosnost** napříč TF/instrumenty vyžaduje kalibraci; **prop** kontext těží z méně pozdních a méně „mrtvých“ signálů. Matematicky je nutné měřit definované události; kód v1.2.6+ přidává STALE, volbu READY a metadata filtry jako kroky k lepší testovatelnosti.
