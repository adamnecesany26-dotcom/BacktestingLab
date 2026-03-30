# Profesionální trader audit — Backtesting Platform

**Datum:** 2026-03-23  
**Role:** Retail s reálnou edge, dlouhá praxe, nulová důvěra v backtesty bez kontextu.  
**Otázka 1:** Vydělával bys s tímhle?  
**Otázka 2:** Používal bys to **každý den** na research?

---

## Verdikt

**Na vydělávání peněz jako hlavní nástroj: NE.** Peníze děláš na trhu, ne v simulátoru. Tahle aplikace je **hypotézový skener** — užitečný jen tehdy, když **ty** děláš gatekeeping: forward test, menší size, vlastní exekuční realitu.

**Každý den pro trading research: NE.** Denní práce edge tradera je **chart, kontext, likvidita, journal, risk na účtu** — ne čekat na Docker run a koukat na Sharpe z equity. Otevřel bych to **občas** (nápad → kód → rychlý brutal check), ne jako **hlavní obrazovku života**.

**Po týdnu zahodit?** Celé repo **ne** — jako **laboratoř** na vlastní strategie má smysl. **Iluzi**, že čísla z Run = pravda, bych vyhodil **první den**.

---

## 1) Realita vs bullshit

**Co vypadá dobře, v reálu často neobchoduješ:**

- **Hladká equity a pěkný Sharpe** — u diskrétních vstupů často **divadlo z bar-close equity** a z mála nezávislých „pokusů“. Live máš **mezeru, částečné fillly, špatný pořadí stop/target v jedné svíčce**, news, špatnou náladu.
- **Limitky u zóny „jak na školení“** — backtest neví, jestli jsi byl **první ve frontě**, jestli tě **nesrazilo** ještě před fillnutím, jestli broker **neslízl** stop hunt přesně na tvém levelu.
- **Jeden instrument, jeden rozsah let, jeden param set** — to je **příběh**, ne edge. Retail to prodá jako „systém“; ty víš, že **bez rozptylu přes režimy** je to **noise**.

**„Tohle bych live nikdy neobchodoval“ jen podle aplikace:** Cokoli, kde **vypnutý execution**, **pár desítek obchodů**, **target a stop oba trefené ve stejném baru bez tick path** — to je **scénář pro optimisty**, ne pro mě.

---

## 2) Použitelnost pro edge

**Pomáhá pochopit PROČ edge funguje?** **Částečně — jen pokud ty už teorii máš.**

- Aplikace ukáže **výsledky + zóny + nějaké agregace** (S/D analytika: demand/supply, inducement, base length, impulse…). To je **lepší než čistý PnL tabulka bez kontextu**.
- **Nenahradí** ti ale: **order flow**, **čas dne**, **korelace s indexem**, **chování při událostech**. Důvod „proč“ je pořád **v hlavě a na live chartu**, ne v JSONu.

**Bez kontextu** defaultní panel **tlačí** na **čísla** (return, WR, Sharpe) — přesně tam retail **ztratí rozum**. Ty ne — nebo bys neměl.

---

## 3) S/D strategie (konkrétně)

**Z pohledu price action:**

- Logika v dokumentaci je **srozumitelná** (odchod od zóny, invalidace, MTF zóny, vstup limit vs momentum). To **není** náhodný black box indicator soup.
- **Mechanické a odtržené od reality** je vždycky **hranice OHLC**: zóna na denním TF zarovnaná na intraday grafu, **BOS/impulse jako skóre z modulu** — to je **model reality**, ne **tape**. Live řešíš **reakci ceny**, ne sloupec `impulse_score`.

**Výstupy dávají smysl** jako **„takhle by bot obchodoval tvoje pravidla na těch datech“** — **ne** jako „takhle se chová instituce u tvé zóny“.

---

## 4) Execution realita

**Fillům nevěřím.** Slippage/spread jako globální knoflíky **nejsou** fronta u brokera.

**Reakci ceny na zóny** simulace **přibližuje** pravidly z kódu — **nereplikuje** microstructure.

**Vím, že bych dostal horší vstupy/výstupy** než středně pesimistický run — pokud ne, žiju v omylu.

