import { ReactNode } from 'react';

interface BadgeProps {
  children:  ReactNode;
  variant?:  'default' | 'success' | 'warning' | 'error' | 'info' | 'orange';
  size?:     'sm' | 'md';
  dot?:      boolean;
}

const VARIANTS: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  error:   'bg-red-100 text-red-700',
  info:    'bg-blue-100 text-blue-700',
  orange:  'bg-[#FFF3F0] text-[#EE4D2D]',
};

const DOT_COLORS: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-gray-400',
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  error:   'bg-red-500',
  info:    'bg-blue-500',
  orange:  'bg-[#EE4D2D]',
};

export function Badge({ children, variant = 'default', size = 'sm', dot }: BadgeProps) {
  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  return (
    <span className={`inline-flex items-center gap-1 font-medium rounded-full ${VARIANTS[variant]} ${padding}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS[variant]}`} />}
      {children}
    </span>
  );
}

/** Convenience variants */
export const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, BadgeProps['variant']> = {
    ACTIVE:    'success', CONFIRMED: 'success', APPROVED: 'success', CAPTURED: 'success',
    PENDING:   'warning', PROCESSING: 'warning', PENDING_MODERATION: 'warning',
    CANCELLED: 'error',   REJECTED: 'error', BANNED: 'error', FAILED: 'error',
    SHIPPED:   'info',    DELIVERED: 'info',
  };
  const variant = map[status] ?? 'default';
  return <Badge variant={variant} dot>{status.replace(/_/g, ' ')}</Badge>;
};
