"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ActionMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  testId?: string;
}

interface ActionMenuProps {
  label: string;
  icon?: ReactNode;
  items: ActionMenuItem[];
  testId?: string;
  align?: "start" | "end";
}

export function ActionMenu({
  label,
  icon,
  items,
  testId,
  align = "end",
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        data-testid={testId}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
        {label}
        <ChevronDown className={cn("h-4 w-4 transition", open ? "rotate-180" : "rotate-0")} />
      </Button>
      {open ? (
        <div
          className={cn(
            "absolute top-full z-40 mt-2 min-w-[13.5rem] overflow-hidden rounded-2xl border border-white/10 bg-[#121929]/96 p-1.5 shadow-[0_20px_45px_rgba(3,7,18,0.45)] backdrop-blur-xl",
            align === "end" ? "right-0" : "left-0",
          )}
          role="menu"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-testid={item.testId}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground transition hover:bg-white/8"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              <span className="text-muted-foreground">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
