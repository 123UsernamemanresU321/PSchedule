"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  GraduationCap,
  LayoutGrid,
  Settings,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { navigationItems } from "@/lib/constants/planner";
import { cn } from "@/lib/utils";

const iconMap = {
  Dashboard: LayoutGrid,
  Calendar: CalendarDays,
  Subjects: BookOpen,
  "Weekly Review": BarChart3,
  Settings,
} as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] border-r border-white/8 bg-[linear-gradient(180deg,rgba(19,19,21,0.98),rgba(8,9,13,0.97))] px-4 py-6 shadow-[18px_0_60px_rgba(0,0,0,0.24)] backdrop-blur lg:flex lg:flex-col">
      <div className="flex items-center gap-3 px-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/35 bg-[linear-gradient(145deg,hsl(var(--primary)),hsl(var(--subject-maths)))] text-primary-foreground shadow-[0_18px_44px_hsl(var(--primary)/0.22)]">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div>
          <p className="font-display text-lg font-semibold leading-tight tracking-[-0.045em]">Adaptive Study Planner</p>
          <p className="text-sm text-muted-foreground">IB + Olympiad OS</p>
        </div>
      </div>

      <nav className="mt-10 flex flex-1 flex-col gap-2">
        {navigationItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = iconMap[item.label];

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "premium-control-ring flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition",
                isActive
                  ? "border-primary/28 bg-primary/14 text-blue-50 shadow-[0_12px_32px_hsl(var(--primary)/0.12)]"
                  : "border-transparent text-muted-foreground hover:border-white/10 hover:bg-white/[0.045] hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="premium-subpanel rounded-xl px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-foreground">DP1 Plan</p>
            <p className="text-sm text-muted-foreground">Current cycle</p>
          </div>
          <Badge variant="subject">Local-first</Badge>
        </div>
      </div>
    </aside>
  );
}
