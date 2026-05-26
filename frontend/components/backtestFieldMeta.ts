export interface BacktestFieldHelp {
  id: string;
  title: string;
  whatItMeans: string;
  whyItMatters: string;
  howToUse: string[];
  recommendedDefault: string;
  withoutIt: string;
  bestPractices: string[];
}

export const backtestFieldHelp: Record<string, BacktestFieldHelp> = {
  instrument: {
    id: "instrument",
    title: "Instrument",
    whatItMeans:
      "Konkrétní futures symbol a datový soubor (např. NQ, MNQ). Jeden Run cílí na jeden instrument — v tomto UI neposíláš portfolio vícero nástrojů najednou.",
    whyItMatters: "Strategie může na jednom trhu fungovat a na jiném selhat.",
    howToUse: [
      "Vyber symbol odpovídající hypotéze.",
      "Ověř, že dostupná historie pokrývá období, které testuješ.",
    ],
    recommendedDefault: "Hlavní trh strategie.",
    withoutIt: "Nevíš, zda edge patří k záměru.",
    bestPractices: ["Jiný trh = samostatná větev experimentu."],
  },
  years: {
    id: "years",
    title: "Délka backtestu (roky)",
    whatItMeans: "Kolik posledních let historie ze souboru vstupuje do simulace.",
    whyItMatters: "Krátký vzorek často přehání výkon nebo skryje špatné období.",
    howToUse: [
      "Ber dost dat na více tržních režimů.",
      "U častých vstupů často potřebuješ delší okno než u řídkých setupů.",
    ],
    recommendedDefault: "1–3 roky na iterace; déle před finálním verdiktem.",
    withoutIt: "Výsledek nemusí přežít jiný úsek trhu.",
    bestPractices: ["Při A/B porovnání drž stejnou délku."],
  },
  tickSize: {
    id: "tickSize",
    title: "Tick Size",
    whatItMeans: "Nejmenší cenový krok u futures kontraktu.",
    whyItMatters: "PnL a zaokrouhlení cen závisí na správné granularitě.",
    howToUse: ["Doplň podle specifikace burzy/brokera."],
    recommendedDefault: "NQ typicky 0,25.",
    withoutIt: "Simulace může používat nereálné ceny.",
    bestPractices: ["Při změně symbolu tick size znovu ověř."],
  },
  valuePerTick: {
    id: "valuePerTick",
    title: "Value Per Tick (USD)",
    whatItMeans: "Dolarová hodnota jednoho ticku pohybu ceny.",
    whyItMatters: "Určuje velikost zisku a ztráty na kontrakt.",
    howToUse: ["Zadej dle kontraktu (specifikace)."],
    recommendedDefault: "NQ často 5 USD na tick.",
    withoutIt: "Equity škála neodpovídá skutečnosti.",
    bestPractices: ["Shoda s broker dokumentací."],
  },
  initialCapital: {
    id: "initialCapital",
    title: "Počáteční kapitál",
    whatItMeans: "Výchozí hotovost účtu v simulaci.",
    whyItMatters: "Mění relativní drawdown a škálu equity křivky.",
    howToUse: ["Zadej částku blízkou reálnému účtu, se kterým počítáš."],
    recommendedDefault: "100000 jako neutrální srovnávací baseline.",
    withoutIt: "Porovnání mezi běhy je matoucí.",
    bestPractices: ["Neměň kapitál mezi runy, když netestuješ sizing."],
  },
  slippagePerc: {
    id: "slippagePerc",
    title: "Slippage (%)",
    whatItMeans:
      "Průměrné zhoršení fill ceny oproti očekávání (v %). Po změně instrumentu se pole předvyplní středem typického rozmezí pro daný kontrakt (např. NQ, MNQ, ES…).",
    whyItMatters: "Bez skluzu backtest často přestřelí výkon.",
    howToUse: ["Uprav podle stylu vstupu, likvidity a timeframu, pokud znáš reálné chování."],
    recommendedDefault: "Automaticky podle symbolu; ručně konzervativnější při agresivních vstupech.",
    withoutIt: "Příliš optimistické zisky.",
    bestPractices: ["Při porovnávání runů drž stejný skluz, pokud neladíš právě provádění."],
  },
  commissionPerContract: {
    id: "commissionPerContract",
    title: "Komise (USD / kontrakt / strana)",
    whatItMeans:
      "Pevný poplatek v USD za jednu stranu obchodu (jeden kontrakt). Round-trip = vstup + výstup (2× hodnota při jednom kontraktu).",
    whyItMatters: "U scalpingu a častých obratů mají procentní chyby na poplatcích velký dopad — pevná částka za kontrakt odpovídá futures účtům.",
    howToUse: ["Sečti burzu + brokera podle svého tarifu a zadej částku za stranu."],
    recommendedDefault: "0 jako neutrální výchozí; doplň reálnou hodnotu před závěry o výkonu.",
    withoutIt: "Čistý výnos může být nadhodnocený.",
    bestPractices: ["Při srovnávání strategií drž stejnou komisi."],
  },
  selectedIndicatorIds: {
    id: "selectedIndicatorIds",
    title: "Indikátory",
    whatItMeans: "Které indikátory se zkopírují do běhu (`indicators/`).",
    whyItMatters: "Bez výběru strategie nemusí mít kód, který importuješ.",
    howToUse: [
      "Zaškrtni jen to, co `main.py` opravdu importuje.",
      "Po změně klikni Potvrdit.",
    ],
    recommendedDefault: "Minimalizuj závislosti.",
    withoutIt: "Import error nebo jiná logika, než čekáš.",
    bestPractices: ["Drž seznam přehledný."],
  },
  selectedModuleIds: {
    id: "selectedModuleIds",
    title: "Moduly",
    whatItMeans: "Které moduly (swing, zóny, …) jdou do běhu spolu se strategií.",
    whyItMatters: "Často nesou zóny a markery bez kterých signál nedává smysl.",
    howToUse: [
      "Vyber moduly a Potvrdit.",
      "PARAM/VIEW parametry lad na záložkách modulů.",
    ],
    recommendedDefault: "1–2 moduly na začátek.",
    withoutIt: "Backtest nemusí odpovídat tomu, co vidíš ve View.",
    bestPractices: ["Nový modul nejdřív ověř ve View."],
  },
  validationMode: {
    id: "validationMode",
    title: "Validation mode (režim ověření)",
    whatItMeans:
      "**Single run** = celá zvolená historie najednou — rychlá kontrola logiky a metrik. " +
      "**Walk-forward** = posuvná okna v čase (trénink → test v každém kole). " +
      "Statický OOS split a OAT param test z tohoto menu zmizely; out-of-sample si lze řešit ručně (jiný rozsah dat / mimo aplikaci).",
    whyItMatters:
      "Single run neodděluje automaticky „trénink“ a „zkoušku“ — výsledek je výkon na jednom souvislém úseku.",
    howToUse: [
      "**Single** pro ladění a rychlé srovnání na stejném okně.",
      "**Walk-forward** pro více testovacích segmentů v jednom běhu.",
    ],
    recommendedDefault: "Single pro iterace; walk-forward pro časově náročnější pohled.",
    withoutIt: "—",
    bestPractices: [
      "Při robustness sweepu na single runu interpretuj špičky metrik opatrně.",
    ],
  },
  wfFolds: {
    id: "wfFolds",
    title: "WF folds (kolikrát se čas posune)",
    whatItMeans:
      "**Walk-forward** rozdělí čas na několik **kol** (foldů). V každém kole: vezme kus starších dat jako „učení“, pak hned za ním následující krátký kus jako **test** — a pak se celé okno posune dopředu a celé se to opakuje. " +
      "**Počet foldů** = kolik takových opakování (posunů) engine udělá. Víc foldů = víckrát ověříš, že strategie nevyhrála jen náhodou v jednom konkrétním měsíci.",
    whyItMatters:
      "Jeden fold může být štěstí; **čtyři až šest** už ukáže, jestli se výsledek opakuje, nebo byl jednorázový. Cena za to je delší výpočet.",
    howToUse: [
      "Začni třeba na **4** — bývá to dobrý kompromis mezi důkladností a časem.",
      "Máš-li hodně krátkých dat, méně foldů (např. 3), aby v každém testu zůstalo rozumně mnoho svíček.",
      "Příliš mnoho foldů na krátké historii znamená hodně úzkých okének — metriky budou divočejší.",
    ],
    recommendedDefault: "4 foldy.",
    withoutIt:
      "Nevíš, jestli walk-forward dává smysl pro tvoje délku dat — špatný počet foldů může znamenat příliš krátké testy nebo zbytečně dlouhý běh.",
    bestPractices: [
      "Při porovnání strategií používej stejný počet foldů.",
    ],
  },
  wfTestRatio: {
    id: "wfTestRatio",
    title: "WF test ratio (jak velký je „test“ v každém kole)",
    whatItMeans:
      "Uvnitř každého walk-forward kola existuje **testovací část** — úsek, na kterém engine zkontroluje výsledek **po** tréninkové části toho kola. **Test ratio** říká: zhruba **jak velký podíl** z dat (v rámci logiky okna) připadá na ten test. " +
      "Není to totéž jako OOS ratio u splitu; tady jde o **vnitřní střídání** uvnitř walk-forward mechanismu.",
    whyItMatters:
      "Příliš krátký test = výsledek hlučný (málo obchodů). Příliš dlouhý test = zase ubere z tréninku. Tohle číslo nastavuje **tvrdost** kontroly v každém kroku.",
    howToUse: [
      "Běžně **0,15 až 0,25** (15–25 % testu v rámci okna).",
      "0,20 je rozumný výchozí bod.",
      "Strategie s málo častými obchody potřebuje delší testovací úseky — spíš spodní okraj rozsahu nebo méně foldů.",
    ],
    recommendedDefault: "0,20.",
    withoutIt:
      "Walk-forward může být vnitřně nevyvážený — těžko srovnáváš výsledky s dokumentací nebo s jinými běhy.",
    bestPractices: [
      "V jedné sérii experimentů drž stejné test ratio.",
    ],
  },
  minTradesGate: {
    id: "minTradesGate",
    title: "Gate min trades (nejméně obchodů)",
    whatItMeans:
      "**Quality gate** = jednoduchá pojistka: „tento běh beru vážně jen když…“. **Min trades** říká: strategie musí v daném testu uzavřít **alespoň tolik obchodů**, jinak engine označí gate jako neprošel. " +
      "Proč? Protože **3 obchody** mohou ukázat +300 % jen náhodou — jako kdybys házel mincí třikrát a dvakrát vyhrál. **Třicet obchodů** už je o něco víc informace (pořád ne konec světa, ale rozumnější).",
    whyItMatters:
      "Bez tohoto prahu můžeš nadšeně reagovat na výsledek, který je statisticky **tenký jako papír** — pár šťastných obchodů ti nesmí lhát o celkové kvalitě.",
    howToUse: [
      "Začni třeba **20**; pokud strategie obchoduje často, klidně **30+**.",
      "Velmi řídké strategie (málo signálů) — buď ber gate s rezervou, nebo potřebuješ **delší historii**, aby se obchodů nasbíralo víc.",
      "Gate je **filtr**, ne magie: stále můžeš projít s špatnou strategií, ale odfiltruje nejhorší „náhodné“ běhy.",
    ],
    recommendedDefault: "20–30 podle toho, jak často strategie vstupuje do trhu.",
    withoutIt:
      "Schválíš i běhy s 5 obchody — metriky jako Sharpe nebo zisk mohou vypadat extrémně jen kvůli malému vzorku.",
    bestPractices: [
      "Po zapnutí realistických nákladů (spread, skluz) často klesne počet „pěkných“ běhů — gate si zaslouží přehodnotit.",
    ],
  },
  maxDdGate: {
    id: "maxDdGate",
    title: "Gate max DD % (největší propustný propad)",
    whatItMeans:
      "**Drawdown (DD)** v procentech = **nejhlubší propad** účtu (nebo equity křivky) od nedávného vrcholu dolů — jako kdybys na chvíli z kapsy vytáhl hodně peněz a účet „klesl pod bod, kde byl nahoře“. " +
      "Toto pole říká: **pokud je propad hlubší než X %, běh neprošel branou**. Je to tvoje řečené **„takhle hluboko už nechci klesnout“** v rámci simulace. " +
      "**Důležité:** brána **nezastaví** backtest uprostřed — engine **dopočítá celý běh** a teprve pak označí PASS/FAIL (viz banner ve výsledcích). " +
      "U **futures / násobiče** může simulace skončit i se **záporným equity**; drawdown pak může být **i nad 100 %** (propad od vrcholu přes celý kapitál).",
    whyItMatters:
      "Strategie může být celkově v plusu, ale projít **děsivým údolím** — v reálu bys ji mezitím možná vypnul ze strachu. Gate tě chrání před „ziskovými“ výsledky, které psychicky nebo kapitálově neunesíš.",
    howToUse: [
      "Nastav podle toho, **kolik procent poklesu** by tě v reálném účtu ještě nechalo spát. Konzervativněji = menší číslo (přísnější).",
      "20–30 % bývá rozumný rozptyl pro začátek; agresivnější styl může mít vyšší toleranci — ale buď upřímný k sobě.",
      "Číslo je v **procentech** podle metriky engine (viz výsledky / Analytics).",
      "Chceš-li **nepřekročit** DD už během simulace, musíš to řešit v **logice strategie** (velikost pozice, stop-loss) — gate to za tebe nevypne.",
    ],
    recommendedDefault: "20–25 % pro opatrnější filtr; 30 % pokud víš, že strategie občas hlubší sjezdy dělá záměrně.",
    withoutIt:
      "Projdou i běhy s extrémním propadem — můžeš si myslet, že je vše super, dokud neuvidíš hloubku díry v křivce.",
    bestPractices: [
      "Spoj to s tím, jak velký účet reálně obchoduješ — stejný procentní propad bolí víc u většího kapitálu.",
    ],
  },
  minPfGate: {
    id: "minPfGate",
    title: "Gate min PF (nejmenší profit factor)",
    whatItMeans:
      "**Profit factor (PF)** zjednodušeně: **součet zisků** z uzavřených obchodů **dělený součtem ztrát** (obvykle jako kladné číslo; když ztráty skoro nejsou, engine může ukázat velmi vysoké číslo nebo speciální hodnotu). " +
      "**PF pod 1** znamená: celkové ztráty převáží zisky — dlouhodobě bys prodělával. **Gate min PF** říká: **nejhorší PF, který ještě akceptuju** (např. 1,2 = hrubé zisky musí být aspoň o 20 % vyšší než hrubé ztráty v tom měřítku, které engine počítá).",
    whyItMatters:
      "Bez dolního limitu projde spousta „mírně zelených“ nebo náhodných výsledků. PF gate je jednoduchý **filtr kvality** bez složité matematiky.",
    howToUse: [
      "Začni třeba **1,1–1,2** po zapnutí nákladů na exekuci; přísněji **1,3+**, pokud chceš jen silnější kandidáty.",
      "Čím víc tření v reálu (spread, skluz), tím **vyšší** min PF v simulaci často potřebuješ, aby to mělo smysl.",
    ],
    recommendedDefault: "1,2 jako rozumný start po započtení aspoň základních nákladů.",
    withoutIt:
      "Projdou i běhy s slabým poměrem zisk/ztráta — snadno si spleteš „trochu v plusu“ s opravdovým edge.",
    bestPractices: [
      "Vždy čti, jestli máš v běhu zapnutý **execution model** — jinak může být PF uměle nafouknutý.",
    ],
  },
  runFixedSeed: {
    id: "runFixedSeed",
    title: "Fixní run seed (pevné „semínko“ náhody)",
    whatItMeans:
      "Náhodné části v engine (např. náhodný sweep) vycházejí z čísla seed. Stejný seed + stejný kód a data dá stejné náhodné rozhodnutí.",
    whyItMatters:
      "Bez fixního seedu můžeš spustit „stejný“ test dvakrát a vidět **drobné rozdíly** v číslech — ne nutně proto, že by se změnil tvůj nápad, ale kvůli náhodné složce. Fixní seed je užitečný pro **ladění**, **sdílení výsledků** („u mě to dělá přesně tohle“) a **audit**.",
    howToUse: [
      "**Zapni** (a zapiš číslo seedu do poznámek), když chceš **opakovatelnost** — ladění bugů, audit, sdílení čísel.",
      "**Vypni** při čistém průzkumu, když chceš u sweepu jiný náhodný výběr každý run.",
    ],
    recommendedDefault: "Pro běžné zkoušení často vypnuto; pro regresní test nebo dokumentaci zapni a použij např. 42.",
    withoutIt:
      "Výsledky s náhodnými částmi se mezi běhy mohou **mírně lišit** — to může být záměr (robustnost) nebo matoucí (když čekáš identické číslo).",
    bestPractices: [
      "Seed se typicky ukládá do manifestu — při týmovém auditu ho **uveď v poznámce k runu**.",
      "Fixní seed **neznamená**, že je strategie jistá — jen že **tentokrát** byla náhoda stejná.",
    ],
  },
  experimentHypothesis: {
    id: "experimentHypothesis",
    title: "Hypotéza experimentu (co zkouším?)",
    whatItMeans:
      "Jedna **jasná věta**, která říká: **„Myslím si, že když udělám X, stane se Y, protože Z.“** Není to marketing — je to **předpověď**, kterou můžeš po běhu zkontrolovat: **vyšlo to, nebo ne?** " +
      "Příklad pro „dítě“: „Když přidám filtr na trend, **ubyde špatných obchodů v bočním trhu** a celkový výsledek bude stabilnější.“",
    whyItMatters:
      "Bez hypotézy často jen **měníš čísla**, dokud něco „nevypadá hezky“ — to je jako hledat klíč pod lampou, protože tam je světlo, i když jsi ho ztratil jinde. Hypotéza tě drží u **jednoho cíle** a pomůže za měsíc pochopit, **proč** jsi ten run vůbec dělal.",
    howToUse: [
      "Napiš **konkrétně**: co měníš (parametr, pravidlo, data) a **co očekáváš** (méně obchodů, lepší drawdown, stejný zisk při menším riziku…).",
      "Vyhni se větám typu „chci lepší strategii“ — to není ověřitelné.",
      "Po runu si odpověz: **hypotéza potvrzena / vyvrácena / nejasné** — a podle toho pokračuj.",
    ],
    recommendedDefault: "Jedna krátká věta, kterou by pochopil i někdo mimo tvůj obor.",
    withoutIt:
      "Získáš hromadu běhů, které dohromady **nedávají příběh** — těžko řekneš, co fungovalo a co byla náhoda.",
    bestPractices: [
      "Když se hypotéza **zásadně změní**, zvaž novou **větev experimentu** (branch), ať se výsledky nemíchají.",
    ],
  },
  experimentTagsCsv: {
    id: "experimentTagsCsv",
    title: "Tagy experimentu (CSV — štítky)",
    whatItMeans:
      "**Tag** = nálepka na složce. Sem napíšeš **krátké štítky oddělené čárkou**, např. `NQ, trend, v2, oos`. Aplikace je pak může použít k **filtrování a hledání** v historii běhů — jako kdybys si na každý pokus nalepil barevné samolepky.",
    whyItMatters:
      "Po deseti bězích si vše pamatuješ. Po stovce **ne**. Tagy jsou nejjednodušší způsob, jak si **rychle vyfiltrovat** „všechny pokusy na stejném trhu“ nebo „všechny verze po úpravě vstupu“.",
    howToUse: [
      "Drž tagy **krátké a konzistentní**: instrument, typ setupu, verze logiky, režim validace.",
      "Nepiš román — 3–6 tagů obvykle stačí.",
      "Domluv se s sebou samým (nebo týmem) na **stejných názvech** — jinak máš `nq`, `NQ` a `Nasdaq` jako tři různé světy.",
    ],
    recommendedDefault: "3–5 tagů oddělených čárkou, bez mezer kolem čárek nebo jednotně.",
    withoutIt:
      "Historie běhů je jako pytel lentilek bez barev — **všechno stejné**, hůř se orientuješ.",
    bestPractices: [
      "Měj si „slovníček“ tagů v README nebo poznámkách — ušetří to chaos.",
    ],
  },
  experimentBranch: {
    id: "experimentBranch",
    title: "Větev běhu (branch)",
    whatItMeans:
      "**Branch** = **jméno větve** nebo **linky pokusů**. Představ si to jako větev na stromě: všechny běhy se stejným jménem větve patří k **jedné související sérii** (např. „přidávám filtr A“, zatímco jiná větev je „baseline bez filtru“). " +
      "Není to Git automaticky — je to **tvůj štítek** v rámci aplikace, aby šlo výsledky seskupovat.",
    whyItMatters:
      "Když porovnáváš běhy, chceš srovnávat **jablká s jablky**. Když smícháš „novou logiku“ a „starou logiku“ do jedné skupiny bez jmen, **ztratíš kontext** — jako kdybys míchal fotky z dovolené a z práce v jednom albu.",
    howToUse: [
      "Pro **hlavní fungující verzi** často `main` nebo `baseline`.",
      "Pro každou **větší změnu** (nový filtr, jiný výstup z modelu) založ **novou větev** s jasným jménem.",
      "Během **jedné srovnávací série** neměň název větve — jinak si rozbiješ časovou osu.",
    ],
    recommendedDefault: "main pro základ; experimenty jako krátké popisné názvy (např. filter_atr_v1).",
    withoutIt:
      "Všechny běhy vypadají jako **jeden velký shluk** — těžko řekneš, která změna k čemu patřila.",
    bestPractices: [
      "Pojmenovávej větve tak, aby byl za rok jasný **účel**, ne jen „test2“.",
    ],
  },
  promoteOnPass: {
    id: "promoteOnPass",
    title: "Povýšit kandidáta, když projdou brány (gates)",
    whatItMeans:
      "**Quality gates** jsou jednoduché **ano/ne kontroly** po běhu (např. dostatek obchodů, přijatelný propad, minimální profit factor). Když zapneš tuto volbu, systém **automaticky označí** běh jako **„kandidát k dalšímu sledování“**, pokud všechny nastavené brány projdou — jako razítko „prošlo kontrolou kvality“.",
    whyItMatters:
      "Ušetří ti to **ruční proklikávání** stovek běhů. Místo „co všechno jsem měl otevřít?“ máš **prioritu**: co splnilo tvoje pravidla.",
    howToUse: [
      "**Zapni až tehdy**, kdy máš brány nastavené **realisticky** (náklady na exekuci, rozumný počet obchodů…) — jinak si „povýšíš“ i slabé náhody.",
      "Pokud jsou brány **moc benevolentní**, automatické povýšení **zvýší iluzi jistoty**.",
    ],
    recommendedDefault: "Nejdřív si odladit prahy bran; pak zapnout pro rutinní workflow.",
    withoutIt:
      "Každý dobrý běh musíš **označit sám** — nic hrozného, jen více práce.",
    bestPractices: [
      "Brány ber jako **filtr hrubých neúspěchů**, ne jako důkaz, že strategie je „hotová“.",
    ],
  },
  sweepMode: {
    id: "sweepMode",
    title: "Režim prohledávání parametrů (sweep)",
    whatItMeans:
      "**Sweep** = místo jednoho nastavení strategie engine **vyzkouší víc kombinací** čísel (parametrů), které strategii patří — jako kdybys nezkoušel jen jednu teplotu pece na bábovku, ale **několik teplot** a podíval se, kde se to připaluje a kde je to syrové. " +
      "Typicky: **žádný** (nesweepuje), **náhodný výběr** kombinací z rozsahu, nebo **mřížka** (grid — systematicky po krocích).",
    whyItMatters:
      "Strategie často **žije nebo umírá na detailech**: malá změna čísla a z „geniální“ strategie je „náhodná“. Sweep ukáže, jestli je výsledek **stabilní** nebo jestli jsi jen **trefil jedno šťastné číslo**.",
    howToUse: [
      "**Nikdy** neber nejlepší výsledek ze sweepu jako důkaz sám o sobě — čím víc kombinací zkusíš, tím větší šance náhodného výskoku (trial count v Analytics).",
      "Kombinuj s **OOS nebo walk-forward** — jinak optimalizuješ jen na jednom kusu historie (jako učení se odpovědí na testu, který už znáš zpaměti).",
      "Začátek: **random** = rychle „pročechrá“ prostor; **grid** = když už víš zhruba úzký rozsah a chceš ho **projít pořádně**.",
    ],
    recommendedDefault: "Random pro první průzkum; grid až když už máš užší rozumný interval.",
    withoutIt:
      "Vidíš jen **jednu kombinaci** parametrů — snadno si nevšimneš, že vedle ní je propast.",
    bestPractices: [
      "Porovnávej **celé rozložení** výsledků, ne jen jeden špičkový bod.",
    ],
  },
  sweepSamples: {
    id: "sweepSamples",
    title: "Počet vzorků ve sweepu",
    whatItMeans:
      "Kolik **různých kombinací** parametrů se má ve sweepu **vyzkoušet** (v rámci limitů engine). Je to jako kolikrát **hodíš kostkou s různými nastaveními** — víc hodů = lepší představa, ale déle to trvá.",
    whyItMatters:
      "Málo vzorků = můžeš minout **důležité oblasti** prostoru parametrů. Hodně vzorků = přesnější obraz, ale **delší výpočet** a zase větší riziko „něco náhodou vyjde“.",
    howToUse: [
      "Začni **středně** (řádově desítky), podle toho, kolik parametrů měníš najednou.",
      "Když přidáváš **další dimenzi** (víc čísel najednou), často potřebuješ **víc vzorků**, aby pokrytí dávalo smysl.",
      "Při porovnávání dvou větví experimentu drž **stejný počet vzorků** — jinak srovnáváš hru s jiným počtem pokusů.",
    ],
    recommendedDefault: "24–48 jako rozumný start u strategií se několika parametry.",
    withoutIt:
      "Sweep může být **příliš mělký** — jako ochutnat polívku jen jednou míchnutím od povrchu.",
    bestPractices: [
      "Když sweep trvá věčnost, **zuž rozsah** parametrů místo slepého zvyšování vzorků do nebe.",
    ],
  },
  monteCarloEnabled: {
    id: "monteCarloEnabled",
    title: "Monte Carlo (přesunuto)",
    whatItMeans:
      "Monte Carlo už **nespouštíš z backtest konfigurace**. Shuffle simulace a prop-firm challenge běží v hlavní záložce **Monte Carlo** na uložených výsledcích runu.",
    whyItMatters:
      "Oddělení šetří čas běhu backtestu a dává samostatný prostor pro simulace a grafy v prohlížeči.",
    howToUse: [
      "Ulož výsledek backtestu, přepni na záložku Monte Carlo, vyber run vlevo a spusť typ simulace.",
      "Starší uložené runy mohou stále obsahovat pole `monteCarlo` z dřívějšího serverového výstupu.",
    ],
    recommendedDefault: "Nové analýzy řeš v záložce Monte Carlo.",
    withoutIt: "Shuffle / prop challenge z backtest menu nejde.",
    bestPractices: ["Pro srovnání drž stejný uložený run jako vstup."],
  },
  monteCarloSims: {
    id: "monteCarloSims",
    title: "Počet MC simulací (přesunuto)",
    whatItMeans: "Počet simulací nastavuješ v záložce **Monte Carlo** u konkrétního typu (shuffle / prop challenge).",
    whyItMatters: "Odděleno od běhu engine backtestu.",
    howToUse: ["Monte Carlo → zvol run → nastav počet simulací v hlavním panelu."],
    recommendedDefault: "Začni 300–500 shuffle běhů podle výkonu prohlížeče.",
    withoutIt: "—",
    bestPractices: ["Vyšší počet = hladší histogramy, ale delší výpočet v UI."],
  },
  perRegimeSegmentation: {
    id: "perRegimeSegmentation",
    title: "Per Regime — segmentace backtestu",
    whatItMeans:
      "Engine po doběhu přiřadí každému obchodu režim trhu (uptrend / downtrend / range) podle EMA a relativního ATR na stejném timeframe jako data, a spočte metriky a equity dílčími řadami.",
    whyItMatters: "Uvidíš, kde strategie tahá výkon a kde dře — a můžeš spustit Monte Carlo zvlášť po režimech.",
    howToUse: [
      "Zapni před runem v Edge finding → výsledky v Analytics (záložka Regime) a v hlavní záložce Regime.",
      "Monte Carlo: režim „po režimech“ je dostupný jen u runu s touto segmentací.",
    ],
    recommendedDefault: "Vypnuto pro rychlou iteraci; zapni při hlubší analýze robustnosti.",
    withoutIt: "Žádné byRegime metriky ani MC po režimech pro nové runy.",
    bestPractices: ["Stejný timeframe dat = stejná definice režimu — pro jiný HTF by bylo potřeba resampling (zatím ne)."],
  },
  regimeEnabled: {
    id: "regimeEnabled",
    title: "Regime segmentation (legacy popisek)",
    whatItMeans:
      "Historicky odstraněná položka — aktuální segmentace je **Per Regime** v sekci Edge finding.",
    whyItMatters: "—",
    howToUse: ["Použij „Per Regime — segmentace výsledků“ nad quality gates."],
    recommendedDefault: "—",
    withoutIt: "—",
    bestPractices: [],
  },
  portfolioEnabled: {
    id: "portfolioEnabled",
    title: "Portfolio backtest (odstraněno z menu)",
    whatItMeans:
      "Portfolio režim (více nástrojů v jednom běhu) už **není v backtest konfiguraci** — testuj **jednu strategii na jednom instrumentu**.",
    whyItMatters: "Jednodušší zaměření; nejsme multi-asset hedge-fund workflow.",
    howToUse: ["Starší runy mohou mít pole portfolio v uložených výsledcích."],
    recommendedDefault: "—",
    withoutIt: "—",
    bestPractices: [],
  },
  portfolioInstrumentsJson: {
    id: "portfolioInstrumentsJson",
    title: "Portfolio JSON (odstraněno z menu)",
    whatItMeans: "Konfigurace portfolia přes JSON už **není v UI**.",
    whyItMatters: "—",
    howToUse: [],
    recommendedDefault: "—",
    withoutIt: "—",
    bestPractices: [],
  },
  executionEnabled: {
    id: "executionEnabled",
    title: "Realistický model exekuce (tření reality)",
    whatItMeans:
      "Backtest bez tření je jako **bruslení po ledu** — krásně to klouže. Reálný trh má **spread** (rozdíl nákup/prodej), **skluz** (dostaneš horší cenu, než čekáš) a často **zpoždění** mezi signálem a skutečným obchodem. Tato volba říká: **počítej i s tímhle odérem**, aby čísla nebyla z **pohádky**.",
    whyItMatters:
      "Spousta „výnosných“ strategií je ve skutečnosti **arbitráž času a mikroskopických výhod**, které zmizí, jakmile zaplatíš pár bodů navíc na vstupu a výstupu. Bez exekučního modelu si snadno **nafoukneš ego** i equity.",
    howToUse: [
      "Zapni **před finálním verdiktem** „půjdu do toho“.",
      "Po zapnutí dolaď **spread**, **skluz × volatilita** a **latenci** podle reality (viz další pole).",
    ],
    recommendedDefault: "Zapnuto před vážným rozhodnutím; u prvních náčrtů logiky můžeš dočasně vypnout pro přehlednost.",
    withoutIt:
      "Výsledky bývají **optimistické** — strategie vypadá bohatší, než bys byl v reálu.",
    bestPractices: [
      "Kalibruj podle **reálných výpisů** od brokera nebo pozorování fillů, ne podle „ideální knihy“.",
    ],
  },
  spreadBps: {
    id: "spreadBps",
    title: "Spread (bps — body v desetitisícinách)",
    whatItMeans:
      "**Spread** = rozdíl mezi cenou, za kterou můžeš **koupit**, a za kterou můžeš **prodat** (zjednodušeně). **BPS** (basis points) jsou **malé jednotky**: 1 bps = **0,01 %** (jedna setina procenta). " +
      "Tady říkáš: **kolik „tření“ v těchto jednotkách** připočítat k obchodu — jako poplatek za to, že vstupuješ do trhu, kde už někdo stojí naproti s trochu jinou cenou.",
    whyItMatters:
      "I **drobný** spread při častém obchodování se **nasčítá** jako písek v botě — po dni chůze bolí noha víc, než čekáš.",
    howToUse: [
      "Nastav podle **likvidity** nástroje — u hlavních futures často menší čísla, u exotičtějších větší.",
      "Zvaž **denní dobu** obchodování (otevření, zprávy) — spread se umí **rozfouknout**.",
    ],
    recommendedDefault: "Konkrétní číslo závisí na trhu; začni konzervativněji a porovnej citlivost výsledku.",
    withoutIt:
      "Model **podcení náklady vstupu/výstupu** — zisky jsou uměle vyšší.",
    bestPractices: [
      "Proveď **citlivostní test**: co udělá výsledek při 2× větším spreadu?",
    ],
  },
  slippageVolMult: {
    id: "slippageVolMult",
    title: "Skluz × volatilita (násobič)",
    whatItMeans:
      "**Skluz** = dostaneš **horší cenu**, než čekáš (trh ti „ujede“). **Volatilita** = jak moc trh **skáče**. Tento **násobič** říká: když je trh **divočejší**, skluz má být **větší** — jako když jedeš rychleji, brzdná dráha se protáhne.",
    whyItMatters:
      "Strategie, která vypadá skvěle v **klidném roce**, může v **hurikánu** krvácet — protože přesně tehdy **nejhorší ceny** padají častěji.",
    howToUse: [
      "Začni na **1,0** jako neutrální bod.",
      "Zkus **1,5** jako **stress** — uvidíš, jestli edge není jen „ticho před bouří“.",
    ],
    recommendedDefault: "1,0; pro opatrnější scénáře zkus 1,2–1,5.",
    withoutIt:
      "Backtest může **podcenit** propady v turbulentních obdobích.",
    bestPractices: [
      "Porovnej výstupy **1,0 vs 1,5** u stejné strategie — velký rozdíl = **křehký** edge.",
    ],
  },
  latencyBars: {
    id: "latencyBars",
    title: "Latence (zpoždění ve svících)",
    whatItMeans:
      "**Latence** = čas mezi tím, co **strategie „vidí“ signál** a tím, kdy se obchod **opravdu provede**. Tady se měří ve **svících (bary)**: např. **1** znamená „obchod až o bar později“. " +
      "Analogie: vidíš autobus odjíždět — ale **doběhneš na zastávku až na další rozvrhový cyklus**.",
    whyItMatters:
      "U rychlých strategií změní **jedna svíčka** vstupní cenu tak, že z **malého edge** je **ztráta** — nebo naopak. Bez latence může backtest **přisuzovat nadpřirozenou přesnost**.",
    howToUse: [
      "**0** = ideální svět (okamžitý fill) — dobré na pochopení logiky, špatné jako finální pravda.",
      "**1+** = realističtější pro většinu lidí bez kolokační superpočítače vedle burzy.",
      "U intradenních systémů latenci **vždy** zkuste započítat.",
    ],
    recommendedDefault: "0 při ladění logiky; 1+ pro realistický stress.",
    withoutIt:
      "Strategie může vypadat, že **chytá ceny**, které v reálu **nestihneš**.",
    bestPractices: [
      "Odvoď od svého stacku: zpoždění dat, API, ruční klik, mobil…",
    ],
  },
  forwardBridgeEnabled: {
    id: "forwardBridgeEnabled",
    title: "Forward bridge (most za backtest)",
    whatItMeans:
      "**Bridge** = **most**. Backtest je **minulost v simulaci**. **Forward** je „co se děje **potom**“ — typicky **paper trading** (cvičný účet) nebo **stínění** reálného obchodu. Tato volba zapíná **navázání**: vezmeš si **referenci z backtestu** a pak sleduješ, jestli se chování **nesesype**, když už nejsi v té stejné uzavřené historii.",
    whyItMatters:
      "Backtest umí **lhát hezky** — forward fáze je první kontrola v **„životě po laboratoři“**. Most ti pomůže nepřerušit příběh mezi „výzkum“ a „sleduji to dál“.",
    howToUse: [
      "Zapni ve chvíli, kdy máš kandidáta, kterého chceš **sledovat dál** mimo jednorázový graf.",
      "Spoj to s **reálným exekučním modelem** a rozumnými branami — jinak most stavíš z **karet**.",
    ],
    recommendedDefault: "Zapnout při přechodu kandidáta do monitorovaného režimu (paper / shadow).",
    withoutIt:
      "Chybí **formální návaznost** mezi výzkumem a „co dělám teď“ — snadno se ztratí kontext.",
    bestPractices: [
      "U každého bridge běhu si **zapiš baseline** (viz další pole), ať víš, odkud porovnáváš.",
    ],
  },
  forwardBridgeMode: {
    id: "forwardBridgeMode",
    title: "Režim bridge (paper vs live stín)",
    whatItMeans:
      "Určuje **jak „tvrdou“ realitu** chceš po backtestu napodobit. **Paper** = bez reálného rizika, ale blíž pravdě než čistý graf. **Live shadow** = blíž **opravdovému trhu** (záleží na implementaci), obvykle víc stresu i víc realismu.",
    whyItMatters:
      "Skok **z backtestu rovnou do plného rizika** je jako naučit se plavat z obrázku v knížce — může to vyjít, ale často ne. Režim ti dává **schody** mezi simulací a realitou.",
    howToUse: [
      "Začni **bezpečnějším** režimem (paper / shadow), dokud nevidíš **stabilitu** chování.",
      "Na **tvrdší** režim přejdi až když rozumíš rozdílům a máš proces (riziko, velikost pozic, logy).",
    ],
    recommendedDefault: "Paper shadow jako první krok; live shadow až po zkušenosti.",
    withoutIt:
      "Chybí **jasně pojmenovaný** stupínek realismu — hůř se řídí očekávání.",
    bestPractices: [
      "Piš si poznámky: **co přesně** paper shadow v tvém setupu simuluje a co ne.",
    ],
  },
  forwardBridgeBaselineEquity: {
    id: "forwardBridgeBaselineEquity",
    title: "Baseline equity (výchozí úroveň křivky)",
    whatItMeans:
      "**Baseline** = **výchozí čára na metru**. Když pak sleduješ forward výkon, potřebuješ vědět: **odkud** jsi v backtestu **končil** — jinak porovnáváš jablka z jedné váhy s hruškami z druhé. Toto pole je ta **referenční hodnota equity** pro srovnání v bridge režimu.",
    whyItMatters:
      "Bez pevného startu forward části **nevíš**, jestli se ti daří **lepší než v backtestu**, **hůř**, nebo jestli jen **posunul graf** o jiné číslo.",
    howToUse: [
      "Nastav na **poslední rozumnou equity** z ověřeného backtestu (typicky závěrečná hodnota baseline běhu).",
      "Při **nové větvi** nebo velké změně strategie **baseline resetuj** — jinak srovnáváš nesouvisející éry.",
    ],
    recommendedDefault: "Shodná s finální equity referenčního backtestového běhu.",
    withoutIt:
      "Forward srovnání je **nekonzistentní** — grafy „plavou“ bez pevného kotvení.",
    bestPractices: [
      "Ulož baseline do poznámky k runu spolu s datem a verzí kódu.",
    ],
  },
  monteCarloMode: {
    id: "monteCarloMode",
    title: "Režim Monte Carla (shuffle v UI)",
    whatItMeans:
      "Záložka **Monte Carlo** aktuálně nabízí **náhodné přeřazení celých obchodů** (shuffle) z uloženého runu — obdoba IID bootstrapu z jedné série PnL. Režim **block bootstrap** zde dnes není; lze ho doplnit jako další model motoru.",
    whyItMatters: "Různé způsoby resamplování mění odhad „ocasu“ u korelovaných výsledků.",
    howToUse: ["Shuffle použij jako rychlý robustness check po uložení runu."],
    recommendedDefault: "—",
    withoutIt: "—",
    bestPractices: ["U málo obchodů buď na výsledky opatrný."],
  },
  batchMatrix: {
    id: "batchMatrix",
    title: "Matrix / dávkové běhy (odstraněno z menu)",
    whatItMeans:
      "Spouštění více variant v jednom requestu (`batch_config`) už **z klienta nekonfiguruješ** — jeden Run = jedna strategie, jeden instrument.",
    whyItMatters: "Méně multiple-testing pastí a jednodušší mentální model.",
    howToUse: ["Starší výsledky mohou mít batchSummary z dřívějších běhů."],
    recommendedDefault: "—",
    withoutIt: "—",
    bestPractices: [],
  },
  batchEnabled: {
    id: "batchEnabled",
    title: "Batch / matrix (odstraněno z menu)",
    whatItMeans: "Přepínač matrix runů už **není v backtest konfiguraci**.",
    whyItMatters: "—",
    howToUse: [],
    recommendedDefault: "—",
    withoutIt: "—",
    bestPractices: [],
  },
  batchMaxRuns: {
    id: "batchMaxRuns",
    title: "Max. běhů v dávce (odstraněno z menu)",
    whatItMeans: "—",
    whyItMatters: "—",
    howToUse: [],
    recommendedDefault: "—",
    withoutIt: "—",
    bestPractices: [],
  },
  batchItemsJson: {
    id: "batchItemsJson",
    title: "Položky dávky JSON (odstraněno z menu)",
    whatItMeans: "—",
    whyItMatters: "—",
    howToUse: [],
    recommendedDefault: "—",
    withoutIt: "—",
    bestPractices: [],
  },
  stressMultiplier: {
    id: "stressMultiplier",
    title: "Stress multiplier (execution model)",
    whatItMeans:
      "Násobí slippage a spread penalty v execution modelu faktorem > 1.0. " +
      "1.5× = cca o 50 % horší exekuce než baseline; 2.0× = dvojnásobné náklady — simuluje horší tržní podmínky (širší spread, větší skluz).",
    whyItMatters:
      "Reálná exekuce bývá horší než model. Stress test ukáže, zda edge přežije zvýšené náklady — důležité pro škálování a reálné obchodování.",
    howToUse: [
      "Nastav v execution modelu (nebo přes preset Prop conservative).",
      "Porovnej metriky při 1.0 vs 1.5 vs 2.0 — robustní edge klesne mírně, křehký zmizí.",
    ],
    recommendedDefault: "1.0 baseline; 1.5 stress test; 2.0+ extrémní scénář.",
    withoutIt: "Nevidíš citlivost edge na zhoršení exekuce.",
    bestPractices: ["Vždy porovnej stress vs non-stress u stejné konfigurace validace."],
  },
  drawdownDuration: {
    id: "drawdownDuration",
    title: "Drawdown duration & recovery",
    whatItMeans:
      "Engine měří délku nejdelšího drawdownu (v barech i dnech), čas návratu od dna k novému high a podíl času stráveného „pod vodou“.",
    whyItMatters:
      "Dvě strategie se stejným max DD % mohou psychologicky znamenat týdny vs. měsíce v krvácení.",
    howToUse: [
      "V StatBlocks najdeš DD Duration a Recovery.",
      "V Analytics → Drawdown analysis jsou detaily včetně počtu epizod.",
      "Recovery = prázdné znamená, že se equity k novému peaku nedostala.",
    ],
    recommendedDefault: "Jen čti výstup — není co ručně nastavovat.",
    withoutIt: "Vidíš jen hloubku DD, ne jak dlouho bolí.",
    bestPractices: ["Srovnej délky DD napříč runy se stejnou validací."],
  },
  tradePnlDistribution: {
    id: "tradePnlDistribution",
    title: "Trade PnL distribution",
    whatItMeans:
      "Engine z uzavrenych obchodu pocita histogram PnL, percentily (p1-p99), sikmost (skewness), spicatost (kurtosis), CVaR tail odhady a koncentraci zisku v top N obchodech.",
    whyItMatters:
      "Prumerny zisk/ztrata nestaci. Distribuce ukaze, zda je edge systematicky (mnoho malych zisku) nebo zavisi na par outlierech (top 5 obchodu = 80 % zisku).",
    howToUse: [
      "V Analytics > Trade PnL distribution jsou histogram, percentily, tail CVaR a koncentrace.",
      "Pokud top5PnlPct > 70 %, UI zobrazi varovani — edge je fragile.",
      "CVaR 5% ukazuje prumernou ztratu v nejhorsich 5 % obchodu.",
    ],
    recommendedDefault: "Engine pocita automaticky. Sleduj skewness (kladna = vic pravych vyheru, zaporna = vic levych ztrat).",
    withoutIt: "Nevidis tvar distribuce a tail riziko — muzes prihlednouti k vysokemu prumeru, ktery stoji na jednom obchodu.",
    bestPractices: ["Kombinuj s WF validací; tail risk přes záložku Monte Carlo po uložení runu."],
  },
  bootstrapCI: {
    id: "bootstrapCI",
    title: "Bootstrap confidence intervals",
    whatItMeans:
      `Engine provede tisíc opakování: z tvých obchodů pokaždé náhodně vybere vzorek (s opakováním) a spočítá metriku. ` +
      `Ze všech výsledků udělá **95% interval** — říká ti: „s touto nejistotou je tvůj skutečný edge někde tady."`,
    whyItMatters:
      "Čísla na obrazovce jsou **bodové odhady** z jedné historie. CI ti řekne, **jak moc jim věřit**. " +
      "Pokud CI pro mean PnL obsahuje nulu, **nemůžeš vyloučit, že strategie nemá edge** — to je klíčová informace.",
    howToUse: [
      "Podívej se na **[ciLow, ciHigh]** pro mean PnL — pokud obě strany jsou kladné, máš silnější signál.",
      "Širší CI = více nejistoty, potřebuješ víc obchodů nebo delší data.",
    ],
    recommendedDefault: "Engine počítá automaticky (1000 resamplů, α = 0.05). Min. 5 obchodů.",
    withoutIt: "Vidíš jen jedno číslo bez představy o jeho spolehlivosti — snadno přeceníš náhodný výsledek.",
    bestPractices: [
      "CI předpokládá i.i.d. obchody — u sériově korelovaných strategií mohou být intervaly příliš úzké.",
      "Kombinuj s walk-forward; tail scénáře doplň v záložce Monte Carlo.",
    ],
  },
  payoffDecomposition: {
    id: "payoffDecomposition",
    title: "Payoff decomposition (edge equation)",
    whatItMeans:
      "Rozloží tvůj edge na dvě složky: **win rate** (jak často vyděláváš) a **payoff ratio** (kolik vyděláš vs kolik ztratíš). " +
      "**Edge = WR × AvgWin − LR × AvgLoss.** Kelly fraction pak říká, jaký podíl kapitálu nasadit za ideálních podmínek.",
    whyItMatters:
      "Můžeš mít vysoký win rate, ale mizerný payoff ratio — nebo naopak. Obojí je validní strategie, ale vyžaduje " +
      "**úplně jiný position sizing a psychologii**. Bez dekompozice to nevidíš.",
    howToUse: [
      "Porovnej payoff ratio s win rate — payoff ratio < 1 vyžaduje win rate > 50%.",
      "Kelly fraction ber jako **horní limit** — reálně nasazuj **polovinu nebo méně** (half-Kelly).",
    ],
    recommendedDefault: "Engine počítá automaticky. Kelly je informativní, ne recept.",
    withoutIt: "Nevidíš proč edge funguje (nebo nefunguje) — jenom že expectancy je kladná/záporná.",
    bestPractices: ["Zkontroluj, zda edge nestojí na jednom obrovském výhru — kombinuj s koncentrací a CVaR."],
  },
  trialCount: {
    id: "trialCount",
    title: "Trial count & multiple testing",
    whatItMeans:
      `Kolik různých konfigurací jsi testoval v tomto sezení (hlavní run + param test + sweep). ` +
      `**Naive Bonferroni α** = 0.05 / počet pokusů — hrubý odhad, jak přísný by měl být tvůj práh „signifikance".`,
    whyItMatters:
      `Čím víc věcí zkusíš, tím spíš něco „funguje" náhodou. Pokud testuješ 20 konfigurací a jedna má Sharpe 1.5, ` +
      `**pravděpodobnost, že to je náhoda, je 20× vyšší** než u jednoho testu.`,
    howToUse: [
      `Sleduj trialCount v Analytics — je to tvůj „metr poctivosti".`,
      "Naive adjusted α ti řekne: pod tímto prahem bys nemohl tvrdit significance ani s mnoha pokusy.",
    ],
    recommendedDefault: "Engine počítá automaticky. Zobrazeno v manifestu a UI.",
    withoutIt: `Zapomeneš, kolik věcí jsi zkusil — a „nejlepší" výsledek vypadá jistěji, než je.`,
    bestPractices: ["Drž trial count co nejnižší — méně testů = silnější evidence z každého testu."],
  },
  propRedFlags: {
    id: "propRedFlags",
    title: "Prop-level red flags & trust assessment",
    whatItMeans:
      "Automatická detekce podezřelých vzorů ve výsledcích: extrémní Sharpe, málo obchodů, žádné ztráty, " +
      "PF nekonečno, příliš hladká equity, CI zahrnující nulu, koncentrovaný PnL. Každý flag má severity " +
      "(critical / warning / info) a celkový trust level (not_trustworthy / low_trust / cautious / acceptable).",
    whyItMatters:
      "Backtest s krásnými čísly, který má 3 critical red flags, je pravděpodobně curve-fit. " +
      "Red flags tě nutí ověřit, proč výsledky vypadají tak dobře — nebo tak špatně.",
    howToUse: [
      "V Analytics najdi 'Trust assessment' banner — barva a severity signalizují míru důvěryhodnosti.",
      "Klikni na jednotlivé flagy a přečti detail s doporučením.",
    ],
    recommendedDefault: "Engine počítá automaticky. Nelze vypnout.",
    withoutIt: "Hezká čísla bez kontextu — snadno přeceníš výsledek založený na 15 obchodech a Sharpe 4.",
    bestPractices: [
      "Nuluj critical flagy dříve, než bereš výsledek vážně.",
      "Single run + execution off = minimum credibility. Zapni obojí.",
    ],
  },
  propConservativePreset: {
    id: "propConservativePreset",
    title: "Prop conservative preset",
    whatItMeans:
      "Nejpřísnější přednastavení: WF 5 foldů, min 50 obchodů, max DD 15%, PF ≥ 1.5, " +
      "execution se spread 1.5 bps, slippage ×vol 2, latency 1 bar, stress multiplier 1.5×. " +
      "Param test automaticky v train-only režimu.",
    whyItMatters:
      "Odpovídá tomu, co by požadoval prop firma reviewer — přísné podmínky, realistická exekuce, robustní validace.",
    howToUse: [
      "V Edge finding klikni na 'Prop conservative' tlačítko.",
      "Případně uprav jednotlivé hodnoty — preset je výchozí bod, ne dogma.",
    ],
    recommendedDefault: "Použij jako základ pro seriózní validaci. Uprav dle potřeby.",
    withoutIt: "Musíš ručně nastavit desítku parametrů pro přísnou konfiguraci.",
    bestPractices: ["Po WF zvaž doplnit analýzu v záložce Monte Carlo na uložených runech."],
  },
  validationWalkForward: {
    id: "validationWalkForward",
    title: "Walk-forward / OOS (trénink vs test)",
    whatItMeans:
      "Představ si učebnici: **in-sample** = učíš se na příkladech a pak **test** = zkouška z **jiné kapitoly**, kterou sis „nepředčítal“ při ladění. **OOS** (out-of-sample) = část dat **necháš stranou** jako zkoušku. " +
      "**Walk-forward (WF)** = tuto zkoušku **opakuješ v oknech**: jako kdybys po půl roce dostal **novou kapitolu** a znovu zkoušel, jestli to, co ses naučil dřív, **pořád platí** — ne jen jednou náhodou v jednom roce.",
    whyItMatters:
      "Jeden dlouhý běh na všech datech je často **příliš sebevědomý** — optimalizuješ na minulost, kterou už vidíš celou. WF/OOS tě nutí ukázat: **funguje to i na části, kterou jsi „neštípal“ při návrhu?** " +
      "Pozor: **foldy nejsou nezávislé pokusy** jako 10 losů v loterii — pořád čerpáš z **jedné historie**, jen ji dělíš jinak.",
    howToUse: [
      "Nastav **počet foldů** a **podíl testu** podle toho, jak dlouhá data máš — moc krátké okno = málo obchodů = hlučný výsledek.",
      "V **Analytics** sleduj **tabulku po foldách** a případné **guardrails** (upozornění) — jsou to **heuristiky**, ne soudní verdikt.",
    ],
    recommendedDefault: "WF např. 4 foldy, test_ratio 0,2 jako rozumný start k dalšímu doladění.",
    withoutIt:
      "Držíš se **jednoho souvislého kusu** historie — snadno přehlédneš, že strategie funguje jen v jednom „počasí“ trhu.",
    bestPractices: [
      "V každém **testovém segmentu** kontroluj **počet obchodů** — jinak je výsledek jako anketa mezi třemi lidmi.",
      "Guardrails ber jako **červené vlaječky**, ne jako důkaz pravdy.",
    ],
  },
  pessimistPreset: {
    id: "pessimistPreset",
    title: "Pessimist preset",
    whatItMeans:
      "Jedn\u00edm tla\u010d\u00edtkem nastav\u00ed agresivn\u00ed execution model: spread 2 bps, slippage 3\u00d7 volatility, " +
      "latence 2 bary, stress multiplier 2\u00d7. Nem\u011bn\u00ed validaci ani jin\u00e1 nastaven\u00ed.",
    whyItMatters:
      "Re\u00e1ln\u00e1 exekuce je v\u017edy hor\u0161\u00ed ne\u017e model. Pesimistick\u00fd run okam\u017eit\u011b uk\u00e1\u017ee, " +
      "jestli tv\u016fj edge p\u0159e\u017eije brutální execution podm\u00ednky \u2014 pokud ne, nem\u00e1 smysl ho tradovat.",
    howToUse: [
      "Klikni na Pessimist v rychl\u00fdch profilech.",
      "Porovnej metriky s p\u016fvodn\u00edm runem \u2014 pokud edge zmiz\u00ed, je k\u0159ehk\u00fd.",
    ],
    recommendedDefault: "Pou\u017eij pro ka\u017ed\u00fd n\u00e1pad, kter\u00fd p\u0159e\u017eil z\u00e1kladn\u00ed test.",
    withoutIt: "Nevid\u00ed\u0161, jestli tv\u016fj edge je re\u00e1ln\u00fd nebo jen artefakt nulov\u00e9ho slippage.",
    bestPractices: ["Ka\u017ed\u00fd n\u00e1pad testuj minim\u00e1ln\u011b jednou s Pessimist presetem."],
  },
  underwaterChart: {
    id: "underwaterChart",
    title: "Underwater equity (drawdown %)",
    whatItMeans:
      "Graf drawdown % v \u010dase pod hlavn\u00ed equity k\u0159ivkou. Uk\u00e1\u017ee jak hlubok\u00e9 a jak dlouh\u00e9 " +
      "jsou propady \u2014 \u201ejak dlouho jsi v pekle\u201c.",
    whyItMatters:
      "Jeden \u010d\u00edslo Max DD % nepostihuje \u010dasov\u00fd rozm\u011br bolesti. Strategie se stejn\u00fdm DD " +
      "m\u016f\u017ee m\u00edt 2 t\u00fddny nebo 6 m\u011bs\u00edc\u016f underwater \u2014 psychologicky a finan\u010dn\u011b " +
      "obrovsk\u00fd rozd\u00edl.",
    howToUse: [
      "V z\u00e1lo\u017ece Equity se graf zobrazuje automaticky.",
      "Sleduj \u201e% bar\u016f pod vodou\u201c \u2014 v\u00edce ne\u017e 50 % znamen\u00e1 v\u011bt\u0161inu \u010dasu v propadu.",
    ],
    recommendedDefault: "V\u017edy sleduj spolu s equity k\u0159ivkou.",
    withoutIt: "Vid\u00ed\u0161 jen p\u011bknou k\u0159ivku equity a ignoruje\u0161 bolest drawdown\u016f.",
    bestPractices: ["\u0160irok\u00e9 + hlubok\u00e9 underwater oblasti = strategie nen\u00ed vhodn\u00e1 pro re\u00e1ln\u00fd trading."],
  },
  runNote: {
    id: "runNote",
    title: "Pozn\u00e1mka k runu (journal)",
    whatItMeans:
      "Voln\u00fd text, kter\u00fd si m\u016f\u017ee\u0161 p\u0159ipsat k v\u00fdsledk\u016fm runu. " +
      "Export se do repro bundle (run_note.txt).",
    whyItMatters:
      "Bez pozn\u00e1mek za t\u00fdden nevid\u00ed\u0161, PRO\u010c jsi ten run spustil a CO jsi zjistil. " +
      "Journal je z\u00e1klad discipl\u00edny.",
    howToUse: [
      "Klikni na tla\u010d\u00edtko \u201ePozn\u00e1mka\u201c vedle export tla\u010d\u00edtek.",
      "Napi\u0161 hypot\u00e9zu, co testujes a co jsi zjistil.",
    ],
    recommendedDefault: "Ke ka\u017ed\u00e9mu runu napi\u0161 aspo\u0148 jednu v\u011btu.",
    withoutIt: "Ztr\u00e1c\u00ed\u0161 kontext research procesu.",
    bestPractices: ["Zapisuj hypot\u00e9zu P\u0158ED runem a zji\u0161t\u011bn\u00ed PO."],
  },
  artifactViewHlSdCache: {
    id: "artifactViewHlSdCache",
    title: "View: H/L + S/D z cache (.backtest_artifacts)",
    whatItMeans:
      "Zapnuto = vrstvy high/low a S/D z\u00f3n se berou z p\u0159edpo\u010dten\u00fdch artefakt\u016f (stejn\u00fd dataset_id jako u \u0161t\u00edtku Cache), ne z \u017eiv\u00e9ho vol\u00e1n\u00ed modulu na klientovi. " +
      "Vypnuto = klasick\u00e9 View: modul/indik\u00e1tor/strategie po\u010d\u00edt\u00e1 v\u00fdstup z aktu\u00e1ln\u00edho k\u00f3du.",
    whyItMatters:
      "Backtest se strategi\u00ed USE_SD_ARTIFACTS m\u00e1 sed\u011bt se stejn\u00fdmi z\u00f3nami jako po Build features. Cache re\u017eim ve View ti uk\u00e1\u017ee p\u0159esn\u011b ty z\u00f3ny; live re\u017eim m\u016f\u017ee kv\u016fli jin\u00e9mu oknu, k\u00f3du nebo TF vypadat jinak.",
    howToUse: [
      "P\u0159epni **Vrstvy** na P\u0159edpo\u010dten\u00e9 artefakty, ov\u011b\u0159 stav cache (\u0161t\u00edtek), p\u0159\u00edpadn\u011b spus\u0165 **Build features**.",
      "Build v\u017edy po\u010d\u00edt\u00e1 na **cel\u00fd** data_file; **Obdob\u00ed** ve View jen zu\u017euje co vid\u00ed\u0161 na grafu.",
      "Strategick\u00fd parametr use_sd_artifacts v backtestu mus\u00ed m\u00edt k dispozici cestu k Parquet z runneru (viz README / pipeline).",
    ],
    recommendedDefault: "P\u0159i lad\u011bn\u00ed shody View\u2194backtest zapni cache; p\u0159i \u00faprav\u00e1ch algoritmu \u010dasto vypni a kontroluj live v\u00fdstup.",
    withoutIt: "Porovn\u00e1v\u00e1\u0161 jen \u017eiv\u00fd v\u00fdpo\u010det, ne nutn\u011b stejn\u00e9 z\u00f3ny jako v engine s artefakty.",
    bestPractices: [
      "Kter\u00e9 TF z\u00f3n strategie pou\u017e\u00edv\u00e1 \u0159e\u0161\u00ed **zone_timeframes** v PARAMS; artefakty u\u017e obsahuj\u00ed v\u0161echny TF \u017eeb\u0159\u00ed\u010dku Buildu.",
      "dataset_id na \u0161t\u00edtku = **data_file** + fingerprint (jeden kl\u00ed\u010d pro cel\u00fd soubor, ne z\u00fa\u017een\u00e9 Obdob\u00ed ve View).",
    ],
  },
  artifactViewDatasetStatus: {
    id: "artifactViewDatasetStatus",
    title: "View: stav cache (dataset)",
    whatItMeans:
      "Shrnut\u00ed, jestli pro aktu\u00e1ln\u00ed data existuj\u00ed H/L precompute a S/D zones v .backtest_artifacts (souhrn z API). " +
      "dataset_id identifikuje **data_file** + fingerprint cel\u00e9ho souboru (bez \u0159ezu podle Obdob\u00ed ve View); runner pro USE_SD_ARTIFACTS pou\u017e\u00edv\u00e1 stejn\u00fd kl\u00ed\u010d.",
    whyItMatters:
      "Bez \u00fasp\u011b\u0161n\u00e9ho buildu nem\u00e1 \u0161ma\u010dn\u00e9 H/L + S/D z cache co kreslit a backtest s artefacts sel\u017ee nebo spadne na legacy v\u00fdpo\u010det.",
    howToUse: [
      "Klikni Build features, kdy\u017e stav chyb\u00ed nebo je zastaral\u00fd po zm\u011bn\u011b dat.",
      "Obnovit stav znovu na\u010dte pr\u016fb\u011bh z backendu.",
      "Tooltip na \u0161t\u00edtku uk\u00e1\u017ee detail H/L a S/D pod-\u00fakol\u016f.",
    ],
    recommendedDefault: "P\u0159ed d\u016fle\u017eit\u00fdm runem zkontroluj zelen\u00fd / complete stav.",
    withoutIt: "Riskuje\u0161 nejasnosti, pro\u010d se z\u00f3ny v View a v runu li\u0161\u00ed.",
    bestPractices: ["Dr\u017e **stejn\u00fd data_file** ve View a v backtestu; Obdob\u00ed ve View je jen zobrazen\u00ed."],
  },
  artifactViewBuildFeatures: {
    id: "artifactViewBuildFeatures",
    title: "View: Build features",
    whatItMeans:
      "V panelu artefakt\u016f (po p\u0159epnut\u00ed **Vrstvy** na P\u0159edpo\u010dten\u00e9 artefakty) zvol **Kroky buildu**: **H/L**, **S/D z\u00f3ny**, nebo oboj\u00ed. **Dataset** je v\u017edy **data_file** z rozbalov\u00e1\u010dky instrumentu v\u00fd\u0161e \u2014 nez\u00e1vis\u00ed na tom, kter\u00fd modul/strategie m\u00e1\u0161 jen pro graf. Jen **S/D** = mus\u00ed u\u017e b\u00fdt H/L artefakt. " +
      "H/L precompute b\u011b\u017e\u00ed na **cel\u00fd** obsah **data_file** a na **ka\u017ed\u00fd timeframe** v intern\u00edm \u017eeb\u0159\u00ed\u010dku, pak S/D z\u00f3ny pro **v\u0161echny** tyto TF. **Obdob\u00ed** ve View se buildu net\u00fdk\u00e1 \u2014 jen omezuje, co se na grafu vykresl\u00ed. " +
      "Velk\u00e9 soubory mohou trvat **des\u00edtky minut**; HTTP 500 po dlouh\u00e9 \u010dek\u00e1n\u00ed: pod\u00edvej se do termin\u00e1lu **uvicorn** (traceback) nebo zda t\u011b proxy nep\u0159eru\u0161ila spojen\u00ed. " +
      "V\u00fdsledek se ulo\u017e\u00ed do workspace .backtest_artifacts (z\u00e1mek se po p\u00e1du procesu uvoln\u00ed, pokud PID u\u017e neb\u011b\u017e\u00ed).",
    whyItMatters:
      "Artefakty jsou zdroj pravdy pro USE_SD_ARTIFACTS a pro vrstvy z cache ve View \u2014 bez buildu nejsou Parquet z\u00f3ny k dispozici.",
    howToUse: [
      "Kroky buildu: H/L = swingy/BOS/trend do cache; S/D = z\u00f3ny z examples/sd_zones; oboj\u00ed = standardn\u00ed pln\u00fd pipeline.",
      "Po zm\u011bn\u011b dat, k\u00f3du H/L nebo S/D, nebo parametr\u016f z\u00f3n build spus\u0165 znovu.",
      "\u010cekni chybovou hl\u00e1\u0161ku pod tla\u010d\u00edtky, pokud build spadne.",
    ],
    recommendedDefault: "Build po ka\u017ed\u00e9 v\u00fdznamn\u011b\u0161\u00ed zm\u011bn\u011b konfigurace z\u00f3n nebo datasetu.",
    withoutIt: "use_sd_artifacts a cache vrstvy nemaj\u00ed garantovan\u011b data.",
    bestPractices: [
      "Kter\u00e9 TF z\u00f3n pou\u017e\u00edv\u00e1 **strategie** nastav\u00ed\u0161 v **zone_timeframes**; Build u\u017e p\u0159edpo\u010d\u00edt\u00e1 v\u0161echny TF \u017eeb\u0159\u00ed\u010dku.",
      "Build pipeline v\u017edy b\u011b\u017e\u00ed z repozit\u00e1\u0159ov\u00e9ho **Swing_HL** a **examples/sd_zones** \u2014 volba modulu HL_identificator ve View na backendov\u00fd precompute nesah\u00e1.",
      "Dlouh\u00e9 \u0159ady = dlouh\u00fd b\u011bh; sleduj log backendu.",
    ],
  },
  resultsEquityUsd: {
    id: "resultsEquityUsd",
    title: "V\u00fdsledky: Equity \u00fa\u010dtu (USD / broker)",
    whatItMeans:
      "K\u0159ivka equity z backtestu podle brokeru Backtraderu: zahrnuje velikost pozic, poplatky modelu, p\u0159\u00edpadn\u00fd execution stress z nastaven\u00ed.",
    whyItMatters:
      "To je hlavn\u00ed \u201epeni\u017een\u00ed\u201c pohled \u2014 kolik by \u00fa\u010det nabobtnal nebo proml\u010dl.",
    howToUse: [
      "Srovn\u00e1vej se stejn\u00fdm initial capital a execution nastaven\u00edm.",
      "P\u0158i OOS/WF pamatuj, \u017ee hlavn\u00ed k\u0159ivka je z pln\u00e9ho b\u011bhu (viz banner ve StatBlocks).",
    ],
    recommendedDefault: "V\u017edy ji \u010dti spolu s druhou k\u0159ivkou (R) a drawdown metrikami.",
    withoutIt: "Vid\u00ed\u0161 jen abstraktn\u00ed R bez v\u00e1hy pen\u011bz a poplatk\u016f.",
    bestPractices: ["Pod\u00edvej se na underwater graf pod k\u0159ivkou."],
  },
  resultsEquityR: {
    id: "resultsEquityR",
    title: "V\u00fdsledky: Kumulativn\u00ed R (uzav\u0159en\u00e9 obchody)",
    whatItMeans:
      "Sou\u010det realizovan\u00e9ho R po obchodech; R odhad z PnL a odvozen\u00e9ho risku ze zoneMeta (entry, stop, size). Obchody bez platn\u00e9ho stopPrice v metadatech se do sou\u010dtu nepo\u010d\u00edtaj\u00ed.",
    whyItMatters:
      "Odd\u011bluje \u201ev\u00fdkonnost podle definovan\u00e9ho risku\u201c od nominalu \u00fa\u011btu \u2014 u\u017eite\u010dn\u00e9 pro srovn\u00e1n\u00ed styl\u016f vstup\u016f.",
    howToUse: [
      "Kdy\u017e k\u0159ivka chyb\u00ed, zkontroluj, \u017ee strategie pln\u00ed zoneMeta stop u z\u00e1kazn\u00ed m\u00edchy.",
      "Srovnej s blokem R-multiple ve statistik\u00e1ch.",
    ],
    recommendedDefault: "Pou\u017e\u00edvej vedle equity USD pro kontext risk-adjusted dr\u017eeni.",
    withoutIt: "M\u00f9\u017ee\u0161 p\u0159ece\u0148ovat strategii s velk\u00fdm size nebo \u0161t\u011bst\u00edm na volatilit\u011b.",
    bestPractices: ["Shoda R grafu a o\u010dek\u00e1v\u00e1n\u00ed strategie = dobr\u00fd sign\u00e1l konzistentn\u00edch metadat."],
  },
  resultsDetailedArtifactLayers: {
    id: "resultsDetailedArtifactLayers",
    title: "Detailed: vrstvy z .backtest_artifacts",
    whatItMeans:
      "Zapnuto = pro zobrazen\u00fd \u010dasov\u00fd v\u00fd\u0159ez se nat\u00e1hnou markery/linie/z\u00f3ny ve stejn\u00e9m form\u00e1tu jako ve View z cache (API view + adapter na ModuleOutput). " +
      "Vypnuto = standardn\u00ed detailed v\u00fdstup z b\u011bhu backtestu.",
    whyItMatters:
      "U strategi\u00ed s USE_SD_ARTIFACTS ov\u011b\u0159\u00ed\u0161, \u017ee vid\u00ed\u0161 stejnou geometrii z\u00f3n v detailu obchodu jako v p\u0159edpo\u010dtu.",
    howToUse: [
      "Vy\u017eaduje platn\u00e9 artefakty pro run (stejn\u00fd dataset jako p\u0159i b\u011bhu).",
      "P\u0159i chyb\u011b \u010dti banner nebo chybovou hl\u00e1\u0161ku pod checkboxem.",
    ],
    recommendedDefault: "Zapni p\u0159i debugu shody z\u00f3n mezi runem a vizualizac\u00ed.",
    withoutIt: "Detailed ukazuje pouze to, co engine ulo\u017eil v module outputu z simulace.",
    bestPractices: ["Kombinuj s View H/L+S/D z cache pro stejn\u00fd ment\u00e1ln\u00ed model."],
  },
  resultsRMultipleStats: {
    id: "resultsRMultipleStats",
    title: "Statistiky R-multiple (obchody)",
    whatItMeans:
      "Agregace z uzav\u0159en\u00fdch obchod\u016f, kde jde spo\u010d\u00edtat po\u010d\u00e1te\u010dn\u00ed riziko: z API pole initialRiskUsd, nebo z odvozen\u00e9ho |entry\u2212stop|\u00d7|size| (p\u0159. z metadatech obchodu). R = PnL / riziko. Obchody bez pot\u0159ebn\u00fdch \u00fadaj\u016f se vynechaj\u00ed.",
    whyItMatters:
      "Expect. R v m\u0159\u00ed\u017ek\u00e1ch PnL je hrub\u00fd proxy; tento blok ukazuje rozlo\u017een\u00ed skute\u010dn\u00fdch R tam, kde je riziko definovan\u00e9.",
    howToUse: [
      "Srovnej po\u010det \u201epo\u010d\u00edtan\u00fdch\u201c vs celkov\u00fd po\u010det obchod\u016f \u2014 velk\u00fd rozd\u00edl = chyb\u00ed definice rizika u v\u011bt\u0161iny obchod\u016f.",
      "Pou\u017eij percentily a medi\u00e1n pro odolnost proti jednomu outlieru.",
    ],
    recommendedDefault: "Kontroluj po ka\u017ed\u00e9 zm\u011bn\u011b logiky vstupu/v\u00fdstupu.",
    withoutIt: "\u0158\u00edk\u00e1\u0161 si, \u017ee strategie m\u00e1 R edge, ale nem\u00e1\u0161 spo\u010d\u00edtan\u00fd rozptyl.",
    bestPractices: [
      "Nech strategii konzistentn\u011b plnit initialRiskUsd nebo stop v metadatech, pokud chce\u0161 smyslupln\u00e9 R.",
    ],
  },
  sdZoneTestBreakevenMoveR: {
    id: "sdZoneTestBreakevenMoveR",
    title: "Breakeven (p\u0159esun SL na entry)",
    whatItMeans:
      "Po dosa\u017een\u00ed zadan\u00e9ho po\u010detu R ve prosp\u011bch (na sv\u00ed\u010dk\u00e1ch po entry baru) se stop-loss analyticky p\u0159esune na cenu vstupu. Pot\u00e9 u\u017e model \u0159e\u0161\u00ed jen z\u00e1sah c\u00edlov\u00e9ho winner R, z\u00e1sah entry (BE) nebo strop MFE.",
    whyItMatters: "Simuluje zaji\u0161t\u011bn\u00ed obchodu po jist\u00e9m pohybu ve prosp\u011bch, ani\u017e bys musel ru\u010dn\u011b filtrovat dotyky.",
    howToUse: [
      "Nap\u0159. 1 = po 1R ve prosp\u011bch je SL na entry; v\u00fdhra se po\u010d\u00edt\u00e1 a\u017e pokud je dosa\u017een winner threshold na nebo po t\u00e9to sv\u00ed\u010dce a p\u0159ed BE/SL z\u00e1sahy.",
      "Nech pr\u00e1zdn\u00e9 pro p\u016fvodn\u00ed chov\u00e1n\u00ed (BE z\u00e1znam jen jako prvn\u00ed n\u00e1vrat k entry z cesty).",
    ],
    recommendedDefault: "Pr\u00e1zdn\u00e9 (vypnuto) nebo 1 pro konzervativn\u00ed zaji\u0161t\u011bn\u00ed.",
    withoutIt: "SL z\u016fst\u00e1v\u00e1 po celou dobu u p\u016fvodn\u00edho modelu z\u00f3ny.",
    bestPractices: ["Slad\u011b s winner threshold: BE prah by m\u011bl b\u00fdt typicky \u2264 nebo bl\u00edzko c\u00edlov\u00e9mu R, kter\u00fd skute\u010dn\u011b chce\u0161 \u201elovat\u201c po zaji\u0161t\u011bn\u00ed."],
  },
  sdZoneTestSlMult: {
    id: "sdZoneTestSlMult",
    title: "Stop loss (mult v\u00fd\u0161ky z\u00f3ny)",
    whatItMeans:
      "Demand: stop = horn\u00ed hranice z\u00f3ny minus mult \u00d7 (value_high \u2212 value_low). Supply symetricky od spodn\u00ed hrany nahoru.",
    whyItMatters: "Definuje jednotku R (vzd\u00e1lenost vstup \u2192 stop) pro MFE/MAE a cap v R.",
    howToUse: [
      "1.25 odpov\u00edd\u00e1 125 % v\u00fd\u0161ky boxu od referen\u010dn\u00ed hrany (viz backend `stop_loss_from_zone_height`).",
      "Slad\u011b s t\u00edm, jak riskuje\u0161 retesty S/D v re\u00e1lu.",
    ],
    recommendedDefault: "1.25 jako v\u00fdchoz\u00ed experiment.",
    withoutIt: "Nelze interpretovat v\u00fdsledky v jednotk\u00e1ch R konzistentn\u011b.",
    bestPractices: ["Po zm\u011bn\u011b multu znovu spus\u0165 S/D precompute nepou\u017e\u00edv\u00e1\u0161 \u2014 dotyky jsou z artefaktu, SL jen analytick\u00fd model."],
  },
  sdZoneTestMaxMfeR: {
    id: "sdZoneTestMaxMfeR",
    title: "Cap MFE (R)",
    whatItMeans: "Forward scan se zastav\u00ed, jakmile nejlep\u0161\u00ed dosavadn\u00ed MFE dos\u00e1hne tohoto stropu v jednotk\u00e1ch R.",
    whyItMatters: "O\u0159ez\u00e1v\u00e1 extr\u00e9mn\u00ed outlier bar\u016f a stabilizuje agregace.",
    howToUse: ["Typicky 10R pro exploraci; sn\u00ed\u017e pro konzervativn\u011bj\u0161\u00ed report."],
    recommendedDefault: "10",
    withoutIt: "Dlouh\u00e9 trendy mohou zkreslovat pr\u016fm\u011bry.",
    bestPractices: ["Srovnej v\u00fdsledky p\u0159i 5R vs 10R, zda se \u0159ad\u00ed po\u0159ad\u00ed touch\u016f m\u011bn\u00ed."],
  },
  sdZoneTestRiskUsd: {
    id: "sdZoneTestRiskUsd",
    title: "Re\u017eim R vs USD",
    whatItMeans:
      "Re\u017eim R: metriky v R. USD: MFE/MAE se \u0161k\u00e1luj\u00ed jako R \u00d7 (equity \u00d7 risk_pct), p\u0159\u00edpadn\u011b risk_pct n\u00e1hodn\u011b v rozmez\u00ed se seedem.",
    whyItMatters: "Propojuje abstraktn\u00ed R s velikost\u00ed \u00fa\u010dtu a fixn\u00edm rizikem na obchod.",
    howToUse: [
      "Nastav equity shodn\u011b s \u00fa\u010dtem, risk_pct jako zlomek kapit\u00e1lu na jeden hypotetick\u00fd vstup.",
      "Rozsah min\u2013max + seed reprodukuje n\u00e1hodn\u00e9 riziko mezi runy.",
    ],
    recommendedDefault: "Za\u010d\u00ednej v R; USD pou\u017eij pro reporting t\u00fdmu.",
    withoutIt: "Chyb\u00ed kontext velikosti pozice.",
    bestPractices: ["Seed ukl\u00e1dej k v\u00fdsledk\u016fm, aby \u0161lo run zopakovat."],
  },
};

