export interface GuideTopic {
  id: string;
  title: string;
  whatItIs: string;
  whyItMatters: string;
  howToUse: string[];
  recommendedDefaults?: string[];
  commonMistakes?: string[];
}

export interface GuideSection {
  id: string;
  title: string;
  intro: string;
  topics: GuideTopic[];
}

export const guideSections: GuideSection[] = [
  {
    id: "overview",
    title: "1) Co je tato aplikace a jak o ní přemýšlet",
    intro:
      "Aplikace je pracovní prostředí pro návrh, testování a vyhodnocení obchodních strategií nad historickými daty. Nejde jen o „spustit Run“, ale o disciplínu: hypotéza -> implementace -> validace -> rozhodnutí.",
    topics: [
      {
        id: "app-purpose",
        title: "Účel aplikace",
        whatItIs:
          "Jedna platforma, která spojuje editor kódu, konfiguraci backtestu, view mód, výsledkovou analytiku a historii runů.",
        whyItMatters:
          "Když máš celý workflow na jednom místě, snížíš šum, chyby v procesu a lépe porovnáš jednotlivé iterace strategie.",
        howToUse: [
          "Vlevo vytvářej a upravuj strategii, indikátory a moduly.",
          "Vpravo nastav parametry trhu, simulace, validace a risk filtry.",
          "Spusť backtest až po kontrole konfigurace a potvrzení modulů/indikátorů.",
          "Vyhodnocuj výsledky vždy stejným postupem, ne jen podle jednoho čísla.",
        ],
      },
      {
        id: "mental-model",
        title: "Správný mentální model začátečníka",
        whatItIs:
          "Cyklus práce: hypotéza -> kód -> vizuální kontrola ve View -> backtest -> analytika -> úprava -> nový run.",
        whyItMatters:
          "Cílem není jeden skvělý graf, ale opakovatelný proces, který obstojí i při změně trhu.",
        howToUse: [
          "U každého runu si napiš, co přesně testuješ (hypotéza).",
          "Měň vždy jen malý počet věcí najednou.",
          "Porovnávej výsledky v rámci stejné branche experimentu.",
        ],
      },
    ],
  },
  {
    id: "first-steps",
    title: "2) Jak začít: první strategie a první Run",
    intro:
      "První den není o dokonalé strategii. Je o tom, aby ses naučil celý tok práce a rozuměl tomu, co jednotlivé části aplikace dělají.",
    topics: [
      {
        id: "first-code",
        title: "Jak napsat první kód",
        whatItIs:
          "Strategie je Python třída (Backtrader), kde v metodě next() rozhoduješ o vstupu a výstupu.",
        whyItMatters:
          "Jednoduchá strategie ti umožní rychle ověřit celý pipeline bez zbytečné komplexity.",
        howToUse: [
          "Vytvoř strategii a otevři soubor `main.py`.",
          "Začni jednoduchou logikou (např. trendový filtr + jasný exit).",
          "Přidej `PARAMS`, aby šly hodnoty ladit bez úpravy kódu.",
          "Ulož změny a připrav konfiguraci v pravém panelu.",
        ],
        recommendedDefaults: [
          "První verze: 1–2 podmínky vstupu, 1 jasné pravidlo výstupu.",
          "Neoptimalizuj od začátku příliš mnoho parametrů.",
        ],
        commonMistakes: [
          "Příliš složitý kód hned v první iteraci.",
          "Ladění desítek parametrů bez baseline runu.",
        ],
      },
      {
        id: "first-run-sequence",
        title: "Sekvence prvního backtestu",
        whatItIs:
          "První run je technický smoke-test: data, request payload, závislosti modulů, rendering výsledků.",
        whyItMatters:
          "Když je první run čistý, další iterace jsou rychlé a dobře porovnatelné.",
        howToUse: [
          "Nastav Instrument Type, Instrument a délku dat (roky).",
          "Nastav Simulation: kapitál, slippage, komise.",
          "Vyber indikátory/moduly a klikni na Potvrdit.",
          "Spusť Run a sleduj logy i warningy v dolním panelu.",
        ],
      },
    ],
  },
  {
    id: "code-architecture",
    title: "3) Indikátory, moduly a proč dělit kód",
    intro:
      "Kvalita architektury rozhoduje, jak rychle se učíš z dat. Pokud je vše v jednom souboru, ztrácíš přehled i kontrolu.",
    topics: [
      {
        id: "indicator-module-difference",
        title: "Co jsou indikátory a co jsou moduly",
        whatItIs:
          "Indikátor obvykle počítá číselnou řadu (EMA, RSI, ATR). Modul přidává kontext: markery, zóny, strukturu trhu nebo pomocnou logiku.",
        whyItMatters:
          "Rozdělení odpovědnosti zjednodušuje ladění i dlouhodobou údržbu.",
        howToUse: [
          "Výpočtovou logiku drž v indikátorech.",
          "Vizualizační/strukturální logiku drž v modulech.",
          "Používej `VIEW_PARAMS` pro rychlé ladění bez zásahu do implementace.",
        ],
      },
      {
        id: "modular-reasoning",
        title: "Proč je modulární přístup lepší",
        whatItIs:
          "Každá část má jasný vstup, výstup a odpovědnost.",
        whyItMatters:
          "Snáz zjistíš, která konkrétní změna zlepšila nebo zhoršila výkon strategie.",
        howToUse: [
          "Pojmenovávej parametry konzistentně napříč soubory.",
          "Přidej krátké docstringy s očekávaným chováním funkcí.",
          "Při refactoringu měň jen jednu vrstvu najednou (indikátor/modul/strategie).",
        ],
        commonMistakes: ["Míchání všech pravidel do `main.py`.", "Nepopsané parametry bez kontextu."],
      },
    ],
  },
  {
    id: "view-mode",
    title: "4) View mód: jak z něj vytěžit maximum",
    intro:
      "View mód je rychlá vizuální validace. Ověříš, že signály a výpočty opravdu odpovídají tomu, co sis v kódu myslel.",
    topics: [
      {
        id: "view-basics",
        title: "Co je View mód",
        whatItIs:
          "Svíčkový graf s markery/liniemi/zónami z `detect()`, `get_line()` a `get_zones()` bez plného backtestu.",
        whyItMatters:
          "Odhalí chyby dřív, než ztratíš čas na plných runech.",
        howToUse: [
          "Přepni na View a vyber strategii/modul/indikátor.",
          "Uprav `VIEW_PARAMS` a ihned sleduj změnu výstupu.",
          "Porovnej chování na více úsecích trhu (trend, chop, volatilita).",
        ],
      },
      {
        id: "view-best-practices",
        title: "Best practices ve View",
        whatItIs:
          "Sada pravidel, jak dělat vizuální kontrolu bez biasu.",
        whyItMatters:
          "Nesklouzneš k „potvrzování“ hypotézy jen na jednom hezkém úseku.",
        howToUse: [
          "Testuj signály na různých obdobích, ne jen na jednom týdnu/měsíci.",
          "Lad jeden parametr v jednom kroku.",
          "Když něco nevychází ve View, neřeš to „až po backtestu“.",
        ],
      },
    ],
  },
  {
    id: "configuration",
    title: "5) Konfigurace backtestu: od základů po edge-finding",
    intro:
      "Pravé menu je nejdůležitější část pro důvěryhodnost výsledků. Tady rozhoduješ, zda je test realistický, nebo přehnaně optimistický.",
    topics: [
      {
        id: "oos",
        title: "Co je OOS (out-of-sample) a proč je klíčový",
        whatItIs:
          "Out-of-sample je část dat, na které neladíš parametry. Slouží jako kontrolní test generalizace.",
        whyItMatters:
          "Bez OOS hrozí overfitting: strategie je skvělá na historii, slabá v budoucnosti.",
        howToUse: [
          "Pro běžný research zvol `oos_split`.",
          "Nastav OOS ratio typicky 0.20–0.30.",
          "Sleduj rozdíly train vs OOS výkonu (PF, DD, stabilita).",
        ],
        recommendedDefaults: ["OOS ratio: 0.25 jako kvalitní výchozí hodnota."],
        commonMistakes: ["Příliš malé OOS (<0.10).", "Single run jako finální rozhodnutí."],
      },
      {
        id: "walk-forward-and-mc",
        title: "Walk-forward + Monte Carlo",
        whatItIs:
          "Walk-forward opakovaně testuje strategii na „budoucích“ segmentech. Monte Carlo simuluje rozdělení možných výsledků a tail-risk.",
        whyItMatters:
          "Společně dávají mnohem realistější obraz robustnosti než jeden equity curve.",
        howToUse: [
          "Pro přísnější validaci použij walk-forward (3–6 foldů, test ratio 0.15–0.25).",
          "Zapni Monte Carlo a použij minimálně 300 simulací.",
          "Vyhodnocuj i pesimistické scénáře, ne jen medián.",
        ],
        recommendedDefaults: ["WF folds: 4", "WF test ratio: 0.20", "MC simulations: 300–500"],
      },
      {
        id: "quality-gates-and-execution",
        title: "Quality gates a realistická exekuce",
        whatItIs:
          "Quality gates filtrují slabé runy. Execution model započítává spread, slippage a latenci.",
        whyItMatters:
          "Bez těchto filtrů může strategie vypadat výborně jen kvůli nereálným předpokladům.",
        howToUse: [
          "Nastav minimální počet obchodů (typicky 20–30+).",
          "Nastav horní limit drawdownu podle risk tolerance.",
          "Nastav minimální PF threshold a zapni execution model před finálním výběrem.",
        ],
        commonMistakes: ["Nulové náklady.", "Porovnávání runů s odlišnou konfigurací validace."],
      },
    ],
  },
  {
    id: "results",
    title: "6) Results: jak správně analyzovat backtest",
    intro:
      "Po runu tě zajímá nejen výnos, ale hlavně stabilita, riziko a obchodovatelnost strategie v praxi.",
    topics: [
      {
        id: "tabs",
        title: "Co znamenají záložky výsledků",
        whatItIs:
          "Equity, Highlight, Detailed, Analytics a Run history společně tvoří vícevrstvou analýzu; nad záložkami jsou StatBlocks (metriky + ⓘ) a tlačítka Export JSON / Repro bundle (ZIP).",
        whyItMatters:
          "Každá záložka odpovídá jiné otázce; jedna metrika nikdy nestačí.",
        howToUse: [
          "Equity: hodnotíš tvar křivky, drawdown a stabilitu růstu.",
          "Highlight/Detailed: kontroluješ kvalitu jednotlivých obchodů.",
          "Analytics: robustnost, Monte Carlo, validace, foldy, guardrails, cost attribution, heuristický readiness a overfitting varování.",
          "Run history: porovnáváš iterace, branch vývoj, N-way compare a lifecycle stavy.",
          "Repro bundle: manifest + souhrn + snapshot main.py z editoru pro pozdější audit (ulož kód před exportem).",
        ],
      },
      {
        id: "risk-metrics-depth",
        title: "Risk metriky: drawdown duration, PnL distribuce, tail risk",
        whatItIs:
          "Engine automaticky počítá rozšířené risk metriky: délku drawdownu (bary/dny), čas zotavení, underwater integrál, distribuci PnL obchodů (histogram, percentily, CVaR), koncentraci zisku v top N obchodech a kontext pro Sharpe/Sortino.",
        whyItMatters:
          "Dva backtesty se stejným max DD 20 % mohou mít naprosto odlišný risk profil — jeden se zotaví za 10 dnů, druhý za 6 měsíců. Koncentrace zisku ukáže, zda strategie stojí na systematickém edge nebo na pár šťastných obchodech.",
        howToUse: [
          "StatBlocks zobrazují DD Duration a Recovery přímo v hlavním přehledu.",
          "Analytics záložka obsahuje Drawdown analysis (duration, recovery, underwater) a Trade PnL distribution (histogram, tail CVaR, koncentrace).",
          "Sharpe/Sortino context strip ukazuje frekvenci dat a počet obchodů — malý vzorek = nespolehlivé ratio.",
          "Pokud top 5 obchodů tvoří > 70 % zisku, UI zobrazí varování o křehkém edge.",
        ],
        recommendedDefaults: ["Sleduj vždy — metriky se počítají automaticky."],
        commonMistakes: [
          "Ignorovat délku DD a dívat se jen na hloubku.",
          "Spoléhat na Sharpe u strategie s 15 obchody.",
        ],
      },
      {
        id: "bootstrap-ci-guide",
        title: "Bootstrap CI: intervaly spolehlivosti pro metriky",
        whatItIs:
          "Engine provede 1000 opakování: z obchodů pokaždé vybere vzorek s opakováním a spočítá metriku. Výsledkem je 95% interval — říká, kde s danou nejistotou leží skutečný edge.",
        whyItMatters:
          "Bodový odhad (např. Sharpe = 1.5) sám o sobě neřekne, jestli je to signál nebo šum. CI [0.4, 2.6] ti řekne: s 95% jistotou je Sharpe někde tady. Pokud CI pro mean PnL zahrnuje nulu, nemůžeš vyloučit, že edge neexistuje.",
        howToUse: [
          "V Analytics najdi sekci Bootstrap CI — sleduj [ciLow, ciHigh].",
          "Pokud ciLow pro mean PnL je kladný, máš silnější signál edge.",
          "Širší interval = více nejistoty, potřebuješ delší historii nebo víc obchodů.",
        ],
        commonMistakes: [
          "Brát CI jako absolutní garanci — předpokládá i.i.d. obchody.",
          "Ignorovat CI a spoléhat na bodový odhad.",
        ],
      },
      {
        id: "payoff-decomposition-guide",
        title: "Edge equation: win rate vs payoff ratio",
        whatItIs:
          "Dekompozice edge na WinRate × AvgWin − LossRate × AvgLoss. Plus Kelly fraction jako teoretický optimální podíl kapitálu.",
        whyItMatters:
          "Dvě strategie se stejným expectancy mohou mít úplně jiný profil: 80% win rate s payoff 0.5 vs 30% win rate s payoff 4.0. Obojí funguje, ale vyžaduje jiný sizing a psychologii.",
        howToUse: [
          "V Analytics najdi Edge decomposition — sleduj payoff ratio a Kelly.",
          "Payoff ratio < 1 vyžaduje win rate > 50% pro pozitivní edge.",
          "Kelly fraction nasazuj maximálně z poloviny (half-Kelly).",
        ],
      },
      {
        id: "multiple-testing-guide",
        title: "Multiple testing: trial count a Bonferroni",
        whatItIs:
          "Kolikrát jsi testoval různé konfigurace. Engine počítá hlavní run + param test + sweep. Naive Bonferroni α = 0.05 / počet pokusů.",
        whyItMatters:
          `20 testů na stejných datech = 20× vyšší šance na falešně pozitivní výsledek. Trial count je tvůj „metr poctivosti".`,
        howToUse: [
          "Sleduj trialCount v Analytics a v manifestu.",
          "Čím nižší trial count, tím silnější evidence z každého testu.",
          "Pokud máš vysoký trial count, zapni train-only param test.",
        ],
        recommendedDefaults: ["Drž trial count pod 20. Zapni train-only."],
        commonMistakes: [
          "Testovat 50 konfigurací a reportovat jen tu nejlepší.",
          "Ignorovat adjusted α a věřit headline metrikám.",
        ],
      },
      {
        id: "credible-backtest",
        title: "Jak poznat věrohodný backtest",
        whatItIs:
          "Věrohodný backtest drží výsledky i po zpřísnění testovacích podmínek.",
        whyItMatters:
          "Cílem je edge, který přežije i méně příznivé podmínky.",
        howToUse: [
          "Použij OOS/WF, quality gates a Monte Carlo.",
          "Započítej realistické náklady exekuce.",
          "Porovnej výsledek s baseline runem ve stejné branchi.",
        ],
      },
      {
        id: "prop-red-flags-guide",
        title: "Prop-level red flags: co automatika detekuje",
        whatItIs:
          "Engine automaticky skenuje výsledky na podezřelé vzory: extrémně vysoký Sharpe s málo obchody, žádné ztrátové obchody, PF undefined, příliš hladká equity, single run bez validace, execution model vypnutý, CI zahrnující nulu, koncentrovaný PnL.",
        whyItMatters:
          "Hezká čísla bez kontextu jsou nebezpečná. Red flags tě nutí ověřit, proč výsledky vypadají dobře. Trust level (not_trustworthy / low_trust / cautious / acceptable) shrnuje celkový verdikt.",
        howToUse: [
          "Trust banner se zobrazí automaticky v ResultsView i v Analytics.",
          "Critical flagy vyžadují okamžitou pozornost — výsledek pravděpodobně není validní.",
          "Warning flagy znamenají: ověř dále, než budeš brát výsledek vážně.",
        ],
        commonMistakes: [
          "Ignorovat critical flagy a reportovat jen hezká čísla.",
          "Myslet si, že 'acceptable' trust znamená 'jistý edge' — stále potřebuješ OOS.",
        ],
      },
      {
        id: "prop-conservative-guide",
        title: "Prop conservative preset: nejpřísnější konfigurace",
        whatItIs:
          "Přednastavení pro maximální důvěryhodnost: WF 5 foldů, min 50 obchodů, max DD 15%, PF ≥ 1.5, MC 1000 sim (block bootstrap), spread 1.5 bps, slippage ×vol 2, latency 1 bar, stress multiplier 1.5×, param test train-only.",
        whyItMatters:
          "Odpovídá požadavkům prop firm reviewera: přísná validace, realistická exekuce, robustní statistika. Edge, který přežije tuhle konfiguraci, má mnohem větší šanci přežít i v reálném obchodování.",
        howToUse: [
          "V Edge finding klikni na 'Prop conservative'.",
          "Spusť backtest a sleduj trust level + red flags.",
          "Pokud edge přežije, máš solidnější základ pro rozhodování.",
        ],
      },
      {
        id: "pessimist-preset-guide",
        title: "Pessimist preset: agresivn\u00ed execution test",
        whatItIs:
          "Jedno tla\u010d\u00edtko, kter\u00e9 nastav\u00ed extr\u00e9mn\u011b pesimistick\u00fd execution model: " +
          "spread 2 bps, slippage 3\u00d7 volatility, latence 2 bary, stress multiplier 2\u00d7. " +
          "Nem\u011bn\u00ed validaci ani jin\u00e1 nastaven\u00ed \u2014 \u010dist\u011b jen execution realita.",
        whyItMatters:
          "Live trading je V\u017dDY hor\u0161\u00ed ne\u017e backtest. Pessimist preset simul\u00e1tor \u201enejhor\u0161\u00ed den\u201c. " +
          "Pokud edge p\u0159e\u017eije, je robustn\u00ed. Pokud zmiz\u00ed, \u0161el bys live tr\u00e9novat s iluzi.",
        howToUse: [
          "Spus\u0165 z\u00e1kladn\u00ed run s norm\u00e1ln\u00edm nastaven\u00edm.",
          "Pak klikni na Pessimist a spus\u0165 znovu.",
          "Porovnej metriky \u2014 pokud edge klesne o v\u00edce ne\u017e 50%, je k\u0159ehk\u00fd.",
        ],
      },
      {
        id: "underwater-chart-guide",
        title: "Underwater equity: jak dlouho jsi v pekle",
        whatItIs:
          "Graf drawdown % v \u010dase pod hlavn\u00ed equity k\u0159ivkou v z\u00e1lo\u017ece Equity. " +
          "Uk\u00e1\u017ee nejen JAK hlubok\u00fd je propad, ale JAK DLOUHO v n\u011bm z\u016fst\u00e1v\u00e1\u0161.",
        whyItMatters:
          "Strategie se stejn\u00fdm max DD 15% m\u016f\u017ee m\u00edt 2 t\u00fddny nebo 6 m\u011bs\u00edc\u016f " +
          "underwater \u2014 psychologicky a finan\u010dn\u011b obrovsk\u00fd rozd\u00edl. " +
          "Statistika \u201e% bar\u016f pod vodou\u201c ti \u0159ekne, kolik \u010dasu str\u00e1v\u00ed\u0161 v propadu.",
        howToUse: [
          "V z\u00e1lo\u017ece Equity se zobrazuje automaticky pod hlavn\u00ed k\u0159ivkou.",
          "\u0160irok\u00e9 + hlubok\u00e9 \u010derven\u00e9 oblasti = dlouh\u00e9 a bolestiv\u00e9 propady.",
          "V\u00edce ne\u017e 50% bar\u016f pod vodou = v\u011bt\u0161inu \u010dasu v drawdownu.",
        ],
      },
      {
        id: "run-note-guide",
        title: "Pozn\u00e1mka k runu: journal pro research",
        whatItIs:
          "Voln\u00fd textov\u00fd z\u00e1pisn\u00edk p\u0159\u00edmo v ResultsView. " +
          "Pozn\u00e1mka se ulo\u017e\u00ed do repro bundle (run_note.txt).",
        whyItMatters:
          "Za t\u00fdden nevid\u00ed\u0161, PRO\u010c jsi ten run spustil. Journal discipl\u00edna je " +
          "z\u00e1klad seri\u00f3zn\u00edho research procesu \u2014 ka\u017ed\u00fd run = jedna hypot\u00e9za.",
        howToUse: [
          "P\u0158ED runem: napi\u0161 hypot\u00e9zu (co testuji a pro\u010d).",
          "PO runu: zapi\u0161 zji\u0161t\u011bn\u00ed (funguje / nefunguje / mus\u00edm zm\u011bnit).",
          "P\u0159i exportu ZIP se pozn\u00e1mka ulo\u017e\u00ed automaticky.",
        ],
      },
    ],
  },
  {
    id: "branches",
    title: "7) Branches a experiment management",
    intro:
      "Branchování runů je zásadní pro pořádek v experimentování. Každá branch reprezentuje jednu vývojovou větev hypotézy.",
    topics: [
      {
        id: "branch-workflow",
        title: "Jak dělat branche správně",
        whatItIs:
          "Branch seskupuje související runy tak, aby porovnání mělo kontext.",
        whyItMatters:
          "Bez branch disciplíny nepoznáš, proč došlo ke změně výkonu.",
        howToUse: [
          "Používej stabilní názvy branchí podle hypotézy (např. `breakout-v2`).",
          "Tagy používej konzistentně: instrument, timeframe, verze logiky.",
          "Každou významnou změnu testuj v nové branchi.",
        ],
        recommendedDefaults: ["`main` používej jako baseline větev."],
      },
      {
        id: "compare-lifecycle",
        title: "Compare workspace a lifecycle approvals",
        whatItIs:
          "Run history umí porovnat více runů vedle sebe (N-way compare) a evidovat lifecycle stav runu: draft -> review -> approved -> promoted.",
        whyItMatters:
          "Získáš transparentní rozhodovací proces champion/challenger a auditovatelný důvod, proč byl run přijat nebo zamítnut.",
        howToUse: [
          "V Run history zaškrtni alespoň 2 runy a otevři compare workspace.",
          "Porovnej klíčové metriky proti baseline runu (delta v tabulce).",
          "U kandidáta nastav lifecycle status na review a přidej reviewer sign-off.",
          "Do stavu promoted posouvej jen runy s konzistentní robustností a přijatelným rizikem.",
        ],
        recommendedDefaults: [
          "Jeden baseline run na branch.",
          "Promote až po approval + quality gate pass.",
        ],
      },
      {
        id: "institutional-practice",
        title: "Jak to dělají institucionální tradeři a quanti",
        whatItIs:
          "Institucionální workflow staví na hypotézách, validaci mimo tréninková data, risk limitech a auditovatelném záznamu experimentů.",
        whyItMatters:
          "Stejný přístup ti pomůže oddělit robustní edge od náhody a emočních rozhodnutí.",
        howToUse: [
          "Nikdy neber jeden run jako finální důkaz.",
          "Při zhoršení robustnosti vrať změnu a testuj menší krok.",
          "Rozhoduj se podle důkazů z více metrik, ne podle jediné hodnoty.",
        ],
      },
    ],
  },
  {
    id: "advanced-recent",
    title: "8) Pokročilé funkce a nedávná rozšíření",
    intro:
      "Tato sekce doplňuje základní průvodce o to, co aplikace umí nad rámec „jeden single run“: reprodukovatelnost, druhy Monte Carla, dávkové běhy, export a heuristické hodnocení overfittingu. Detailní mapu celé aplikace máš v souboru READMEADAM.md v kořeni repozitáře.",
    topics: [
      {
        id: "fixed-seed",
        title: "Fixní run seed (reprodukovatelnost)",
        whatItIs:
          "V Edge finding můžeš zapnout pevný seed. Hodnota se uloží do experimentu a v engine procesu nastaví RUN_SEED — stejné náhodné větve (Monte Carlo, sweep, block bootstrap) při stejném kódu a datech.",
        whyItMatters:
          "Bez fixního seedu jsou MC a sweep mezi běhy mírně odlišné; pro debugging a porovnání dvou verzí kódu je pevný seed praktický.",
        howToUse: [
          "Zapni „Použít pevný seed“ a zadej celé číslo (0–999999999).",
          "Pro běžný průzkum nech seed vypnutý — každý run dostane náhodný seed.",
          "U batch dávky sdílí všechny dílčí runy stejný seed z rodičovského requestu (srovnatelné RNG napříč položkami).",
        ],
        recommendedDefaults: ["Pro regresní testy např. seed 42; pro research náhodný."],
      },
      {
        id: "mc-modes",
        title: "Monte Carlo: IID trade vs block bootstrap",
        whatItIs:
          "IID náhodně vybírá uzavřené obchody; block bootstrap náhodně vybírá souvislé úseky PnL v čase, aby lépe zachytil serialitu.",
        whyItMatters:
          "U strategií s korelovanými výsledky po sobě může IID pod nebo přestřelit tail odhady.",
        howToUse: [
          "V Edge finding zapni Monte Carlo a zvol režim podle stylu strategie.",
          "Ve výsledcích čti pole method / mode / note u monteCarlo.",
          "Kombinuj s dostatečným počtem obchodů a OOS/WF.",
        ],
        recommendedDefaults: ["300–500 simulací; block_bootstrap pro kratší holdy nebo intraday."],
      },
      {
        id: "sweep-and-batch",
        title: "Parametrický sweep a batch (matrix) runy",
        whatItIs:
          "Sweep testuje více kombinací parametrů (random nebo grid). Batch spouští víkrát stejnou strategii s různými overrides (např. jiný instrument nebo data_file) v jednom requestu.",
        whyItMatters:
          "Oba přístupy zvyšují počet „pokusů“ — roste riziko náhodného výborného výsledku (multiple testing).",
        howToUse: [
          "Sweep nikdy nespoléhej na single run; používej s OOS nebo walk-forward.",
          "Batch drž na malý počet položek na začátku (max runs cap v UI).",
          "V Analytics a batchSummary čti varování k vícenásobnému testování.",
        ],
        commonMistakes: ["Společně zapnutý portfolio režim a batch (UI varuje).", "Interpretace jen „nejlepšího“ řádku bez kontextu."],
      },
      {
        id: "analytics-overfitting",
        title: "Analytics: readiness, overfitting a náklady",
        whatItIs:
          "Nahoře v Analytics je heuristický readiness signál a seznam varování (single run, málo obchodů, MC, degradace train→test, sweep na single, batch, guardrails, …). Severity score shrnuje závažnost — není to statistický test.",
        whyItMatters:
          "Dává konzistentní checklist, na co se dívat před tím, než začneš věřit výsledku.",
        howToUse: [
          "Projdi oranžový blok varování před každým „go live“ rozhodnutím.",
          "Srovnej se sloupcem readiness v Run history.",
          "V sekci execution / cost attribution zkontroluj podíl poplatků a slippage.",
        ],
      },
      {
        id: "repro-bundle",
        title: "Export JSON a Repro bundle (ZIP)",
        whatItIs:
          "Export JSON uloží celý RunResponse. Repro bundle zabalí manifest, zkrácený souhrn výsledků a snapshot main.py z editoru v okamžiku kliknutí.",
        whyItMatters:
          "Pro poznámky, audit nebo obnovu kontextu bez proklikávání UI.",
        howToUse: [
          "Před exportem ZIP ulož main.py, pokud chceš shodu s Firestore.",
          "Dataset a verze backendu/engineu by měly sedět s původním během — README uvnitř ZIP to připomíná.",
        ],
      },
    ],
  },
];
