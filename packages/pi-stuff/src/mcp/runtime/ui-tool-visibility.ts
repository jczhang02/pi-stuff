import { isJsonInputObject, type JsonInputObject } from "../../shared/json-value.js";
export type UiToolVisibility = "model" | "app";

export function extractUiToolVisibility(meta: JsonInputObject | undefined): UiToolVisibility[] | undefined {
	  if (!meta) return undefined;
	  const ui = meta.ui;
	  if (!isJsonInputObject(ui)) return undefined;
	  const visibility = ui.visibility;
  if (visibility === undefined) return undefined;
  if (!Array.isArray(visibility)) return [];

  const values: UiToolVisibility[] = [];
  for (const entry of visibility) {
    if (entry !== "model" && entry !== "app") return [];
    if (!values.includes(entry)) values.push(entry);
  }
  return values;
}

export function isUiToolVisibleToModel(visibility: readonly UiToolVisibility[] | undefined): boolean {
  return visibility === undefined || visibility.includes("model");
}

export function isUiToolCallableByApp(visibility: readonly UiToolVisibility[] | undefined): boolean {
  return visibility === undefined || visibility.includes("app");
}