/** Plné popisy pro strategické PARAMS, kde Python PARAMS_META neobsahuje všechny sekce — sloučí se v getParamHelp. */
const PARAM_FALLBACK_OVERRIDES: Record<string, BacktestFieldHelp> = {
  use_sd_artifacts: {
    id: "use_sd_artifacts",
    title: "Strategie: z\u00f3ny z Parquet (USE_SD_ARTIFACTS)",
    whatItMeans:
      "Zapnuto = engine na\u010d\u00edte z\u00f3ny z p\u0159edpo\u010dten\u00e9ho zones.parquet v .backtest_artifacts m\u00edsto pln\u00e9ho v\u00fdpo\u010dtu S/D modulu uvnit\u0159 b\u011bhu. Vy\u017eaduje, \u017ee runner nastav\u00ed cestu k artefakt\u016fm (viz prom\u011bnn\u00e9 prost\u0159ed\u00ed / Docker pipeline).",
    whyItMatters:
      "Garantuje stejnou geometrii z\u00f3n jako po Build features a ve View z cache \u2014 eliminuje drift mezi view a backtestem.",
    howToUse: [
      "Nejd\u0159\u00edv dokon\u010dete Build features pro **stejn\u00fd data_file** (build jde v\u017edy p\u0159es cel\u00fd soubor).",
      "P\u0159i zm\u011bn\u011b dat nebo k\u00f3du/parametr\u016f z\u00f3n znovu Build; **zone_timeframes** v strategii jen vyb\u00edr\u00e1, kter\u00e9 TF z p\u0159edpo\u010dtu pou\u017e\u00edt.",
      "Legacy re\u017eim (bez artefakt\u016f) nechte vypnut\u00fd, pokud nezkoum\u00e1te star\u00e9 chov\u00e1n\u00ed.",
    ],
    recommendedDefault: "Zapnuto u workflowu zalo\u017een\u00e9ho na artefacts; vypnuto jen p\u0159i porovn\u00e1n\u00ed s live v\u00fdpo\u010dtem.",
    withoutIt: "Engine m\u016f\u017ee pou\u017e\u00edt jin\u00fd zdroj z\u00f3n ne\u017e View po buildu.",
    bestPractices: ["Dr\u017e dataset_id v souladu mezi UI, runnerem a soubory na disku."],
  },
  sd_artifact_only_with_trend: {
    id: "sd_artifact_only_with_trend",
    title: "Artefakt: jen z\u00f3ny with_trend",
    whatItMeans:
      "Filtr \u0159\u00e1dk\u016f v zones.parquet podle p\u0159edpo\u010dtu trendu (sloupec / flag z build pipeline). Plat\u00ed jen kdy\u017e use_sd_artifacts je zapnuto.",
    whyItMatters:
      "Zu\u017euje obchodov\u00e1n\u00ed jen na z\u00f3ny, kter\u00e9 build ozna\u010dil jako s trendem \u2014 mus\u00ed sed\u011bt s t\u00edm, co vid\u00ed\u0161 ve filtrovan\u00e9m exportu.",
    howToUse: [
      "Zap\u00ednej a\u017e po ov\u011b\u0159en\u00ed, \u017ee trendov\u00e1 klasifikace v artefaktech d\u00e1v\u00e1 smysl pro tv\u016fj TF.",
      "Porovnej po\u010det z\u00f3n s/v bez filtru v diagnostice.",
    ],
    recommendedDefault: "Podle hypot\u00e9zy u trendov\u00e9 strategie; jinak vypnuto.",
    withoutIt: "Obchoduj\u00ed se v\u0161echny z\u00f3ny z Parquet bez ohledu na p\u0159edpo\u010dt trendu.",
    bestPractices: ["Kombinuj s vizu\u00e1ln\u00ed kontrolou ve View z cache."],
  },
  entry_min_touch_tier: {
    id: "entry_min_touch_tier",
    title: "Vstup po \u00farovni dotyku z\u00f3ny",
    whatItMeans:
      "1 = povolen vstup po prvn\u00edm dotyku (nebo z\u00f3na bez druh\u00e9ho dotyku v datech). 2 = jen z\u00f3ny s druh\u00fdm dotykem (has_touch2 / touches\u22652 v artefaktu nebo modulech).",
    whyItMatters:
      "M\u011bn\u00ed, jak \u010dest\u00e9 jsou vstupy \u2014 vy\u0161\u0161\u00ed tier vy\u017eaduje v\u00edce potvrzen\u00ed od ceny.",
    howToUse: [
      "P\u0159i USE_SD_ARTIFACTS ov\u011b\u0159, \u017ee touch metadada v Parquet odpov\u00eddaj\u00ed o\u010dek\u00e1v\u00e1n\u00ed.",
      "Srovnej statistiky obchod\u016f mezi 1 a 2.",
    ],
    recommendedDefault: "Za\u010d\u00ednej na 1 pro v\u00edce vzorku; 2 pro konzervativn\u011bj\u0161\u00ed filtr.",
    withoutIt: "Vychoz\u00ed logika strategie rozhoduje bez explicitn\u00edho tier filtru v parametru.",
    bestPractices: ["Nem\u011b\u0148 tier uprost\u0159ed s\u00e9rie run\u016f bez z\u00e1znamu v hypothesis note."],
  },
};

