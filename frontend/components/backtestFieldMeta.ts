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
  instrumentType: {
    id: "instrumentType",
    title: "Instrument Type",
    whatItMeans: "Volba trzniho segmentu, pro ktery se maji nacist data a pravidla vypoctu PnL.",
    whyItMatters: "Kazdy trh ma jinou mikrostrukturu a odlisny model nakladu.",
    howToUse: [
      "Pro index futures pouzij `futures`.",
      "Pro jednotlive akcie pouzij `stocks`.",
      "Pro FX pary pouzij `forex` a nastav lot/pip parametry.",
    ],
    recommendedDefault: "Zacni na trhu, ktery opravdu obchodujes (typicky futures).",
    withoutIt: "Muzes pouzivat spatny cenovy model a dostat nerealne vysledky.",
    bestPractices: ["Nemixuj typy trhu v jednom baseline runu.", "Pri zmene typu zkontroluj instrument config."],
  },
  instrument: {
    id: "instrument",
    title: "Instrument",
    whatItMeans: "Konretni symbol s historickymi daty (napr. NQ, ES).",
    whyItMatters: "Strategie muze fungovat na jednom trhu a selhavat na jinem.",
    howToUse: [
      "Vyber symbol, pro ktery mas realistickou obchodni hypotezu.",
      "Over, ze delka dostupnych dat pokryva tvoje testovaci obdobi.",
    ],
    recommendedDefault: "Pouzij hlavni trh strategie, ne nahodny symbol.",
    withoutIt: "Nebudes vedet, jestli edge opravdu patri k zamyslenemu trhu.",
    bestPractices: ["Pro porovnani trhu del samostatne branche."],
  },
  years: {
    id: "years",
    title: "Delka backtestu (roky)",
    whatItMeans: "Pocet let historie, ktere vstupuji do simulace.",
    whyItMatters: "Maly vzorek casto nadhodnocuje vykon a podhodnocuje drawdown.",
    howToUse: [
      "Pouzij minimalne tolik dat, aby strategie prosla vice trznimi rezimy.",
      "U kratkych intradennich edge je vhodna delsi historie.",
    ],
    recommendedDefault: "1-3 roky pro prvni iterace, vice pro finalni validaci.",
    withoutIt: "Hrozi, ze test zachyti jen prizenive obdobi trhu.",
    bestPractices: ["Pri zaverecnem hodnoceni testuj delsi horizont nez pri rychlem prototypu."],
  },
  tickSize: {
    id: "tickSize",
    title: "Tick Size",
    whatItMeans: "Minimalni cenovy krok futures kontraktu.",
    whyItMatters: "PnL i fill logika jsou zavisle na spravne granularite ceny.",
    howToUse: ["Nastav podle specifikace kontraktu brokera/exchange."],
    recommendedDefault: "NQ typicky 0.25.",
    withoutIt: "Backtest muze pocitat neexistujici ceny a zkreslit vysledky.",
    bestPractices: ["Pri zmene instrumentu tick size vzdy znovu over."],
  },
  valuePerTick: {
    id: "valuePerTick",
    title: "Value Per Tick (USD)",
    whatItMeans: "Kolik penez odpovida jednomu ticku pohybu ceny.",
    whyItMatters: "Primo urcuje velikost zisku/ztraty na obchod.",
    howToUse: ["Nastav dle kontraktovych specifikaci."],
    recommendedDefault: "NQ typicky 5 USD na tick.",
    withoutIt: "PnL bude v nespravne menove skale.",
    bestPractices: ["Vzdy validuj s realnymi contract specs."],
  },
  shareSize: {
    id: "shareSize",
    title: "Position Size (stocks)",
    whatItMeans: "Pocet akcii na obchod.",
    whyItMatters: "Riziko i navratnost jsou linearne zavisle na velikosti pozice.",
    howToUse: ["Nastav konzistentni velikost nebo navaz na risk model."],
    recommendedDefault: "100 akcii pro jednoduchy baseline.",
    withoutIt: "Srovnani runu bude nepresne kvuli rozdilne expozici.",
    bestPractices: ["Nemen size pri kazdem runu bez evidovaneho duvodu."],
  },
  lotSize: {
    id: "lotSize",
    title: "Lot Size (forex)",
    whatItMeans: "Objem obchodu ve forexe.",
    whyItMatters: "Urcuje nominalni expozici a citlivost na pip pohyb.",
    howToUse: ["Nastav podle pravidel risk managementu."],
    recommendedDefault: "1 lot jen pokud odpovida tvemu kapitalu; jinak mensi.",
    withoutIt: "Strategie muze vypadat nerealne agresivne nebo naopak prilis slabe.",
    bestPractices: ["Drz konzistentni risk na obchod napric runy."],
  },
  pipSize: {
    id: "pipSize",
    title: "Pip Size",
    whatItMeans: "Minimalni jednotka pohybu ceny pro forex par.",
    whyItMatters: "Ovlivnuje prepocet z cenoveho pohybu na pips a PnL.",
    howToUse: ["Nastav podle daneho paru (casto 0.0001, nekdy 0.01)."],
    recommendedDefault: "0.0001 pro vetsinu major paru.",
    withoutIt: "PnL metriky budou matematicky posunute.",
    bestPractices: ["U JPY paru over pip convention separatne."],
  },
  pipValue: {
    id: "pipValue",
    title: "Pip Value (USD)",
    whatItMeans: "Hodnota jednoho pipu v dolarech pri zvolenem lotu.",
    whyItMatters: "Urcuje citlivost equity na pohyb ceny.",
    howToUse: ["Nastav konzistentne s lotSize a menovym parem."],
    recommendedDefault: "10 USD je bezny orientacni baseline pro standard lot.",
    withoutIt: "Risk model nebude odpovidat realite.",
    bestPractices: ["Po zmene lotSize prepocitej i pipValue."],
  },
  initialCapital: {
    id: "initialCapital",
    title: "Pocatecni kapital",
    whatItMeans: "Startovni equity pro simulaci.",
    whyItMatters: "Ovlivnuje relativni metriky i odolnost strategie v drawdownu.",
    howToUse: ["Nastav realisticky kapital, se kterym bys strategii spoustel."],
    recommendedDefault: "100000 jako neutralni baseline pro porovnani.",
    withoutIt: "Srovnani runu bude matouci kvuli jine skale equity.",
    bestPractices: ["Nemen kapital mezi testy, pokud zrovna netestujes position sizing."],
  },
  slippagePerc: {
    id: "slippagePerc",
    title: "Slippage (%)",
    whatItMeans: "Prumerny skluz mezi ocekavanou a skutecnou fill cenou.",
    whyItMatters: "Bez slippage byva backtest nadhodnoceny oproti live exekuci.",
    howToUse: ["Nastav konzervativni odhad podle likvidity trhu a stylu vstupu."],
    recommendedDefault: "0.05%-0.15% podle trhu a timeframe.",
    withoutIt: "Hrozi optimistic bias, hlavne u rychlych strategii.",
    bestPractices: ["U volatilnich trhu testuj i horsi variantu slippage."],
  },
  commissionPerc: {
    id: "commissionPerc",
    title: "Komise (%)",
    whatItMeans: "Transakcni naklad za vstup/vystup obchodu.",
    whyItMatters: "Mala komise muze znicit edge u casto obchodujicich strategii.",
    howToUse: ["Zadej realnou uroven fee od brokera plus burzovni poplatky."],
    recommendedDefault: "Konzervativni realna hodnota, ne nula.",
    withoutIt: "Vyjde ti nerealne vysoky profit factor i cisty zisk.",
    bestPractices: ["Nejdriv testuj s realnymi fee, az pak optimalizuj logiku."],
  },
  selectedIndicatorIds: {
    id: "selectedIndicatorIds",
    title: "Indikatory",
    whatItMeans: "Seznam indikatoru, ktere se maji zahrnout do backtestu.",
    whyItMatters: "Nepotvrzene nebo nevybrane indikatory se do runu nepromitnou.",
    howToUse: [
      "Zaskrtni indikatory, ktere strategie vyzaduje.",
      "Po zmene vyberu klikni na Potvrdit.",
    ],
    recommendedDefault: "Pouzit jen indikatory, ktere strategie skutecne importuje.",
    withoutIt: "Backtest muze bezet bez potrebnych vypoctu nebo s jinou logikou.",
    bestPractices: ["Drz vyber minimalni a transparentni."],
  },
  selectedModuleIds: {
    id: "selectedModuleIds",
    title: "Moduly",
    whatItMeans: "Seznam modulu, jejichz vystupy a parametry se pouziji v runu.",
    whyItMatters: "Moduly casto nesou kontext (zony, markery), bez ktereho je signal nekompletni.",
    howToUse: [
      "Vyber relevantni moduly a potvrd vyber.",
      "Zkontroluj jejich VIEW_PARAMS v sekci Parameters.",
    ],
    recommendedDefault: "Zacni 1-2 moduly, ne vsechny najednou.",
    withoutIt: "Muzes testovat jinou strategii, nez sis myslel.",
    bestPractices: ["Pri pridani noveho modulu over nejdriv View mode."],
  },
  validationMode: {
    id: "validationMode",
    title: "Validation mode (režim ověření)",
    whatItMeans:
      "Říká aplikaci, jestli má strategii zkoušet jen „jako na jednom listu papíru“, nebo jestli si z dat vyhradí skrytou část, na které ji nikdy předtím neladíš — podobně jako když se učíš z učebnice a až pak dostaneš **test z kapitoly, kterou sis doma neprohlížel**. " +
      "**Single run** = celá historie najednou; strategie vidí všechna data „najednou“ a snadno se stane, že výsledek vypadá skvěle jen proto, že jsi (nevědomky) přizpůsobil logiku právě těm datům. " +
      "**OOS split** (out-of-sample) = data se rozdělí: větší kus použiješ jako „učení“ a menší kus je **záložní zkouška** — na tom druhém kusu engine spočítá výsledek zvlášť. " +
      "**Walk-forward** = opakuje se to víckrát za sebou: jako kdyby ses pořád posouval v čase — nejdřív trénuješ na starších datech a testuješ na kousek dopředu, pak okno posuneš a znovu; zjistíš, jestli strategie drží i když se mění období trhu.",
    whyItMatters:
      "Bez OOS nebo walk-forward je velmi snadné **přeladit strategii na minulost** (overfitting): graf vypadá krásně, ale v reálném obchodování selže. Tohle nastavení je nejjednodušší způsob, jak si říct: „opravdu to není jen náhoda na jednom úseku?“",
    howToUse: [
      "**Single** zapínej jen když chceš zkontrolovat, že kód vůbec běží, nebo když ladíš něco technického (ne finální rozhodnutí o penězích).",
      "Jakmile chceš věřit výsledku o trochu víc, přejdi na **OOS split** — je to rozumný kompromis mezi přísností a rychlostí.",
      "**Walk-forward** použij, když chceš nejpřísnější pohled: strategie musí obstát ve více „fázích“ času, ne jen jednou.",
      "Čím přísnější režim, tím déle může běh trvat — to je normální.",
    ],
    recommendedDefault: "Na běžné zkoušení: OOS split. Před tím, než bys strategii „posvětil“: walk-forward.",
    withoutIt:
      "Zůstaneš u iluze, že jeden pěkný graf = důkaz. Trh v budoucnu nemusí vypadat jako ten jeden úsek historie, který sis právě prohlížel.",
    bestPractices: [
      "Když zapneš **sweep** (hledání parametrů), vždy k tomu přidej OOS nebo walk-forward — jinak si jen systematicky hledáš „nejlepší číslo“ na stejných datech.",
    ],
  },
  oosRatio: {
    id: "oosRatio",
    title: "OOS ratio (kolik dat je „zkouška“)",
    whatItMeans:
      "Číslo mezi 0 a 1 (např. 0,25 = 25 %). Říká: **tolik procent nejnovějších dat si engine nechá stranou jako kontrolní test**. Starší část dat použije k běhu strategie na tréninkové části, ale výsledek na tom **vyhrazeném konci** počítá zvlášť — ty jsi na ten konec strategii „netrénoval“ očima ladění v této simulaci. " +
      "Představ si knihu: většinu kapitol použiješ na pochopení, ale poslední kapitolu si necháš jako **sudí**, který řekne, jestli to doopravdy chápeš.",
    whyItMatters:
      "Čím větší podíl OOS, tím **přísnější** je kontrola (méně místa na „nafouknutí“ výsledku na tréninku), ale zároveň **kratší** je část, na které strategie „trénuje“ — musíš balancovat.",
    howToUse: [
      "0,20 až 0,30 (20–30 %) bývá rozumný start: kontrolní kus není moc malý (pak by byl hlučný), ani moc velký (pak málo dat na trénink).",
      "0,25 znamená zhruba: poslední čtvrtina času = zkouška, první tři čtvrtiny = tréninková část simulace.",
      "Menší OOS (např. 0,10) používej jen když máš málo dat celkově — jinak je kontrola slabá.",
    ],
    recommendedDefault: "0,25 (čtvrtina dat jako kontrola).",
    withoutIt:
      "Všechno počítáš na stejném pásu dat bez odděleného „sudího“ úseku — snadno uvěříš výsledku, který platí jen pro ten jeden mix dat.",
    bestPractices: [
      "Když porovnáváš dva běhy, drž stejné OOS ratio, ať srovnání dává smysl.",
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
      "Toto pole říká: **pokud je propad hlubší než X %, běh neprošel branou**. Je to tvoje řečené **„takhle hluboko už nechci klesnout“** v rámci simulace.",
    whyItMatters:
      "Strategie může být celkově v plusu, ale projít **děsivým údolím** — v reálu bys ji mezitím možná vypnul ze strachu. Gate tě chrání před „ziskovými“ výsledky, které psychicky nebo kapitálově neunesíš.",
    howToUse: [
      "Nastav podle toho, **kolik procent poklesu** by tě v reálném účtu ještě nechalo spát. Konzervativněji = menší číslo (přísnější).",
      "20–30 % bývá rozumný rozptyl pro začátek; agresivnější styl může mít vyšší toleranci — ale buď upřímný k sobě.",
      "Číslo je v **procentech** podle metriky engine (viz výsledky / Analytics).",
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
      "Počítačová **náhoda** ve skutečnosti vychází z čísla zvaného **seed** (semínko). Když je seed **stejný** a vstupy (data, kód, parametry) jsou stejné, dostaneš **stejnou sekvenci** „náhodných“ rozhodnutí tam, kde ji engine používá — např. u některých **Monte Carlo** režimů, **náhodného sweepu** parametrů nebo **block bootstrapu**. " +
      "Analogie: místo pokaždé nové kostky si **označíš startovní hod** — při stejném označení padne stejná série hodů.",
    whyItMatters:
      "Bez fixního seedu můžeš spustit „stejný“ test dvakrát a vidět **drobné rozdíly** v číslech — ne nutně proto, že by se změnil tvůj nápad, ale kvůli náhodné složce. Fixní seed je užitečný pro **ladění**, **sdílení výsledků** („u mě to dělá přesně tohle“) a **audit**.",
    howToUse: [
      "**Zapni** (a zapiš číslo seedu do poznámek), když chceš **opakovatelnost** — např. kontroluješ bug nebo ukazuješ výsledek někomu jinému.",
      "**Vypni** při čistém průzkumu, když chceš, aby každý běh dostal **jinou náhodu** (typicky podle času).",
      "U **batch/matrix** běhů: stejný „parent“ seed často znamená **stejný start náhody v každém dílčím runu** — dobře pro srovnání konfigurací „jablko s jablkem“ (záleží na implementaci v manifestu).",
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
      "**Nikdy** neber nejlepší výsledek ze sweepu jako důkaz samo o sobě — čím víc zkoušíš, tím větší šance, že **něco** náhodou vyjde (viz varování u batch / multiple testing).",
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
    title: "Monte Carlo (náhodné „co kdyby“ scénáře)",
    whatItMeans:
      "**Jak to u nás přesně běží (pořadí kroků):** " +
      "1) **Nejdřív** engine **dokončí celý backtest** na datech — projde svíčky, strategie otevře/zavře obchody a vznikne **seznam uzavřených obchodů** s jejich **PnL**. " +
      "2) **Až potom**, stále **ve stejném jednom Runu** (stejný Docker/engine běh), engine z těchto obchodů udělá **Monte Carlo**: mnohokrát **náhodně přeskupí** (bootstrap) jejich zisky/ztráty podle zvoleného režimu a z toho spočítá např. **rozptyl drawdownu**, **konečné equity** a odhad **risk of ruin**. " +
      "**Neběží to „vedle sebe“ jako druhý paralelní backtest** — je to **druhá fáze** hned po tom hlavním: nejdřív simulace strategie, pak statistika z výsledných obchodů. " +
      "**Kde to uvidíš:** po doběhnutí běhu v **výsledcích** — v přehledu metrik / **Analytics** je sekce typu **Robustness & Monte Carlo** (počet simulací, metoda, režim, risk of ruin, poznámka). Ve struktuře výsledku je to pole **`monteCarlo`**. **Žádný samostatný progress bar jen pro MC** — prodlouží se celkový čas jednoho Run; loading pořád kryje celý výpočet. " +
      "Když strategie **neuzavře ani jeden obchod**, Monte Carlo **nemá z čeho počítat** a engine ho v podstatě přeskočí / vrátí hlášku, že MC nebylo možné.",
    whyItMatters:
      "Jedna historická křivka je **jeden příběh**. Trh v budoucnu **neopakuje** minulost řádek po řádku. MC ti z **těch samých** uzavřených obchodů ukáže, jak moc by se mohla změnit „škola“ **jiným pořadím** výsledků — jestli je výsledek spíš **robustní**, nebo **křehký**.",
    howToUse: [
      "Zapni u kandidátů, u kterých chceš kromě **jedné** equity křivky i **rozptyl rizika** po doběhnutí běhu.",
      "Po Run otevři **Analytics** (nebo horní přehled metrik) a najdi blok **Monte Carlo** — tam jsou čísla z té **druhé fáze**.",
      "Čti i **horší kvantily** (např. drawdown p90/p95), ne jen střed — a přečti si **note** u výsledku MC v UI.",
    ],
    recommendedDefault: "Zapnuto pro kandidáty, které už prošly základní logikou a validací dat.",
    withoutIt:
      "Výsledky uvidíš **bez** pole `monteCarlo` / bez bloku MC v Analytics — zůstane jen **jedna** naměřená cesta z backtestu.",
    bestPractices: [
      "MC **nedokazuje** budoucnost — je to **bootstrap z minulých obchodů** v tom běhu, ne model celého trhu.",
    ],
  },
  monteCarloSims: {
    id: "monteCarloSims",
    title: "Počet Monte Carlo simulací",
    whatItMeans:
      "Kolikrát se má celá ta **„přeházená hra“** zopakovat **až po dokončení backtestu** (každá simulace = jeden alternativní řetězec PnL z tvých uzavřených obchodů). " +
      "Málo simulací = obrázek **skákavý**; hodně simulací = **hladší odhad** rozložení, ale **délka druhé fáze** Runu roste (pořád je to **jeden** Run od začátku do konce).",
    whyItMatters:
      "S příliš malým počtem můžeš **přehlédnout ocas rizika** (vzácné, ale hodně bolavé situace) nebo naopak **vystrašit** z jednoho náhodného extrému.",
    howToUse: [
      "Na **rychlý průlet** stačí nižší číslo (minimum může engine omezit — typicky řád desítek a výš).",
      "Na **vážné rozhodnutí** přidej simulace — často řád **stovky**; výsledek uvidíš ve **stejném** výstupu Runu pod `monteCarlo` / v Analytics.",
      "Když porovnáváš dva běhy, použij **stejný počet** simulací.",
    ],
    recommendedDefault: "300–500 pro rozumný kompromis přesnosti a času.",
    withoutIt:
      "Odhad rozložení rizika může být **nestabilní** — jako měřit výšku vlny z jedné fotky.",
    bestPractices: [
      "Když výsledky MC divně skáčou mezi opakováními, zvyš počet simulací **nebo** zkontroluj počet obchodů a režim (IID vs block).",
    ],
  },
  regimeEnabled: {
    id: "regimeEnabled",
    title: "Segmentace podle režimu trhu",
    whatItMeans:
      "**Režim trhu** = „jak se trh právě chová“ v hrubých soudech: třeba **trenduje**, **jde do strany**, je **hodně nervózní** (volatilní) apod. Tato volba říká: **rozděl výsledky strategie podle těchto období** a ukaž, kde strategie **svítí** a kde **hasne**. " +
      "Analogie: stejný recept na bábovku — v horké troubě se připálí, ve studené zůstane syrový; **neříkej jen „bábovka je špatná“**, zjisti **v jaké troubě**.",
    whyItMatters:
      "Velmi často **edge není univerzální** — funguje třeba jen v silném trendu a v bočním trhu dělá díry na účtu. Bez režimů to vypadá jako **průměrně OK**, ale průměr může skrývat **dvě úplně jiné strategie v jednom kabátě**.",
    howToUse: [
      "Zapni ve fázi, kdy už máš **základní logiku** a chceš pochopit **kde přesně** vyděláváš.",
      "Čti výstupy jako **mapu**: „tady ano, tam ne“ — ne jako finální soud.",
    ],
    recommendedDefault: "Zapnout při hlubší analýze kandidáta, ne u prvního hrubého náčrtu.",
    withoutIt:
      "Můžeš si myslet, že strategie je **všestranná**, i když ve skutečnosti jen **trefila jeden typ roku** na trhu.",
    bestPractices: [
      "Kombinuj s **delší historií**, ať vidíš víc režimů než jednu sezónu.",
    ],
  },
  portfolioEnabled: {
    id: "portfolioEnabled",
    title: "Portfolio backtest (více nástrojů najednou)",
    whatItMeans:
      "Místo „jedna strategie na jednom trhu“ engine **spojí více instrumentů** do **jednoho portfolia** podle tvého nastavení — jako kdybys nekoupil jen jednu akcii, ale **košík** a díval se, jak se chová **celý košík dohromady** (zisk, propady, vzájemné vyrovnávání).",
    whyItMatters:
      "Někdy jeden trh **šumí**, jiný zrovna **trenduje** — rozložení může **zmírnit propady**, ale taky přidat **složitost** a riziko, že některá noha portfolia **táhne dolů** a ty to nevidíš, když se díváš jen na každý kus zvlášť.",
    howToUse: [
      "Nejdřív si ověř strategii **na jednom** trhu; portfolio je **další level** složitosti.",
      "Po zapnutí musíš vyplnit **JSON se seznamem** instrumentů, timeframe, období, vah — přesně podle formátu v nápovědě u pole JSON.",
    ],
    recommendedDefault: "Zapínat až po rozumném single-instrument výsledku a pochopení nákladů.",
    withoutIt:
      "Nevidíš **diverzifikaci** ani **koncentraci rizika** — jen jednotlivé díly, ne celek.",
    bestPractices: [
      "Zkontroluj, že **data pro každý nástroj existují** a že **váhy** dávají ekonomický smysl (např. odpovídají tomu, kolik kapitálu kam dáváš).",
    ],
  },
  portfolioInstrumentsJson: {
    id: "portfolioInstrumentsJson",
    title: "Portfolio — instrumenty (JSON)",
    whatItMeans:
      "Sem patří **technický zápis** (JSON) seznamu: **které trhy**, **jaký timeframe**, **jaké roky / soubory dat** a **jaké váhy** mají v portfoliu. Představ si to jako **nákupní seznam** pro počítač — musí být napsaný **přesně podle pravidel závorky**, jinak to parser nepochopí.",
    whyItMatters:
      "Jedna chyba v zápisu (čárka, uvozovka, špatný klíč) a test běží **na něčem jiném**, než si myslíš — jako kdybys objednal místo jablek **hrušky** a divil se, proč koláč chutná divně.",
    howToUse: [
      "Začni **2–3 jednoduchými řádky** (málo instrumentů, jednoduché váhy).",
      "Ověř, že každý řádek odkazuje na **existující data** v systému.",
      "Po úpravě vždy zkontroluj **validitu JSON** (čárky mezi objekty, uvozovky).",
    ],
    recommendedDefault: "Nejdřív zkopíruj vzor z dokumentace / výchozího pole a měň po jednom poli.",
    withoutIt:
      "Portfolio režim **neví**, co má obchodovat — chybí mu „seznam ingrediencí“.",
    bestPractices: [
      "Verzuj JSON do poznámky k hypotéze („portfolio v2: zvýšená váha NQ“).",
    ],
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
    title: "Režim Monte Carla (jak „mícháme“ minulost)",
    whatItMeans:
      "**Kdy se to aplikuje:** stejně jako celé MC **až po backtestu** — oba režimy pracují jen s **uzavřenými obchody** a jejich PnL z toho běhu; liší se jen **způsob míchání**. " +
      "**IID trade bootstrap** („nezávislé obchody“): bere uzavřené obchody a **losuje je z pytle** jako **kuličky**, které po každém vrátíš — pořadí se mění, ale **každý obchod je jen sám o sobě**. " +
      "**Block bootstrap** („bloky po sobě“): místo jednotlivých obchodů bere **celé souvislé kousky** PnL v **původním pořadí uvnitř bloku** a ty pak skládá — jako když stříháš **úseky videa** a skládáš je jinak, ale **záběry uvnitř úseku** necháš v původním sledu. " +
      "Proč? Protože obchody často **nejsou nezávislé** — jeden den špatné série může souviset s dalším.",
    whyItMatters:
      "Když jsou výsledky **navzájem podobné** (trend, série, držení pozic), IID může **podcenit** „špatné série po sobě“ nebo naopak **zkreslit ocas rizika**. Block bootstrap se snaží **respektovat souslednost** v datech.",
    howToUse: [
      "U **intradne**, **krátkých holdů** nebo **rychlého řetězení** signálů často dává smysl zkusit **block_bootstrap**.",
      "U **dlouhých swingů**, kde obchody působí **víc odděleně**, může **IID** stačit na první pohled.",
      "Vždy čti **method / mode / note** v JSON výstupu — tam je přesně popsáno, co engine udělal.",
    ],
    recommendedDefault: "IID pro rychlý první průchod; block bootstrap, když tušíš „lepení“ výsledků v čase.",
    withoutIt:
      "riskOfRuin a ocasová rizika mohou být **příliš růžová nebo příliš černá** podle struktury obchodů.",
    bestPractices: [
      "MC potřebuje **dost obchodů** — u 8 obchodů je každý režim spíš **hračka než věda**.",
    ],
  },
  batchMatrix: {
    id: "batchMatrix",
    title: "Batch / matrix (více běhů najednou)",
    whatItMeans:
      "**Batch** = **dávka**. Místo 20× klikat Run s drobnými změnami pošleš **jeden seznam variant** (JSON `items`): např. **jiný instrument**, **jiný soubor dat**, **jiné roky**. Backend pak **za sebou** spustí několik běhů se **stejným kódem** a sloučí základní nastavení s každou položkou. " +
      "Je to jako **stejný recept**, ale **jiné ingredience** v každé misce.",
    whyItMatters:
      "Čím víc mishek ochutnáš, tím větší šance, že **některá** náhodou chutná skvěle — i když recept není geniální. To se jmenuje **multiple testing** (mnoho pokusů = víc falešných „úspěchů“).",
    howToUse: [
      "Drž **max_runs** nízko na začátku — nejdřív **2–4** varianty s **jasnou otázkou** u každé.",
      "Každý objekt v `items` je jen **doplněk** k základnímu requestu — nemusíš opisovat vše znovu.",
    ],
    recommendedDefault: "Nejdřív malá dávka; plnou matici až s disciplínou a validací.",
    withoutIt:
      "Musíš **opakovat ručně** — pomalejší a snadno zapomeneš zapsat, co bylo jinak.",
    bestPractices: [
      "**Nepoužívej současně** s portfolio režimem (pravidla produktu).",
      "Exportuj / ulož **batchSummary** pro audit — ať víš, co přesně běželo.",
    ],
  },
  batchEnabled: {
    id: "batchEnabled",
    title: "Batch / matrix — zapnutí",
    whatItMeans:
      "Tímhle přepínačem řekneš aplikaci: **pošli konfiguraci dávky** na backend. Bez něj běží jen **jeden** standardní běh. Zapnutím povolíš, aby se z JSON položek poskládalo **víc běhů za sebou**.",
    whyItMatters:
      "Šetří čas, ale **zvýšíš počet pokusů** — musíš být opatrnější při interpretaci („jedna z deseti mi vyšla skvěle“ ≠ objev).",
    howToUse: [
      "Nejdřív **vypni portfolio** režim — **obojí najednou nesmí** (ochrana před chaosem).",
      "Po doběhnutí čti **batchSummary** a případné **multipleTestingWarning** ve výsledku.",
    ],
    recommendedDefault: "Vypnuto, dokud opravdu nepotřebuješ srovnat více konfigurací vedle sebe.",
    withoutIt:
      "Každou variantu spouštíš **ručně zvlášť** — pomalejší, ale někdy i **bezpečnější** pro přemýšlení.",
    bestPractices: [
      "Pro celou dávku drž **stejnou větev** a **stejné tagy** — ať z historie poznáš souvislost.",
    ],
  },
  batchMaxRuns: {
    id: "batchMaxRuns",
    title: "Max. počet běhů v dávce (strop)",
    whatItMeans:
      "**Strop** = **horní limit**, kolik položek z JSON `items` se smí **opravdu spustit**. Backend má také vlastní bezpečnostní limit (např. do **48**) — i kdybys chtěl milion pokusů, systém tě **chrání před sebou samým** (čas, náklady, náhodné úspěchy).",
    whyItMatters:
      "Bez stropu by šlo snadno udělat **100 rychlých pokusů**, najít jeden zelený a **prohlásit vítězství** — což statisticky skoro vždy někde vyjde.",
    howToUse: [
      "Začni **4–8**.",
      "Zvyšuj jen když máš **konkrétní hypotézu** pro každou položku v seznamu.",
    ],
    recommendedDefault: "8 pro první průchod; při čistém průzkumu klidně ještě méně.",
    withoutIt:
      "Backend stejně **omezuje** — hodnota v UI je hlavně tvoje **nastavení očekávání** a kontrola.",
    bestPractices: [
      "Při porovnání dvou strategií použij **stejný strop**.",
    ],
  },
  batchItemsJson: {
    id: "batchItemsJson",
    title: "Položky dávky (JSON pole)",
    whatItMeans:
      "Seznam **objektů** v hranatých závorkách `[ ... ]`. Každý objekt `{ ... }` říká: **v tomhle dílčím běhu změň jen tohle** oproti základnímu formuláři — např. jiný `instrument`, `data_file`, `timeframe`, `years`, části `params`. Zbytek se **dědí** ze společného nastavení.",
    whyItMatters:
      "Je to **nejrychlejší** způsob v UI udělat „tabulku pokusů“ bez opakovaného klikání — ale zároveň **nejrychlejší způsob**, jak si **rozbít JSON** jednou čárkou.",
    howToUse: [
      "Platné JSON pole, např. `[{\"instrument\":\"NQ\",\"data_file\":\"mock/NQ_5Y.csv\",\"timeframe\":\"1d\"}]`.",
      "Každá položka musí odkazovat na **existující datový soubor** a dávat smysl v kontextu strategie.",
    ],
    recommendedDefault: "Zkopíruj vzor z výchozího pole a měň **po jednom** poli.",
    withoutIt:
      "Dávku **nelze** rozumně definovat — zůstane jen jeden běh.",
    bestPractices: [
      "Verzuj JSON v poznámce k hypotéze.",
      "Po úpravě zkontroluj syntaxi: **čárky** mezi objekty, **uvozovky** kolem řetězců.",
    ],
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
};

export function getParamFallbackHelp(paramName: string, source: "PARAMS" | "VIEW_PARAMS"): BacktestFieldHelp {
  const normalized = paramName.replace(/_/g, " ");
  const prettyName = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  const isView = source === "VIEW_PARAMS";
  return {
    id: `dynamic-${source}-${paramName}`,
    title: prettyName,
    whatItMeans: `${source} parametr definovany v Python kodu.`,
    whyItMatters:
      "Bez dokumentace parametru je easy udelat tuning naslepo a ztratit konzistenci mezi runy.",
    howToUse: [
      "Nastav hodnotu podle hypotezy a testuj po malych krocich.",
      "Po kazde zmene zkontroluj dopad na quality gates a robustnost.",
      isView
        ? "Ve View modu pouzij parametr pro vizualni kontrolu logiky."
        : "V backtestu parametr men pouze s jasnym duvodem.",
    ],
    recommendedDefault: "Pouzij default z Python kodu, dokud nemas duvod menit.",
    withoutIt: "Muzes nechtene preladit strategii bez pochopeni dopadu.",
    bestPractices: [
      "Dopln metadata v PARAMS_META/VIEW_PARAMS_META pro detailni wiki vysvetleni.",
      "Pri tuning iteracich zapisuj branch, tags a hypothesis.",
    ],
  };
}
