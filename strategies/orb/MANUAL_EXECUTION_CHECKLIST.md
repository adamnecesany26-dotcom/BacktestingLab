# ORB Prop Firm Killer — zjednodušený ruční checklist (jen 5m OR)

Ideál pro **FX Replay**: jeden sledovaný graf, Minimum matematiky, indikátory co casi každá platforma nabídne.

Referenční logika ve skriptu: [`ORB_PropFirmKiller.pine`](./ORB_PropFirmKiller.pine). Python `orb_prop_firm_killer_ref_v2/` je **jiná specifikace**.

---

## Co testuješ (pevně)

- **OR vždy 5 minut** po startu tvé zvolené **obchodní session** — žádné 15 / 30m varianty neřešíme.
- **Max 1 obchod / den / instrument** jako v nastavení strategie.

---

## „Jeden směr“ — jak to zjednodušit

Plná Pine logika používá denně **bud long, nebo short** podle prvních 5 minut (`firstCandleDir`).

Na ruční zkoušku si **vybereš jednu z variant** a držíš ji celé období testu:

| Režim | Co děláš |
|--------|-----------|
| **A — plná logika** | Po OR: **bullish prvních 5m** → hledám jen **long** přes `orbHigh`; **bearish** → jen **short** přes `orbLow`; **doji** → dnes žádný obchod. |
| **B — zjednodušení** | Obchoduješ **jen long** přes horní okraj OR (shortové dny **přeskakuješ**), nebo **jen short** dolním směrem (longové dny přeskakuješ). Hodí se, když chceš méně rozhodování. |

„Jeden směr“ tu tedy znamená: **buď A (automaticky jeden povolený směr za den podle OR), nebo B (celé test období jen long NEBO jen short).**

---

## Nastavení grafu před replay

- [ ] **Časový rámec pod 5 min** (ideál **1 min**) — z OR poskládáš high/low prvních 5 min přesně.
- [ ] Stejná **session** po celý test (např. Londýn open pro FX, nebo čas odpovídající tomu, co chceš modelovat). Pine default je **09:30–16:00 New York** — na FX si zvol **jeden trh a drž ho**.
- [ ] **Instrumenty „univerzum“:** drž se **úzkého seznamu** (např. hlavní měnové páry nebo jeden index/future), ať máš srovnatelnou likviditu — přesné akciové filtry z článku (cena, miliony akcií) na FX **nejsou 1:1**.

---

## Indikátory na FX Replay (náhrada RelVol + universe + ATR)

Přesné **RelVol** (objem za prvních 5 min / průměr stejného úseku ze 14 minulých dnů) a **universe** jako ve studii **nebudeš počítat ručně každý den** — platforma ho obvykle nemá jako jedno tlačítko. Použiješ **prostředníky**:

### 1) Stop podle daily ATR (hlavní indikátor na SL)

- [ ] Graf **daily (D1)**, doplněný indikátorem **ATR, perioda 14, typ Wilder/SMA podle nabídky** (preferuj shodu s klasickým ATR jak v TV).
- [ ] Vyčti **hodnotu ATR uzavřené včerejší svíčky** (poslední **hotová** daily, ještě ne dnešek).
- [ ] **Vzdálenost SL od plánu vstupu:**  
  `ATR_daily × (tvůj % / 100)`  
  (ve skriptu bývá výchozí **30 %** ATR jako šíroký stop; v článku zmiňovaných **10 %** jako úzký.)
- **Long:** stop = vstup − tato vzdálenost. **Short:** stop = vstup + tato vzdálenost.  
  Pokud ATR nedává smysl, záloha jako ve skriptu: **šířka OR** jako horizontální vzdálenost stopu od vstupu.

### 2) Filtr aktivity („RelVol-lite“ bez tabulek)

- [ ] Otevři si **histogram objemu** (tick / lot volume dle Replay).
- [ ] Po **uzavření prvních 5 min** session zkontroluj, jestli **„horní vršek„ objemu těch 5 barů nevypadá proti nedávné historii** páru ve **stejné dob** slabě (v replay posuň o týden zpět a porovnej barvy/sloupce).  
  **Pravidlo:** obchod **neber**, když je dnešní start **výrazně tišší** než typické poslední ranní zóny — to je **praktická náhrada** „nadprůměrného OR objemu“ bez čísel.

*(Pokud Replay umí **průměr objemu** nebo **EMA na volume** na stejném TF, můžeš si přidat **EMA(14) objemu** na **1m** a po 5 min si říct: součet / průměr posledních pár barů oproti EMA — ale časová shoda s Pine RelVol stále nebude dokonalá.)*

### 3) Universe-lite (likvidita bez skeneru)

- [ ] **Spread** v okamžiku plánovaného vstupu musí být **normální** pro daný pár (širší spread = skip).
- [ ] **Volitelně:** na D1 k **ATR(14)** — příliš **úzké dny** po sobě můžeš vynechat (nízká denní volatilita ≠ nutně špatně, ale často je to „spící“ režim; zrcadlí myšlenku „ne nejhorší trhy“).

---

## Volitelný HTF trend (ručně s EMA)

- [ ] Na **vyšším TF** (např. **1H**) si dej **EMA(50)** (nebo 34 / 200 podle vlastního gusta).
- [ ] Pokud používáš HTF jako **filt**: **long jen když cena nad EMA**, **short jen pod** (stejná myšlenka jako volitelný přepínač ve skriptu).  
**Můžeš to nechat úplně vypnuté** pro první kolo testů.

---

## Checklist jednoho dne (5 min OR)

1. [ ] Začínám **tvoji session** od prvního baru.
2. [ ] Poznač **`firstOpen`** a z prvních **5 × 1m** spočítat **`orbHigh` / `orbLow`** (+ pozorovat objem viz výše).
3. [ ] **Close poslední 1m uvnitř OR** vs. **`firstOpen`:** určuje **long / short bias** (nebo použij variantu **B** jen jedné strany).
4. [ ] Pokud používáš **HTF**, zkontroluj cenu vs. **EMA** ve směru obchodu.
5. [ ] **Filtr aktivity:** není start extrémně „mrtvý“ oproti nedávným stejným časům?
6. [ ] Z **D1 ATR(14)** včerejší → spočítej **SL vzdálenost** (× tvůj %).
7. [ ] **Vstup:** stop příkaz na **`orbHigh` (long)** nebo **`orbLow` (short)** (nebo čekat na **close** za hranou, pokud testuješ confirm režim).
8. [ ] **Řízení:** jeden **stop** + případně **TP / partialy** podle tvého plánu; na konci session **nic nedrž** (EoD flat), pokud tak máš pravidla.

---

## Kdy dnes nic neobchodovat

- **Doji** v bodě 3 (close prvních 5 min = open začátku) — v plné logice **žádný vstup**.
- **Režim B** a dnešní bias **není** tvůj zvolený směr.
- **RelVol-lite / spread / vlastní pravidlo** říká „nesedí“.
- Už jsi dnes **jednou** v obchodu (max 1/den).

---

## Upřímné upozornění

Tento postup **není** číselně identický s Pine **RelVol** ani s **akciovým universe** ze studie — je to **uvěřitelná ruční náhrada** na FX Replay. Až budeš chtít přesné srovnání s backtestem v aplikaci, drž **stejný instrument, session a 5m OR** a parametry ATR %.

---

*Související: [`ORB_PropFirmKiller.pine`](./ORB_PropFirmKiller.pine)*
