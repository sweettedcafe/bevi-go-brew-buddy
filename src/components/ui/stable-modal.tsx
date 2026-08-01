import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small controlled modal for high-frequency handoff flows.
 *
 * This intentionally does not use Radix FocusScope/DismissableLayer. Those
 * layers can enter an unstable composed-ref update loop when one modal is
 * replaced by another in React 19 (React error #185).
 */
export function StableModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChangeRef.current(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onOpenChange(false);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/80 p-4"
      onMouseDown={closeFromBackdrop}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "relative grid w-full gap-4 rounded-lg border bg-background p-6 text-foreground shadow-lg",
          className,
        )}
      >
        <header className="flex flex-col space-y-1.5 text-center sm:text-left">
          <h2 id={titleId} className="text-lg font-semibold leading-none tracking-tight">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </header>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </section>
    </div>,
    document.body,
  );
}

export function StableModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <footer className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}>
      {children}
    </footer>
  );
}