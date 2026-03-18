# Dummy Test Strategie

Testovací strategie pro ověření PnL a zobrazení obchodů.

**Logika:**
- Bar 1: nákup 1 kontraktu na market
- Stop loss: 500 bodů pod entry
- Profit target: 500 bodů nad entry

**Pro NQ (mult=20):** 500 bodů = 10 000 USD
- TP hitnut → +10 000 USD (minus commission ~5 USD)
- SL hitnut → -10 000 USD (minus commission ~5 USD)

**Použití:**
1. Vytvoř strategii v aplikaci a zkopíruj obsah `main.py`
2. Vyber instrument NQ
3. Spusť backtest
4. Ověř: 1 obchod, PnL ≈ ±10 000 USD
