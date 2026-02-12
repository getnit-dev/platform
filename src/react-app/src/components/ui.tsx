import type { ReactNode } from "react";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button as ShadcnButton } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { cn } from "../lib/utils";

export function Panel(props: { className?: string; children: ReactNode }) {
  return (
    <Card className={cn("p-5", props.className)}>
      {props.children}
    </Card>
  );
}

export function EmptyState(props: { title: string; body: string; className?: string }) {
  return (
    <Card className={cn("animate-fade-slide", props.className)}>
      <CardContent className="p-10 text-center">
        <p className="text-base font-semibold text-foreground">{props.title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{props.body}</p>
      </CardContent>
    </Card>
  );
}

export function StatCard(props: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <Card className={cn("animate-fade-slide", props.className)}>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{props.label}</p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight">{props.value}</p>
        {props.hint ? <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function Gauge(props: { value: number; label: string; size?: number }) {
  const size = props.size ?? 120;
  const clamped = Math.max(0, Math.min(100, props.value));
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={6}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="mono text-lg font-semibold">{clamped.toFixed(1)}%</span>
        </div>
      </div>
      <span className="text-xs font-medium text-muted-foreground">{props.label}</span>
    </div>
  );
}

export function StatusPill(props: {
  label: string;
  tone?: "neutral" | "good" | "warn" | "danger";
}) {
  const variantMap = {
    neutral: "secondary" as const,
    good: "success" as const,
    warn: "warning" as const,
    danger: "destructive" as const,
  };

  return <Badge variant={variantMap[props.tone ?? "neutral"]}>{props.label}</Badge>;
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  kind?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  const variantMap = {
    primary: "default" as const,
    secondary: "secondary" as const,
    danger: "destructive" as const,
  };

  return (
    <ShadcnButton
      type={props.type}
      disabled={props.disabled}
      onClick={props.onClick}
      variant={variantMap[props.kind ?? "primary"]}
      className={props.className}
    >
      {props.children}
    </ShadcnButton>
  );
}

export function TextInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{props.label}</Label>
      <Input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        type={props.type ?? "text"}
        placeholder={props.placeholder}
      />
    </div>
  );
}
