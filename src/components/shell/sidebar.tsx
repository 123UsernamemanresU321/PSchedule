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
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] border-r border-white/8 bg-[linear-gradient(180deg,rgba(8,11,23,0.98),rgba(12,18,34,0.94))] px-4 py-6 backdrop-blur lg:flex lg:flex-col">
      <div className="flex items-center gap-3 px-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground shadow-panel shadow-primary/25">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div>
          <p className="font-display text-xl font-semibold">Adaptive Study Planner</p>
          <p className="text-sm text-muted-foreground">IB + Olympiad</p>
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
                "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-muted-foreground transition",
                isActive
                  ? "bg-primary text-primary-foreground shadow-panel shadow-primary/20"
                  : "hover:bg-white/4 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="rounded-xl border border-white/8 bg-white/[0.04] px-4 py-4">
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
