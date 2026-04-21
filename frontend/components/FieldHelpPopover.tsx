"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BacktestFieldHelp } from "@/components/backtestFieldMeta";

interface FieldHelpPopoverProps {
  help: BacktestFieldHelp | undefined;
}

export function FieldHelpPopover({ help }: FieldHelpPopoverProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!open) return;
      const target = event.target as Node | null;
      const clickedTrigger = !!(rootRef.current && target && rootRef.current.contains(target));
      const clickedPanel = !!(panelRef.current && target && panelRef.current.contains(target));
      if (!clickedTrigger && !clickedPanel) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!help?.title) {
    return null;
  }

  return (
    <div ref={rootRef} className="inline-flex items-center">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Napoveda: ${help.title}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="h-5 w-5 rounded-full border border-zinc-600 text-[11px] font-bold text-zinc-200 hover:bg-zinc-700"
      >
        ?
      </button>
      {open &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-start justify-center p-4 sm:items-center">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-modal="false"
              className="relative z-[10000] w-[28rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h5 className="text-sm font-semibold text-emerald-300">{help.title}</h5>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  Zavrit
                </button>
              </div>
              <div className="space-y-3 text-xs text-zinc-200">
                <section>
                  <p className="uppercase tracking-wide text-zinc-500">Co znamena</p>
                  <p className="mt-1 leading-5">{help.whatItMeans}</p>
                </section>
                <section>
                  <p className="uppercase tracking-wide text-zinc-500">Proc je to dulezite</p>
                  <p className="mt-1 leading-5">{help.whyItMatters}</p>
                </section>
                <section>
                  <p className="uppercase tracking-wide text-zinc-500">Jak to pouzit</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 leading-5">
                    {help.howToUse.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </section>
                <section className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2">
                  <p className="uppercase tracking-wide text-emerald-300">Doporuceny default</p>
                  <p className="mt-1 leading-5 text-zinc-100">{help.recommendedDefault}</p>
                </section>
                <section className="rounded border border-amber-500/30 bg-amber-500/10 p-2">
                  <p className="uppercase tracking-wide text-amber-300">Co se deje bez toho</p>
                  <p className="mt-1 leading-5 text-zinc-100">{help.withoutIt}</p>
                </section>
                <section>
                  <p className="uppercase tracking-wide text-zinc-500">Best practices</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 leading-5">
                    {help.bestPractices.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