---

## 5) Risk mindset

**Aplikace tě nenutí** přemýšlet o risku **dost**.

- Max DD % **je tam**, ale **bez** „jak dlouho jsem v pekle“ a „jak hluboká je závislost na pár tradech“ **tě to nebolí** dost na to, abys zavřel nápad.
- **Snadno ignoruješ drawdowny** — jeden pěkný graf **přebije** diskomfort. Monte Carlo a OOS **jsou volitelné**; lenivec je **nevypne v hlavě**, ale **nezapne v UI**.

Kdo má disciplínu, doplní si to sám. **Systém tě nechrání před sebou.**

---

## 6) Workflow

**Rychlost testování nápadu:** Střední. Máš editor, moduly, parametry, run — **fajn**. **Brzdí:** Docker/pipeline, správné **napojení modulu S/D**, přehled v tom, co přesně běží, **mentální daň** z příliš mnoha přepínačů (validace, sweep, edge…).

**Zbytečná komplexita** pro čistého tradera: **všechno najednou** na jedné obrazovce — začátečník si myslí, že musí umět **vše**; ty chceš **jeden čistý run** a **jednu otázku**.

---

## 7) Red flags (cynismus)

| Signál | Reakce |
|--------|--------|
| Příliš pěkná equity | **Stop.** Hledám pár obchodů, co to nesou. |
| Málo tradeů | **Ignore.** |
| Nerealistické fills (execution off / nulový slip) | **Koš.** |
| Vysoký Sharpe + diskrétní vstupy | **Smích.** Pak kontrola OOS a jiný rok. |
| Chybějící kontext (proč ten trade, jaká zóna, jaký režim) | **SdZoneAnalytics** pomůže jen pokud `zoneMeta` fakt je — jinak **slepý let**. |

---

## 8) Co bych chtěl navíc (co bych fakt mačkal)

1. **Jedním klikem:** „ukázat obchody, které nesou 80 % PnL“ + **journal hook** (poznámka k runu).  
2. **DD timeline** — ne jen %, ale **„kolik týdnů jsi byl pod vodou“**.  
3. **Porovnání dvou runů** vedle sebe (stejná data, jiný param) **bez** ručního exportu.  
4. **Preset „pesimista“** execution — jedno tlačítko, ne 5 polí.  
5. **Rychlý replay** nápadu na **krátkém úseku** dat (debug jedné zóny) — pokud už tam není dostatečně rychlé.

---

## 9) Shrnutí: iluze vs nástroj

| Iluze edge | Skutečná užitečnost |
|------------|---------------------|
| Jedno číslo Sharpe = důkaz | Rychlá kontrola **konzistence pravidel** v kódu |
| Graf = budoucnost | **Vizuál zón vs vstupy** — hledání bugů a přehnaných předpokladů |
| Backtest = pravda | **Filtrování nápadů** před menším live / paper |

**Aplikace spíš vytváří iluzi**, pokud ji používá **někdo bez cynismu**. Pro tebe je to **nástroj** jen s **tvrdými pravidly**: execution zapnutý, dost obchodů, WF/OOS, žádná optimalizace očima na celém vzorku bez holdoutu.

---

## 10) Doporučení (co změnit pro reálný trading mindset)

- **Defaultně agresivní varování** u single runu + málo tradeů + vypnutý execution.  
- **Tail a „kdo nese PnL“** na první stránce výsledků — ne schované pod detaily.  
- **Jednoduchý „research vs pitch“ režim** — research: minimum metrik, maximum kontextu obchodu; pitch: nic, tohle není pro investory.

---

## Související audity

- `audit/data_scientist_audit.md` — proč čísla nejsou důkaz.  
- `audit/prop_firm_reviewer_audit.md` — proč z toho nejde alokovat kapitál.  
- `audit/risk_manager_audit.md` — DD, MC, portfolio.  
- Strategie S/D: `strategies/sd_zone_strategy/README.md` (simulace vs live).

---

**Jedna věta:** **Nepoužívám to denně a nevydělávám z toho přímo** — používám to **občas**, abych **zabil špatné nápady dřív, než sníží účet**; zbytek je **na mně a na trhu**.
