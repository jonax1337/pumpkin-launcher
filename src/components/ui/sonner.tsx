import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast flex-wrap! gap-y-3!",
          content: "min-w-0! flex-1! basis-52!",
          error: "[&_[data-icon]]:text-destructive",
          success: "[&_[data-icon]]:text-primary",
          warning: "[&_[data-icon]]:text-gold",
          actionButton: "bg-primary! text-primary-foreground! rounded-md! font-medium!",
          cancelButton: "bg-muted! text-foreground! rounded-md!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
