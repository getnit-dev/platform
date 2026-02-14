import * as React from "react";
import { Chip } from "@heroui/react";
import type { ChipProps } from "@heroui/react";
import { cn } from "../../lib/utils";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

function mapVariant(variant: BadgeVariant = "default"): { color: ChipProps["color"]; variant: ChipProps["variant"] } {
  switch (variant) {
    case "default":
      return { color: "primary", variant: "flat" };
    case "secondary":
      return { color: "default", variant: "flat" };
    case "destructive":
      return { color: "danger", variant: "flat" };
    case "outline":
      return { color: "default", variant: "bordered" };
    case "success":
      return { color: "success", variant: "flat" };
    case "warning":
      return { color: "warning", variant: "flat" };
  }
}

function Badge({ className, variant = "default", children }: BadgeProps) {
  const mapped = mapVariant(variant);

  return (
    <Chip
      color={mapped.color}
      variant={mapped.variant}
      size="sm"
      className={cn(className)}
    >
      {children}
    </Chip>
  );
}

export { Badge };
