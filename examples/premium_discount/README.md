# Premium / Mid / Discount indikátor

Indikátor určuje, zda je cena v **Premium**, **Mid range** nebo **Discount** na základě posledního Major Swing Low a Major Swing High.

## Logika

- **Range**: Poslední Major Swing Low a poslední Major Swing High
- **Discount**: 0–40 % range (od spodku) – lehce zelená
- **Mid range**: 40–60 % – lehce šedá
- **Premium**: 60–100 % – lehce červená

## Použití

### Ve View

1. Vytvoř indikátor v sekci Indikátory
2. Zkopíruj kód z `examples/premium_discount.py` do main.py
3. Ve View vyber tento indikátor
4. Zobrazí se 3 horizontální zóny (Discount, Mid, Premium) od místa definice range do konce dat

### Závislost

- Vyžaduje modul **Swing HL** (nebo HL identificator) pro Major Swing H/L
- View načte závislost automaticky díky `# VIEW_DEPENDENCIES: Swing HL`

## Parametry

- `timeframe`: časový rámec pro Major Swing (default: "1d")

---

## Platforma Backtesting App

Indikátor pro **[Backtesting_app](../../README.md)**. Přehled aplikace: **[READMEADAM.md](../../READMEADAM.md)**; technická dokumentace: **[README.md](../../README.md)**; **SCRIPTS.md**, **READMEAI.md** v kořeni repa.
