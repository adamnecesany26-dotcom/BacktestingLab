# Supply/Demand zóny – definice pro S/D strategii

## Kontext (institucionální trading)

Supply a Demand zóny jsou cenové oblasti, kde došlo k výrazné nerovnováze objednávek a silnému impulznímu pohybu. Zóny reprezentují „bázi“ před tímto pohybem – místo, kde institucionální objednávky nebyly plně vyplněny a mohou při návratu ceny reagovat podobně.

## Definice pro S/D v-1.0 (BOS-based)

### Demand zóna

- **Vznik**: V místě, kde došlo k **bullish BOS** (Break of Structure – close nad posledním swing high).
- **Pivot svíčka**: Bar s **nejnižším low** v momentum leg (od posledního swing low k BOS) – začátek pohybu.
- **Výška zóny**: Od **High** do **Low** pivot svíčky.
- **Šířka zóny**: Viz sekce „Šířka zóny“ níže.

### Supply zóna

- **Vznik**: V místě, kde došlo k **bearish BOS** (close pod posledním swing low).
- **Pivot svíčka**: Bar s **nejvyšším high** v momentum leg (od posledního swing high k BOS) – začátek pohybu.
- **Výška zóny**: Od **High** do **Low** pivot svíčky.
- **Šířka zóny**: Viz sekce „Šířka zóny“ níže.

### Šířka zóny vlevo (rozšíření do historie)

Zóna se může protáhnout do levé části (do historie) podle toho, jak moc předchozí svíčky zasahují do oblasti zóny.

**Pravidlo**: Pokud alespoň **33 %** celkové délky svíčky (H–L range) je v oblasti zóny, svíčka se počítá do šířky.

### Šířka zóny vpravo (rozšíření do budoucna)

Zóna se roztáhne doprava do budoucna až do chvíle, kdy:
- **zanikne**: Demand = close < zone_low, Supply = close > zone_high;
- **dotyk**: cena musí nejdřív vytvořit svíčku, jejíž H/L se zóny nedotýká (Demand: bar_low > zone_high; Supply: bar_high < zone_low), až poté se počítá dotyk;
- uplyne **60 barů** od pivotu – zóna zmizí.

### Jedna zóna na místo

V podobném místě (cenový overlap ≥25 %) a blízkém časovém rámci (≤7 barů) nesmí vzniknout 2 zóny stejného typu. Zóna vzniká tam, kde daný pohyb od zóny vytvořil BOS.

**Příklad**:
- Zóna označena na svíčce 14 (pivot).
- Svíčka 13: 50 % jejího H–L rozsahu je v zóně → zóna se protáhne na svíčku 13.
- Svíčka 12: jen 11 % v zóně → zóna končí na svíčce 13.
- Celková šířka: 2 bary (svíčky 13 a 14).

**Výška** je vždy podle pivot svíčky (value_low = low, value_high = high).

### Formát zóny (get_zones)

```python
{
    "date_start": "YYYY-MM-DD",  # datum nejlevější svíčky v šířce
    "date_end": "YYYY-MM-DD",    # datum pivot svíčky
    "value_low": float,          # low pivot svíčky
    "value_high": float,          # high pivot svíčky
    "fillcolor": "rgba(34, 197, 94, 0.25)",   # Demand: zelená
    "fillcolor": "rgba(239, 68, 68, 0.25)",   # Supply: červená
    "name": "Demand" | "Supply"
}
```

### Vizualizace

- **Demand**: lehce zabarvený zelený rectangle.
- **Supply**: lehce zabarvený červený rectangle.
