import { heroui } from "@heroui/react";

export default heroui({
  layout: {
    radius: {
      small: "6px",
      medium: "10px",
      large: "14px",
    },
    boxShadow: {
      small: "0 1px 2px 0 rgb(0 0 0 / 0.03), 0 1px 3px 0 rgb(0 0 0 / 0.06)",
      medium: "0 2px 4px -1px rgb(0 0 0 / 0.04), 0 4px 12px -1px rgb(0 0 0 / 0.06)",
      large: "0 4px 6px -2px rgb(0 0 0 / 0.03), 0 12px 24px -4px rgb(0 0 0 / 0.08)",
    },
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;
