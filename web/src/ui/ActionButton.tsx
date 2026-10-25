import { useId, type ComponentProps } from 'react';
import { Button } from './Button.tsx';
import { DisabledReason } from './DisabledReason.tsx';

type Availability = { enabled: true; reasonText?: never } | { enabled: false; reasonText: string };

type ActionButtonProps = Availability &
  Omit<ComponentProps<typeof Button>, 'disabled' | 'aria-disabled' | 'variant'> & {
    variant?: ComponentProps<typeof Button>['variant'];
  };

/** Disabled actions remain legible and explain how to continue (spec §3.1). */
export function ActionButton({
  enabled,
  reasonText,
  variant = 'primary',
  children,
  ...props
}: ActionButtonProps) {
  const reasonId = useId();
  return (
    <div className="action-control">
      <Button
        {...props}
        variant={variant}
        disabled={!enabled}
        aria-disabled={!enabled}
        aria-describedby={!enabled ? reasonId : props['aria-describedby']}
      >
        {children}
      </Button>
      {!enabled && <DisabledReason id={reasonId}>{reasonText}</DisabledReason>}
    </div>
  );
}
