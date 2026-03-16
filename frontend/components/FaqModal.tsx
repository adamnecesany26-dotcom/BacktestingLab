"use client";

interface FaqItem {
  q: string;
  a: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    q: "Co je tato aplikace?",
    a: "Aplikace slouží k testování obchodních strategií na historických datech. Píšete strategie v Pythonu (Backtrader), spouštíte backtest v bezpečném prostředí a sledujete výsledky – grafy, statistiky a obchody.",
  },
  {
    q: "Jak začít?",
    a: "V levém panelu klikněte na Strategie, pak na Vytvořit strategii. Zadejte název a otevřete novou strategii. Napište nebo upravte kód v editoru, uložte ho, vyberte instrument v pravém panelu a klikněte Run. Výsledky se zobrazí v záložce Results.",
  },
  {
    q: "Co je strategie a jak ji napsat?",
    a: "Strategie je Python soubor s třídou dědící z backtrader.Strategy. Definujete metodu next(), kde rozhodujete o nákupu a prodeji. Parametry nastavíte v PARAMS = {...} – ty se pak zobrazí v panelu Parametry a lze je měnit bez úpravy kódu.",
  },
  {
    q: "Co jsou indikátory?",
    a: "Indikátory jsou znovupoužitelné výpočty (např. EMA, RSI). Vytvoříte je v sekci Indikátory. Ve strategii je importujete: from indicators.{Název} import {Třída}. Pro vizualizaci ve View definujte funkci get_line(ohlc, params=None).",
  },
  {
    q: "Co jsou moduly?",
    a: "Moduly jsou pomocné funkce (detekce swingů, zón, signálů). Vytvoříte je v sekci Moduly. Ve strategii: from modules.{Název} import detect, get_swings. Modul musíte vybrat v panelu Moduly a kliknout Potvrdit, aby se zahrnul do backtestu.",
  },
  {
    q: "Proč musím kliknout Potvrdit u indikátorů a modulů?",
    a: "Checkboxy jen vyberou položky. Tlačítko Potvrdit je zapsání výběru – teprve potom se indikátory a moduly skutečně přidají do strategie při spuštění backtestu. Bez potvrzení by se nepoužily.",
  },
  {
    q: "Co je View a k čemu slouží?",
    a: "View je záložka vedle editoru, kde vidíte svíčkový graf s daty a volitelně markery nebo čáry z vašeho modulu či indikátoru – bez spuštění backtestu. Slouží k rychlé vizualizaci, zda detect/get_line fungují správně.",
  },
  {
    q: "Jak zobrazím markery nebo čáry ve View?",
    a: "V kódu modulu nebo indikátoru definujte funkce detect (bodové značky), get_line (čáry) nebo get_zones (zóny/boxy). Backend je automaticky volá. Formát: detect vrací [{\"date\":\"YYYY-MM-DD\",\"type\":\"high\"|\"low\"|\"signal\",\"value\":float}], get_line vrací {\"EMA20\":[{\"date\",\"value\"},...]}.",
  },
  {
    q: "Co je VIEW_PARAMS a k čemu je?",
    a: "VIEW_PARAMS = {\"period\": 20} v kódu modulu/indikátoru umožňuje měnit parametry přímo ve View bez úpravy kódu. Ikona vedle tlačítka Obnovit otevře panel s inputy. Funkce detect/get_line musí přijímat druhý argument params.",
  },
  {
    q: "Jak spustím backtest?",
    a: "Otevřete strategii, vyberte instrument (Instrument Type a Instrument v pravém panelu), nastavte délku v letech a parametry. Klikněte Run. Backtest se spustí v izolovaném prostředí. Po dokončení se výsledky zobrazí automaticky.",
  },
  {
    q: "Co znamená Instrument Type a Instrument?",
    a: "Instrument Type určuje typ trhu: Futures (NQ, ES), Stocks (akcie) nebo Forex. Instrument je konkrétní symbol – např. NQ pro futures. Každý typ má jiné parametry (Tick Size, Value Per Tick pro futures; Position Size pro akcie; Lot Size pro forex).",
  },
  {
    q: "Kde jsou výsledky po Run?",
    a: "Výsledky mají několik záložek: Equity (křivka kapitálu), Trades (tabulka obchodů), Highlight (detail jednoho obchodu na grafu), Detailed (candlestick s entry/exit), Moduly (výstupy modulů – markery, čáry), Run history (historie všech spuštění).",
  },
  {
    q: "Co je Run history?",
    a: "Každý úspěšný Run se automaticky uloží. V záložce Run history vidíte tabulku všech spuštění s metrikami (P/L, Sharpe, R-multiple) a grafy vývoje metrik napříč runy. Můžete smazat jednotlivé runy nebo vše najednou.",
  },
  {
    q: "Proč se mi nezobrazují výstupy modulů v Results?",
    a: "Modul musí být vybrán v sekci Moduly a potvrzen tlačítkem Potvrdit před Run. Dále modul musí definovat detect, get_line nebo get_zones. Pokud backtest vrací moduleOutputs, zobrazí se v záložce Moduly.",
  },
  {
    q: "Jak zastavím běžící backtest?",
    a: "Během běhu se zobrazí overlay s tlačítkem Zastavit. Kliknutím na něj backtest ukončíte. Částečné výsledky se nezobrazí.",
  },
  {
    q: "Co když backtest padne s chybou?",
    a: "Chyba se zobrazí v logu dole. Časté příčiny: syntaktická chyba v Pythonu, chybějící import (modul/indikátor nebyl potvrzen), neexistující instrument. Zkontrolujte log a opravte kód.",
  },
  {
    q: "Kde se ukládá můj kód?",
    a: "Strategie, indikátory a moduly se ukládají do Firebase Firestore. Každá položka má soubory (main.py, utils.py…). Ukládání probíhá při kliknutí na Uložit v editoru.",
  },
  {
    q: "Jak exportuji výsledky?",
    a: "V záložce Results klikněte na Export. Stáhne se JSON soubor s equity křivkou, metrikami a obchody.",
  },
  {
    q: "Proč se backtest spouští v Dockeru?",
    a: "Strategie je cizí Python kód. Docker zajišťuje izolaci – bez síťového přístupu, omezenou paměť a CPU. Nemůže poškodit váš systém. Timeout je 3 minuty.",
  },
  {
    q: "Jak přidám další soubor ke strategii?",
    a: "S otevřenou strategií klikněte na Přidat soubor v levém panelu. Zadejte název (např. utils.py) a vytvořte. Soubor se objeví v seznamu – můžete ho editovat a importovat v main.py.",
  },
  {
    q: "Jak funguje Trade Highlight?",
    a: "V záložce Highlight vidíte graf jednoho vybraného obchodu – od entry do exit s kontextem před a za. Kliknutím na řádek v tabulce obchodů změníte zobrazený obchod.",
  },
  {
    q: "Mohu použít strategii i ve View?",
    a: "Ano. Ve View můžete vybrat strategii místo modulu nebo indikátoru. Strategie musí mít detect, get_line nebo get_zones, aby se něco zobrazilo.",
  },
  {
    q: "Co jsou zóny (get_zones)?",
    a: "Zóny jsou obdélníky na grafu – např. support/resistance oblasti. Funkce get_zones vrací [{\"date_start\",\"date_end\",\"value_low\",\"value_high\",\"fillcolor\"?, \"name\"?}]. Zobrazí se ve View i v Results u modulů.",
  },
  {
    q: "Jak změním barvu čar v get_line?",
    a: "Vraťte dict s vnořeným objektem: {\"EMA20\": {\"data\": [...], \"color\": \"#3b82f6\"}}. Barva může být i v VIEW_PARAMS, aby ji šlo měnit ve View.",
  },
];

interface FaqModalProps {
  onClose: () => void;
}

export function FaqModal({ onClose }: FaqModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 rounded-xl border border-zinc-700 w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700">
          <h2 className="text-lg font-semibold text-zinc-100">Časté otázky</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label="Zavřít"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4 space-y-6">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="space-y-2">
              <h3 className="text-sm font-medium text-emerald-400/90">{item.q}</h3>
              <p className="text-sm text-zinc-300 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
