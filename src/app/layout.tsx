import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/app/globals.css";
import { PlannerBootstrap } from "@/components/planner/planner-bootstrap";

export const metadata: Metadata = {
  title: "Adaptive IB + Olympiad Study Planner",
  description:
    "Local-first deterministic planner for IB HL subjects, Olympiad prep, and recovery-safe weekly scheduling.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <PlannerBootstrap>{children}</PlannerBootstrap>
      </body>
    </html>
  );
}
