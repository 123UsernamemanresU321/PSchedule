import Link from "next/link";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";

export function AiAuthNotice({
  message = "AI access is private. Sign in from Settings to use the DeepSeek assistant.",
}: {
  message?: string;
}) {
  return (
    <div className="rounded-sm border border-white/8 bg-white/4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Lock className="h-4 w-4" />
            AI locked
          </div>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        <Link
          href="/settings"
          className={cn(
            "inline-flex h-9 items-center justify-center rounded-lg border border-border bg-white/[0.02] px-3 text-sm font-medium text-foreground transition duration-150 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          )}
        >
          Open Settings
        </Link>
      </div>
    </div>
  );
}
