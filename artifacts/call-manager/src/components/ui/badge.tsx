import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors border",
        {
          "bg-primary/20 text-primary border-primary/30": variant === "default",
          "bg-white/10 text-white border-white/20": variant === "secondary",
          "bg-red-500/20 text-red-400 border-red-500/30": variant === "destructive",
          "text-white/70 border-white/20": variant === "outline",
          "bg-emerald-500/20 text-emerald-400 border-emerald-500/30": variant === "success",
          "bg-amber-500/20 text-amber-400 border-amber-500/30": variant === "warning",
        },
        className
      )}
      {...props}
    />
  )
}

export { Badge }
