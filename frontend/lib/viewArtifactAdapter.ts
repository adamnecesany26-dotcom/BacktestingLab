import type { ModuleLineOutput, ModuleOutput, ModuleZone } from "@shared/types";
import type { ViewDataResponse } from "@/lib/api";

/** View API odpověď (fáze 5 artefakty) → stejný tvar jako moduleOutputs pro ModuleOutputChart. */
export function viewDataResponseToModuleOutput(v: ViewDataResponse): ModuleOutput {
  return {
    markers: (v.markers ?? [])
      .filter((m) => typeof m.value === "number" && Number.isFinite(m.value))
      .map((m) => ({
        date: m.date,
        type: m.type,
        value: m.value as number,
      })),
    lines: (v.lines ?? []) as ModuleLineOutput[],
    zones: (v.zones ?? []) as ModuleZone[],
  };
}
