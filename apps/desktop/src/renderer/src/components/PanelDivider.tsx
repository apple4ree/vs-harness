import { useRef } from "react";

export function PanelDivider({
  label,
  orientation,
  value,
  minimum,
  maximum,
  reverse = false,
  defaultValue,
  onChange,
  onCommit,
}: {
  label: string;
  orientation: "vertical" | "horizontal";
  value: number;
  minimum: number;
  maximum: number;
  reverse?: boolean;
  defaultValue: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const drag = useRef<{
    id: number;
    coordinate: number;
    value: number;
    latest: number;
  } | null>(null);
  const clamp = (next: number) =>
    Math.round(Math.max(minimum, Math.min(maximum, next)));
  const finish = () => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    onCommit(current.latest);
  };
  return (
    <div
      className={`panel-divider ${orientation}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={value}
      title={`${label} · Drag or use arrow keys · Double-click to reset`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          id: event.pointerId,
          coordinate:
            orientation === "vertical" ? event.clientX : event.clientY,
          value,
          latest: value,
        };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const coordinate =
          orientation === "vertical" ? event.clientX : event.clientY;
        current.latest = clamp(
          current.value +
            (coordinate - current.coordinate) * (reverse ? -1 : 1),
        );
        onChange(current.latest);
      }}
      onPointerUp={(event) => {
        finish();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={finish}
      onDoubleClick={() => {
        const next = clamp(defaultValue);
        onChange(next);
        onCommit(next);
      }}
      onKeyDown={(event) => {
        const negative = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        const positive =
          orientation === "vertical" ? "ArrowRight" : "ArrowDown";
        let next: number;
        if (event.key === negative || event.key === positive)
          next =
            value +
            (event.key === negative ? -1 : 1) *
              (reverse ? -1 : 1) *
              (event.shiftKey ? 50 : 10);
        else if (event.key === "Home") next = minimum;
        else if (event.key === "End") next = maximum;
        else return;
        event.preventDefault();
        next = clamp(next);
        onChange(next);
        onCommit(next);
      }}
    />
  );
}
