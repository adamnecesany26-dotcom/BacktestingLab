# Prop firm / capital allocator audit — Backtesting Platform

**Datum:** 2026-03-23  
**Role:** Risk, compliance, portfolio reviewer — rozhoduji o cizím kapitálu.  
**Otázka:** Dal bych traderovi kapitál **výhradně** na základě výstupů téhle aplikace?

---

## Verdikt

**NE.**

Ne proto, že aplikace je „špatná software“. Protože **výstupy, které typický uživatel bere jako důkaz**, jsou **nedostatečné, snadno zkreslitelné a neodpovídají tomu, co prop firma potřebuje k alokaci**. Kapitál bych dal **až po** externím due diligence: nezávislá data, replay / paper, risk pravidla mimo backtester, a důkaz, že výsledky nevznikly výběrem z mnoha pokusů na stejném vzorku. Samotná aplikace **není** ten důkaz.

---

## 1) Důvěryhodnost výsledků

**Robustně nepůsobí jako alokační balíček.** Působí jako **research nástroj** s hezkými čísly.

- **Snadno manipulovatelné:** Uživatel volí instrument, rozsah let, parametry strategie, moduly, zapnutí/vypnutí „realistic execution“, sweep, co z reportu ukáže investorovi. Bez externího dohledu **nevidíš**, kolik pokusů předcházelo jednomu screenshotu.
- **Přehnaně dobře** může vypadat cokoli: krátké okno, málo obchodů, vypnutý execution model, jeden šťastný parametr z matice.
- **Auditovatelnost je slabá pro allocátora:** Chybí standardní prop balíček: zmrazená konfigurace runu, kterou nemůžeš zpochybnit bez zdrojáků; počet pokusů a výběrový bias v jedné tabulce; podepsaný datový lineage až po burzu. Aplikace generuje výsledky — **neřídí proces schvalování strategie**.

**Retail backtest hračka?** Pro alokaci kapitálu firmy: **ano, pokud z toho někdo dělá jediný důkaz edge**. Jako interní lab: přijatelné s opatrností.

---

## 2) Risk profil

**Neukazuje skutečný risk. Ukazuje zjednodušený obraz z modelu.**

- **Vidíš hlavně výnosy a max drawdown v %.** Max DD je **jedno číslo**. **Nevidíš** délku drawdownu, čas do recovery, „underwater“ zátěž — dvě strategie se stejným max DD jsou pro funding **naprosto jiné**.
- **Tail risk v UI prakticky chybí:** Žádný standardní tail report (CVaR obchodů, distribuce PnL, závislost výsledku na pár největších obchodech). Bez toho **nevíš**, jestli PnL není dvěma outliery.
- **Monte Carlo** existuje, ale interpretace „risk of ruin“ **není** ekonomická pravděpodobnost bankrotu — je to bootstrap historických uzavřených PnL pod zjednodušenými pravidly. **Vypnuté MC = žádný tail pohled** v tom kanálu.
- **Portfolio v aplikaci** není společný účet s korelovaným průběhem equity. Je to **agregace izolovaných běhů**. Pro alokaci napříč bookem **to nestačí** — podcenění souběžných DD.

---

## 3) Konzistence výkonu

- **Default je jeden agregovaný výsledek** — to je přesně to, co retail miluje a prop nenávidí.
- **Stabilita v čase:** Nástroje existují (OOS split, walk-forward, degradace train vs test), ale **nejsou povinné** a **neřeší celý research proces** (ladění na plných datech a pak „ukázka“ OOS je pořád selection bias).
- **Equity smoothness vs realita:** Křivka je **mark-to-market na baru** podle simulovaného brokera. **Není** microstructure stress, **není** realistická sekvence fillů u limitů vs stopů. Hladká křivka **může být artefakt granularity a modelu**, ne důkaz disciplíny strategie.

---

## 4) Robustnost

- **OOS a walk-forward:** Užitečné **jen pokud** parametry strategie **nebyly** vybrány iterací na stejných datech, která pak „kontroluješ“. Aplikace ti **nezabrání** v opaku.
- **Parametr sweep / param test:** Z pohledu firmy je to **průzkum na vzorku**, ne validace. Nejlepší bod z grafu **není** důvod k capital.
- **Bez reportu „kolik konfigurací jsi zkusil“** je robustnost **neověřitelná** zvenku.

---

## 5) Execution realita

**Fillům a slippage modelu jako proxy reality nevěřím. Bez důvěry v exekuci je backtest pro funding bezcenný.**

- Slippage je **zjednodušený** (symetrické %, spread v bps, vol multiplikátor, „latency“ jako skalár přičtený k % — **není** skutečné zpoždění objednávky).
- **Žádný** realistický market impact podle velikosti, **žádná** hloubka knihy, **žádné** gapy jako první třída.
- U strategií s intrabar logikou (target/stop ve stejném baru) **pořadí** high/low **často není** modelované — výsledek **může být** systematicky optimistický nebo pesimistický; prop to bere jako **neprokázané**.

