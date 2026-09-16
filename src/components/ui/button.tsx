import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// WIT UI style (2026-09-16): every button is a pill. `default` is the dark
// ink button (the second emphasis on a screen); `primary` is the ONE accent
// action with its glow — use it once per region.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-accent/40 active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-ink text-on-ink hover:bg-ink-3 aria-expanded:bg-ink-3",
        primary: "bg-accent text-white shadow-glow hover:bg-accent-strong",
        outline:
          "border-border bg-card text-foreground hover:bg-surface aria-expanded:bg-surface",
        secondary:
          "bg-surface text-foreground hover:bg-surface-2 aria-expanded:bg-surface-2",
        ghost:
          "text-foreground hover:bg-black/5 aria-expanded:bg-black/5 dark:hover:bg-white/10 dark:aria-expanded:bg-white/10",
        destructive:
          "bg-danger-soft text-danger hover:bg-accent hover:text-white focus-visible:ring-accent/30",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4",
        xs: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 px-6 text-base",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
