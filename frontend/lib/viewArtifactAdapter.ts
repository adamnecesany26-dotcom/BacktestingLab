import type { ModuleLineOutput, ModuleOutput, ModuleZone } from "@shared/types";
import type { ViewDataResponse } from "@/lib/api";

/** View API odpověď (fáze 5 artefakty) → stejný tvar jako moduleOutputs pro ModuleOutputChart. */
export function viewDataResponseToModuleOutput(v: ViewDataResponse): ModuleOutput {
  return {
    markers: (v.markers ?? []).map((m) => ({
      date: m.date,
      type: m.type,
      value: m.value,
    })),
    lines: (v.lines ?? []) as ModuleLineOutput[],
    zones: (v.zones ?? []) as ModuleZone[],
  };
}
