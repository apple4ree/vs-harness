export type PanelLayout = { left: number; right: number; terminal: number };
export const DEFAULT_LAYOUT: PanelLayout = {
  left: 220,
  right: 350,
  terminal: 200,
};
export const PANEL_LIMITS = {
  left: [160, 420],
  right: [240, 650],
  terminal: [120, 600],
} as const;
export function validateLayout(value: unknown): PanelLayout {
  if (value === undefined) return { ...DEFAULT_LAYOUT };
  if (!value || typeof value !== "object")
    throw new Error("Invalid panel layout");
  const input = value as PanelLayout;
  const result = { ...DEFAULT_LAYOUT };
  for (const key of ["left", "right", "terminal"] as const) {
    const [minimum, maximum] = PANEL_LIMITS[key];
    if (
      !Number.isInteger(input[key]) ||
      input[key] < minimum ||
      input[key] > maximum
    )
      throw new Error(`Invalid ${key} panel size`);
    result[key] = input[key];
  }
  return result;
}
export function fitLayout(
  layout: PanelLayout,
  width: number,
  height: number,
): PanelLayout {
  const available = Math.max(400, width - 328);
  const excess = Math.max(0, layout.left + layout.right - available);
  const leftRoom = layout.left - PANEL_LIMITS.left[0];
  const rightRoom = layout.right - PANEL_LIMITS.right[0];
  const room = leftRoom + rightRoom;
  const left = Math.round(
    layout.left - (room ? (excess * leftRoom) / room : 0),
  );
  const right = Math.min(layout.right, Math.floor(available - left));
  return {
    left,
    right,
    terminal: Math.min(
      layout.terminal,
      Math.max(120, Math.floor(height - 250)),
    ),
  };
}
