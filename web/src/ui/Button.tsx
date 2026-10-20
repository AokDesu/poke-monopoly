import type { ButtonHTMLAttributes } from 'react';

const VARIANTS = {
  primary: 'bg-accent text-paper hover:bg-accent-strong',
  secondary: 'border border-line text-ink hover:border-ink-soft hover:bg-surface',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: keyof typeof VARIANTS;
}

export function Button({ variant, className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-12 items-center rounded-lg px-5 text-base font-bold ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
