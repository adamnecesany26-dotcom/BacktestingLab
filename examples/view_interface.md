# View – co napsat do kódu (modul / indikátor / strategie)

View zobrazuje svíčkový graf s mock daty a volitelně **markery** (body) nebo **čáry** (indikátory) z tvého kódu. Všechny tři typy (modul, indikátor, strategie) používají stejné rozhraní.

---

## 1. Markery (bodové značky)

Pro H/L, swing points, signály vstupu/výstupu – zelené/červené kolečko na grafu.

```python
def detect(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict]:
    """
    ohlc: DataFrame s indexem datetime, sloupci open, high, low, close, volume
    Vrátí: [{"date": "YYYY-MM-DD", "type": "high"|"low"|"signal", "value": float}, ...]
    """
    results = []
    for i in range(len(ohlc)):
        # tvůj algoritmus
        if je_swing_high:
            date_str = ohlc.index[i].strftime("%Y-%m-%d")
            results.append({"date": date_str, "type": "high", "value": float(ohlc["high"].iloc[i])})
        if je_swing_low:
            date_str = ohlc.index[i].strftime("%Y-%m-%d")
            results.append({"date": date_str, "type": "low", "value": float(ohlc["low"].iloc[i])})
    return results
```

- **type**: `"high"` = zelené, `"low"` = červené, `"signal"` = modré (lze rozšířit)
- **value**: cena (y-ová souřadnice bodu)

---

## 2. Čáry (indikátory)

Pro EMA, RSI, vlastní indikátory – čára přes graf.

```python
def get_line(ohlc: pd.DataFrame, params: dict | None = None) -> list[dict] | dict:
    """
    Jedna čára: return [{"date": "YYYY-MM-DD", "value": float}, ...]
    Více čar: return {"EMA20": [...], "EMA50": [...]}
    """
    import pandas as pd
    # Příklad: EMA 20
    ema = ohlc["close"].ewm(span=20, adjust=False).mean()
    data = [
        {"date": ohlc.index[i].strftime("%Y-%m-%d"), "value": float(ema.iloc[i])}
        for i in range(len(ohlc))
    ]
    return data  # jedna čára

    # Nebo více čar:
    # return {"EMA20": data20, "EMA50": data50}
```

---

## 2b. View params panel (dynamické parametry)

Při vývoji indikátoru/modulu můžeš v View módu měnit parametry bez úpravy kódu. Deklaruj `VIEW_PARAMS` a přijímej `params` ve funkcích:

```python
VIEW_PARAMS = {"period": 20}  # výchozí hodnoty – zobrazí se ve View params panelu

def get_line(ohlc: pd.DataFrame, params: dict | None = None) -> dict:
    params = params or {}
    period = int(params.get("period", 20))
    ema = ohlc["close"].ewm(span=period, adjust=False).mean()
    # ...
    return {f"EMA{period}": data}
```

- `VIEW_PARAMS` – stejný formát jako `PARAMS` (number, boolean, string)
- `params` – druhý argument u `detect(ohlc, params)` a `get_line(ohlc, params)` (volitelný)
- Po změně hodnoty a kliknutí na „Použít“ se graf znovu načte s novými parametry

---

## 3. Kombinace

Můžeš mít obě funkce v jednom souboru:

```python
def detect(ohlc, params=None):
    # markery
    return [{"date": "...", "type": "high", "value": 20000}, ...]

def get_line(ohlc, params=None):
    # čáry
    return {"EMA": [{"date": "...", "value": 19950}, ...]}
```

---

## 4. Příklady podle typu

### Modul (H/L, swing)
- Použij `detect(ohlc)` – vrací swing high/low body.
- Viz `examples/hl_module_template.py`.

### Indikátor (EMA, RSI)
- Použij `get_line(ohlc)` – vrací hodnoty indikátoru po barech.
- Pro Backtrader indikátor: spočítej hodnoty v Pythonu (pandas) a vrať je.

### Strategie
- Přidej do `main.py` funkce `detect(ohlc)` nebo `get_line(ohlc)`.
- Můžeš v nich použít logiku ze strategie (např. kde by strategie vstupovala).
- Třída `Strategy` zůstane pro backtest, View použije jen tyto funkce.
