import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/* Minimal shadcn/ui-style primitives (same API shape: cva variants + className merge). */

const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:opacity-90",
        outline: "border border-line bg-surface text-ink hover:bg-surface-2",
        ghost: "text-ink hover:bg-surface-2",
        danger: "bg-[var(--bad-fg)] text-white hover:opacity-90",
      },
      size: { sm: "h-8 px-3", md: "h-10 px-4", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({ className, variant, size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>) {
  return <button className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-line bg-surface shadow-sm", className)} {...props} />;
}
export function CardHeader({ title, subtitle, action }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export const CardBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5", className)} {...props} />;

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "ok" | "warn" | "bad" | "info" | "neutral" }) {
  return <span className={cn(`tone-${tone} inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium`, className)} {...props} />;
}

const field = "w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted";
export const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => <input className={cn(field, "h-10", className)} {...props} />;
export const Textarea = ({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn(field, "py-2", className)} {...props} />;

export const Skeleton = ({ className }: { className?: string }) => <div className={cn("skeleton h-4 w-full", className)} aria-hidden />;

export function EmptyState({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="tone-bad rounded-lg px-4 py-3 text-sm">
      {children}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
