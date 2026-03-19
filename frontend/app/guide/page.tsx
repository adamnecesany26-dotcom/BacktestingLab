import Link from "next/link";
import { guideSections } from "@/data/guideContent";

export default function GuidePage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:py-10">
        <div className="mb-6 flex items-center justify-between gap-3 border-b border-zinc-800 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Beginner průvodce</p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-100 lg:text-3xl">
              Backtesting App: průvodce od A do Z
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-300">
              Tato stránka je určená pro uživatele, který zná obchodování, má základ Pythonu a chce aplikaci používat
              sebejistě bez tápání.
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Zpět do aplikace
          </Link>
        </div>

        <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-sm font-semibold text-zinc-100">Jak tento průvodce číst</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
            <li>Projdi sekce postupně, každá navazuje na předchozí.</li>
            <li>U každého tématu sleduj: co to je, proč je to důležité a jak to použít v praxi.</li>
            <li>Na konci použij checklist věrohodného backtestu jako kontrolu kvality před dalším runem.</li>
            <li>
              V aplikaci u každého pole v pravém panelu klikni na ikonu nápovědy — texty jsou v repu v{" "}
              <code className="text-zinc-400">frontend/components/backtestFieldMeta.ts</code> a odpovídají aktuálnímu UI.
            </li>
            <li>
              <strong>READMEADAM.md</strong> v kořeni projektu je kompletní mapa funkcí a obrazovky pro rychlý re-orient po změnách
              v aplikaci.
            </li>
          </ul>
        </div>

        <div className="grid gap-6 lg:grid-cols-[290px_1fr]">
          <aside className="h-fit rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">Obsah</h2>
            <nav className="space-y-1">
              {guideSections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="block rounded-md px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  {section.title}
                </a>
              ))}
            </nav>
              <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Cíl po dočtení</p>
              <ul className="mt-2 space-y-1 text-xs text-zinc-200">
                <li>Budeš umět aplikaci používat zhruba na 90 % bez řešení edge-case supportu.</li>
                <li>Budeš umět rozlišit věrohodný a nevěrohodný backtest.</li>
                <li>Budeš rozumět OOS, Walk-forward a Monte Carlo v praktickém workflow.</li>
                <li>Budeš vědět, kde je batch/sweep, fixní seed, repro ZIP a co znamená readiness v Analytics.</li>
              </ul>
            </div>
          </aside>

          <section className="space-y-6">
            {guideSections.map((section) => (
              <article key={section.id} id={section.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h2 className="text-xl font-semibold text-zinc-100">{section.title}</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-300">{section.intro}</p>

                <div className="mt-4 space-y-4">
                  {section.topics.map((topic) => (
                    <div key={topic.id} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
                      <h3 className="text-base font-semibold text-emerald-300">{topic.title}</h3>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-zinc-500">Co to je</p>
                          <p className="mt-1 text-sm leading-6 text-zinc-200">{topic.whatItIs}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-zinc-500">Proč je to důležité</p>
                          <p className="mt-1 text-sm leading-6 text-zinc-200">{topic.whyItMatters}</p>
                        </div>
                      </div>

                      <div className="mt-3">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Jak to použít krok za krokem</p>
                        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-zinc-200">
                          {topic.howToUse.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </div>

                      {topic.recommendedDefaults && topic.recommendedDefaults.length > 0 && (
                        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
                          <p className="text-xs uppercase tracking-wide text-emerald-300">Doporučené defaulty</p>
                          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-zinc-100">
                            {topic.recommendedDefaults.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {topic.commonMistakes && topic.commonMistakes.length > 0 && (
                        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                          <p className="text-xs uppercase tracking-wide text-amber-300">Typické chyby začátečníků</p>
                          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-zinc-100">
                            {topic.commonMistakes.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}

            <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <h2 className="text-xl font-semibold text-zinc-100">Checklist věrohodného backtestu</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-zinc-200">
                <li>Validace není pouze single run (ideálně OOS nebo Walk-forward).</li>
                <li>Quality gates filtrují slabé nebo náhodné edge.</li>
                <li>Monte Carlo je zapnuté, risk-of-ruin je v přijatelné oblasti a víš, jestli běží IID nebo block bootstrap.</li>
                <li>Execution model započítává spread, slippage i latenci; v Analytics zkontroluj cost attribution.</li>
                <li>
                  Run má v manifestu lineage včetně seedu — při potřebě přesné opakovatelnosti zapni fixní seed v Edge finding.
                </li>
                <li>Po sweepu nebo batch dávce nepřebírej jen nejlepší výsledek; uvědom si multiple testing.</li>
                <li>V Analytics projdi oranžové overfitting varování a readiness / severity (heuristika).</li>
                <li>Rozhodnutí o promote je podložené compare workspace + reviewer approval.</li>
                <li>Výsledek drží stabilitu napříč více runy ve stejné branchi.</li>
              </ul>
            </article>
          </section>
        </div>
      </div>
    </main>
  );
}
