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
          "Equity, Highlight, Detailed, Analytics a Run history společně tvoří vícevrstvou analýzu.",
        whyItMatters:
          "Každá záložka odpovídá jiné otázce; jedna metrika nikdy nestačí.",
        howToUse: [
          "Equity: hodnotíš tvar křivky, drawdown a stabilitu růstu.",
          "Highlight/Detailed: kontroluješ kvalitu jednotlivých obchodů.",
          "Analytics: hodnotíš robustnost, risk-of-ruin a validační evidence.",
          "Run history: porovnáváš iterace a branch vývoj.",
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
];
