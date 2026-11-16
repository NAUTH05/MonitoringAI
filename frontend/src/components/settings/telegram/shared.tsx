"use client";

/**
 * Small building blocks for the Telegram settings screens.
 *
 * Deliberately hand-rolled with the same Tailwind vocabulary the rest of the
 * dashboard uses (gray-900 surfaces, blue-600 primary, rounded-xl cards) rather
 * than introducing a new component library.
 */
import { cn } from "@/lib/utils";
import { Loader2, X } from "lucide-react";
import { useEffect } from "react";

export const inputClass =
  "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-600";

export const selectClass =
  "bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-600";

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = "max-w-lg",
  elevated = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
  elevated?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4",
        elevated ? "z-[60]" : "z-50",
      )}
      onClick={onClose}
    >
      <div
        className={cn(
          "bg-gray-900 border border-gray-800 rounded-2xl w-full shadow-2xl flex flex-col max-h-[90vh]",
          width,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-gray-800 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white truncate">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-white transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">{children}</div>

        {footer && (
          <div className="p-4 border-t border-gray-800 flex justify-end gap-2 shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-gray-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-600 leading-relaxed">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative shrink-0 w-9 h-5 rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-blue-600" : "bg-gray-700",
      )}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
        style={{ left: checked ? 18 : 2 }}
      />
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  loading,
  disabled,
  type = "button",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const variants: Record<string, string> = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white",
    secondary: "bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700",
    danger: "bg-red-600/90 hover:bg-red-600 text-white",
    ghost: "text-gray-400 hover:text-white hover:bg-gray-800",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-40 disabled:cursor-not-allowed",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        variants[variant],
      )}
    >
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "bad" | "idle" }) {
  const tones: Record<string, string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
    idle: "bg-gray-600",
  };
  return <span className={cn("inline-block w-1.5 h-1.5 rounded-full", tones[tone])} />;
}

export function Badge({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "green" | "red" | "amber" | "blue";
}) {
  const tones: Record<string, string> = {
    gray: "text-gray-400 border-gray-700 bg-gray-800/60",
    green: "text-emerald-300 border-emerald-600/40 bg-emerald-500/10",
    red: "text-red-300 border-red-600/40 bg-red-500/10",
    amber: "text-amber-300 border-amber-600/40 bg-amber-500/10",
    blue: "text-blue-300 border-blue-600/40 bg-blue-500/10",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border whitespace-nowrap",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  loading,
  danger = true,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  danger?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width="max-w-sm"
      elevated
      footer={
        <>
          <Button onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            loading={loading}
            variant={danger ? "danger" : "primary"}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-300 leading-relaxed">{message}</p>
    </Modal>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-3 py-2.5 text-sm">
      {message}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center space-y-2">
      <div className="text-gray-600 flex justify-center">{icon}</div>
      <p className="text-sm text-gray-300">{title}</p>
      {hint && <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">{hint}</p>}
      {action && <div className="pt-2 flex justify-center">{action}</div>}
    </div>
  );
}
