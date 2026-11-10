"use client";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatManwon, formatManwonInput, parseManwon } from "@/lib/money";
export function MoneyInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(formatManwon(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(formatManwon(value));
  }, [value]);
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-sm font-medium">
        {label} {label && "(만원)"}
      </span>
      <Input
        ref={ref}
        id={id}
        inputMode="decimal"
        value={draft}
        onChange={(event) => {
          const before = event.target.value.slice(
            0,
            event.target.selectionStart ?? event.target.value.length,
          );
          const digitsBefore = before.replace(/[^0-9]/g, "").length;
          const formatted = formatManwonInput(event.target.value);
          setDraft(formatted);
          onChange(parseManwon(formatted));
          requestAnimationFrame(() => {
            const input = ref.current;
            if (!input) return;
            let position = 0;
            let seen = 0;
            while (position < input.value.length && seen < digitsBefore) {
              if (/[0-9]/.test(input.value[position])) seen++;
              position++;
            }
            input.setSelectionRange(position, position);
          });
        }}
        onBlur={() => setDraft(formatManwon(value))}
      />
    </label>
  );
}
