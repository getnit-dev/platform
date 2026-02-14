import * as React from "react";
import { Button as HeroButton } from "@heroui/react";
import type { ButtonProps as HeroButtonProps } from "@heroui/react";
import { cn } from "../../lib/utils";

type Variant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type Size = "default" | "sm" | "lg" | "icon";

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  variant?: Variant;
  size?: Size;
}

function mapVariant(variant: Variant = "default"): Pick<HeroButtonProps, "color" | "variant"> {
  switch (variant) {
    case "default":
      return { color: "primary", variant: "solid" };
    case "destructive":
      return { color: "danger", variant: "solid" };
    case "outline":
      return { color: "default", variant: "bordered" };
    case "secondary":
      return { color: "default", variant: "flat" };
    case "ghost":
      return { color: "default", variant: "light" };
    case "link":
      return { color: "primary", variant: "light" };
  }
}

function mapSize(size: Size = "default"): HeroButtonProps["size"] {
  switch (size) {
    case "sm":
      return "sm";
    case "lg":
      return "lg";
    case "default":
    case "icon":
      return "md";
  }
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", children, disabled, onClick, type, ...rest }, ref) => {
    const mapped = mapVariant(variant);

    return (
      <HeroButton
        ref={ref}
        color={mapped.color}
        variant={mapped.variant}
        size={mapSize(size)}
        isIconOnly={size === "icon"}
        isDisabled={disabled}
        type={type}
        onPress={onClick ? () => onClick({} as React.MouseEvent<HTMLButtonElement>) : undefined}
        className={cn(
          variant === "link" && "underline-offset-4 hover:underline",
          className,
        )}
        aria-label={rest["aria-label"]}
      >
        {children}
      </HeroButton>
    );
  }
);
Button.displayName = "Button";

export { Button };
