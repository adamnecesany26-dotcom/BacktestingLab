# Deployment checklist — Backtesting platform

Krátký seznam před nasazením API + frontendu mimo čistě lokální single-user vývoj. Podrobnosti: `README.md`, `backend/app/security.py`.

## 1. Autentizace a API klíč

- [ ] Na backendu je nastaven **`API_AUTH_KEY`** (silný náhodný řetězec).
- [ ] **`API_AUTH_REQUIRED=1`** (výchozí) — nepoužívej vývojový bypass v produkci.
- [ ] **`API_ALLOW_DEV_BYPASS=0`** v produkci — žádné obcházení auth bez klíče.
- [ ] Frontend má **`NEXT_PUBLIC_API_AUTH_KEY`** (nebo ekvivalent) jen pokud klíč smí být v bundlu — preferuj BFF/proxy, který klíč nedává do klienta, pokud je to možné.
- [ ] Požadavky posílají **`X-API-Key`** nebo **`Authorization: Bearer …`** odpovídající `API_AUTH_KEY`.
- [ ] **`X-Actor-Id`** používej konzistentně pro audit (`manifest` / `.audit/events.jsonl`); není to náhrada za ověřenou identitu.

## 2. Síť a CORS

- [ ] **`CORS_EXTRA_ORIGINS`** nebo **`CORS_ALLOW_ORIGIN_REGEX`** obsahuje jen skutečné produkční origins (ne `*` s credentials).
- [ ] Produkcí **nezůstává** široké `allow_methods=["*"]` bez potřeby — zúžit na používané metody, pokud jde.
- [ ] API není z internetu dostupné bez TLS (reverse proxy s HTTPS).

## 3. Engine a izolace

- [ ] Udělej si jasno: **trusted single-user** na vlastním serveru vs snaha o více uživatelů.
- [ ] Pro více uživatelů / nedůvěřený kód: **nepoužívej** výchozí in-process engine bez izolace — zvaž **`RUN_INPROCESS_ENGINE=0`** (subprocess), kontejner per run, limity CPU/RAM, oddělený filesystem pro data.
- [ ] Nastav rozumný **`RUN_TIMEOUT_SEC`** / UI max doba běhu proti DoS dlouhými runy.
- [ ] **`RATE_LIMIT`**: uvědom si, že limiter v paměti **nesdílí** instance za load balancerem — při scale-out přidej sdílený store (Redis) nebo limity na LB.

## 4. Data a secrets

- [ ] Firebase / Firestore **security rules** odpovídají vlastnickému modelu (owner, role v appce).
- [ ] Žádné service account JSON v repu; secrets jen v env / secret manageru.
- [ ] Pro audit trail výsledků zvaž **SHA-256** datasetu u kritických runů (README zmiňuje rychlý mtime+size fingerprint pro výkon — pro compliance může být nedostatečné).

## 5. Observabilita a údržba

- [ ] Health check: **`GET /health`** v monitoringu.
- [ ] Logy backendu (a čitelnost **`.audit/events.jsonl`**) podle vašeho provozního modelu.
- [ ] Záloha Firestore / export strategií podle potřeby.

## 6. Po nasazení (smoke)

- [ ] Jeden krátký backtest přes **`POST /api/run?stream=1`** s autentizací.
- [ ] Ověření View **`POST /api/view`** (nebo aspoň `/api/data`).

---

**Reference:** [`2026-03-31-final-readiness-audit.md`](2026-03-31-final-readiness-audit.md) (readiness skóre a rizika).