**Závěr:** Backtest je **scénář pod pravidly simulátoru**, ne důkaz exekuce u brokera.

---

## 6) Transparency

- Strategie je **uživatelský kód** — může být **černá skříňka** pro reviewera, pokud ji neotevřeš.
- Část metodiky je v dokumentaci / poznámkách enginu, ale **allocátor bez vývojáře** nedělá due diligence z JSONu samotného.
- **Data:** Kvalita, survivorship, úpravy sady — **mimo** kontrolu aplikace. Pro firmu musí být **datový balíček** odděleně schválený.

---

## 7) Capital scalability

- Model **nepočítá** s tím, že větší kapitál **mění** trh a fill.
- Fixní / jednoduchý slippage **implikuje**: edge při škálování **není** testovaný.
- **NE** — z výstupů aplikace **neodvodíš** bezpečnou kapacitu AUM.

---

## 8) Red flags (okamžité stop)

| Signál | Proč je to stop pro allocátora |
|--------|--------------------------------|
| **Extrémně vysoký Sharpe** při diskrétních vstupech | Často artefakt bar returnů a sample size — **nedůvěřuji** bez nezávislé replikace. |
| **Málo obchodů** | Jedna série šťastných obchodů — **žádný** funding. |
| **Příliš hladká equity** bez tail diagnostiky | Pravděpodobně **podmodelovaná** bolest nebo pár driverů. |
| **Žádné ztrátové období** v dlouhém horizontu | Buď **příliš krátký vzorek**, nebo **curve-fit** — obojí je stop. |
| **Profit factor „nekonečno“ / sentinel** bez kontextu | Vypadá skvěle, **statisticky je to hluk**. |
| **Jediný run, single instrument, execution vypnutý** | **Není** co schvalovat. |
| **Sweep + jen screenshot vítěze** | Klasický **multiple testing** — kapitál **ne**. |

---

## 9) Co bych musel vidět, aby se odpověď změnila na ANO

Nejde o „feature wishlist“ — jde o **minimální balíček pro firmu**:

1. **Zmrazená konfigurace** jednoho schváleného runu (data, parametry, execution, kód strategie hash) + **počet předchozích pokusů** v projektu nebo lab log.
2. **Walk-forward nebo OOS** s parametry **zafixovanými před** pohledem na test — doložený proces, ne jen tlačítko v UI po měsíci ladění.
3. **DD duration, time-to-recovery, underwater** vedle max DD.
4. **Distribuce PnL obchodů** + tail (CVaR / top 5 % příspěvků k PnL) — důkaz, že výnos není dvěma obchody.
5. **Exekuční stress** srozumitelný reviewerovi (konkrétní předpoklady slippage/spread) a **srovnání** s paper nebo replay na stejných pravidlech.
6. **Kapacita / škálování** aspoň jako scénář (větší slip při větším notionale) — nebo explicitní „jen malý účet“.
7. **Nezávislá replikace** výsledku mimo tuto aplikaci — firma stejně nepůjčí jen podle jednoho nástroje; aplikace musí **nebránit** exportu dat a výsledků pro druhý engine.

**ANO** by znamenalo: výše je splněno, proces je auditovatelný, a čísla drží **i** po přísnějším execution a delším OOS — **ne** že aplikace sama „dokáže edge“.

---

## 10) Doporučení — co upravit, aby aplikace „prošla“ prop mindset

| Oblast | Akce |
|--------|------|
| **Trust** | Povinný „run manifest“: hash strategie, data fingerprint, execution preset, **attempt count** / batch ID, varování při exportu bez WF/OOS. |
| **Risk** | Max DD + **duration + recovery** + příspěvek největších obchodů k celkovému PnL. |
| **Tail** | Histogram PnL + CVaR v defaultním výsledku; MC metodika **vždy** viditelná vedle čísla. |
| **Execution** | Jasná copy pro uživatele: *toto není broker*; preset „prop conservative“ s vyšším slip/spread. |
| **Portfolio** | Velké varování: **není** joint account simulace; bound na souběžný DD nebo oddělený režim. |
| **Workflow** | Guided pipeline: train-only tuning → locked params → test-only report jako **jeden** schvalovací artefakt. |

---

## 11) Odkaz na související audity

- `audit/risk_manager_audit.md` — drawdown, portfolio, Monte Carlo interpretace.  
- `audit/data_scientist_audit.md` — statistická neplatnost „důkazu edge“ z defaultního výstupu.  
- `docs/QUANT_AUDIT.md` — execution a metriky (techničtější vrstva).

---

**Shrnutí jednou větou:** Jako prop reviewer **kapitál na základě pouze toho, co aplikace defaultně ukáže, nedávám** — je to **research UI**, ne **allocation-grade důkaz**. S externím procesem, přísným OOS/WF, tail reportem a realistickou exekucí **může** být vstup do rozhodnutí; **sama o sobě aplikace rozhodnutí ANO neopravňuje**.
