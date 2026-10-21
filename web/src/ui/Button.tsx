import type { ButtonHTMLAttributes } from 'react';

const VARIANTS = {
  primary: 'bg-accent text-on-accent hover:bg-accent-strong',
  secondary: 'border border-line-strong bg-card text-ink hover:border-accent hover:bg-surface',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: keyof typeof VARIANTS;
}

export function Button({ variant, className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-12 items-center justify-center rounded-xl px-6 text-base font-bold transition-colors duration-150 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
