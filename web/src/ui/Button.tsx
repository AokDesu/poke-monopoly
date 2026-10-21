import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the screen's way on (red); reward: a playful shortcut (yellow); secondary: Back. */
  variant: 'primary' | 'reward' | 'secondary';
}

/** A pressable pill: its lip collapses on press (DESIGN.md, motion). */
export function Button({ variant, className = '', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={`btn btn-${variant} ${className}`} {...props} />;
}
