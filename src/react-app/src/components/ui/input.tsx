import * as React from "react";
import { Input as HeroInput } from "@heroui/react";
import { cn } from "../../lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, value, onChange, placeholder, disabled, name, id, ...rest }, ref) => {
    return (
      <HeroInput
        ref={ref}
        type={type}
        value={value as string | undefined}
        onChange={onChange}
        placeholder={placeholder}
        isDisabled={disabled}
        name={name}
        id={id}
        variant="bordered"
        size="sm"
        classNames={{
          inputWrapper: cn("min-h-9", className),
        }}
        aria-label={rest["aria-label"]}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
