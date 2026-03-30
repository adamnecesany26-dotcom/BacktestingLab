# Kontrakt modulu S/D (`get_zones`) pro `sd_zone_strategy`

Strategie očekává, že modul vybraný v UI (např. kopie [`examples/sd_zones.py`](../../examples/sd_zones.py)) exportuje **`get_zones(ohlc: pd.DataFrame, params: dict) -> list[dict]`**.

## DataFrame `ohlc`

- Datetime index (strategie resampluje exekuční OHLC na `zone_timeframes` a předává **už resamplovaný** DF).
- Sloupce: `open`, `high`, `low`, `close` (nebo `Open`/`High`/…).

## Parametry ze strategie

Strategie volá modul přes `_sd_module_params_for_tf(zone_tf)`:

- `timeframe` a `data_timeframe` = řetězec TF zóny (např. `4h`, `1d`).
- `zone_extend_right_bars` je **přepsáno** z `PARAMS.zone_max_bars` strategie.
- **`max_base_length`** a **`require_inducement`** berou z **panelu strategie** (`PARAMS`), ne z `VIEW_PARAMS` modulu.
- Další klíče z `VIEW_PARAMS` modulu v UI (ATR, overlap, trend okno a prahy, …).

**Důsledek:** swingy, interní HL, major a BOS uvnitř modulu musí pracovat s **tímto** `ohlc` a `timeframe` — tj. na stejném TF jako detekce zóny pro daný řetězec v `zone_timeframes`.

## Povinná pole u zón `Demand` / `Supply`

Pro zařazení zóny do stavového stroje strategie (aktuální bar uvnitř platnosti):

| Pole | Typ | Význam |
|------|-----|--------|
| `start_idx` | int | Levý okraj zóny v indexech předaného `ohlc`. |
| `end_idx` | int | Pravý okraj (extend). |
| `pivot_idx` | int | Pivot zóny (preferováno pro stáří / trend okno). |
| `value_low`, `value_high` | float | Cenové hranice. |
| `name` | str | `Demand` nebo `Supply`. |

Bez `start_idx` / `end_idx` se zóna **nezahrne** do merge/track logiky v `next()`.

## Reference implementace

[`examples/sd_zones.py`](../../examples/sd_zones.py) — funkce `get_zones` nastavuje `start_idx`, `end_idx`, `pivot_idx`, inducement, touch, gap, atd.

## Trend filtr (`get_trend`)

Strategie importuje `get_trend` z **HL_identificator** nebo **Swing_HL** (ne ze S/D modulu). Zapnutí filtru řídí **`trend_filter_enabled`** ve strategii; **šířka okna, režim agregace a prahy** (`trend_window_bars`, `trend_window_mode`, …) se v backtestu berou ze **sloučených parametrů modulu S/D** (`VIEW_PARAMS`), stejně jako při `get_zones`. Skóre se počítá na TF z `_effective_trend_tf` (primární TF zóny vs. **`trend_chart_timeframe`** z `Strategy.params`, výchozí v kódu). Parametry EMA/smooth pro `get_trend` berou z `module_params` swing modulu.