export function getParamFallbackHelp(paramName: string, source: "PARAMS" | "VIEW_PARAMS"): BacktestFieldHelp {
  if (source === "PARAMS" && PARAM_FALLBACK_OVERRIDES[paramName]) {
    return PARAM_FALLBACK_OVERRIDES[paramName];
  }
  const normalized = paramName.replace(/_/g, " ");
  const prettyName = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  const isView = source === "VIEW_PARAMS";
  return {
    id: `dynamic-${source}-${paramName}`,
    title: prettyName,
    whatItMeans: `${source} parametr z Python kódu — ovlivňuje strategii nebo vykreslení.`,
    whyItMatters:
      "Bez kontextu snadno naladíš nahodile a ztratíš konzistenci mezi runy.",
    howToUse: [
      "Měň po malých krocích a sleduj quality gates.",
      "Po každé změně zkontroluj View nebo krátký baseline run.",
      isView
        ? "Ve View slouží parametr k rychlé vizuální kontrole."
        : "V backtestu měň jen s jasným důvodem v hypotéze.",
    ],
    recommendedDefault: "Drž výchozí hodnotu z kódu, dokud nemáš důvod měnit.",
    withoutIt: "Riziko nechtěné optimalizace na šum.",
    bestPractices: [
      "Doplň PARAMS_META / VIEW_PARAMS_META pro bohatší nápovědu.",
      "Zapisuj branch, tagy a hypothesis.",
    ],
  };
}
