// Currency and date formatting utilities for Vietnamese locale

/**
 * Format VND currency.
 * WHY CUSTOM: Intl.NumberFormat for 'vi-VN' uses ₫ suffix with dot separators
 * which matches what Vietnamese users expect.
 */
export function formatVND(amount: number): string {
  if (typeof amount !== 'number' || isNaN(amount)) return '₫0';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Compact format: 1,200,000 → 1.2M */
export function formatVNDCompact(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B₫`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M₫`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K₫`;
  return formatVND(amount);
}

/** Discount percentage: (original - sale) / original * 100 */
export function discountPct(original: number, sale: number): number {
  if (original <= 0) return 0;
  return Math.round(((original - sale) / original) * 100);
}

/** Format relative time: "2 giờ trước", "vừa xong" */
export function formatRelativeTime(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} ngày trước`;
  return new Intl.DateTimeFormat('vi-VN').format(new Date(dateStr));
}

/** Format countdown: returns { hours, minutes, seconds } */
export function parseCountdown(endsAt: string): { hours: number; minutes: number; seconds: number; expired: boolean } {
  const diff = Math.max(0, new Date(endsAt).getTime() - Date.now());
  if (diff === 0) return { hours: 0, minutes: 0, seconds: 0, expired: true };
  const seconds = Math.floor(diff / 1000) % 60;
  const minutes = Math.floor(diff / 60_000) % 60;
  const hours = Math.floor(diff / 3_600_000);
  return { hours, minutes, seconds, expired: false };
}

/** Truncate string with ellipsis */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/** Format number with dots (1234567 → 1.234.567) */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n);
}
