import { ReactNode } from 'react';

interface StatsCardProps {
  label:       string;
  value:       string | number;
  subValue?:   string;
  change?:     number;       // positive = green, negative = red
  icon?:       ReactNode;
  accent?:     string;       // tailwind bg class for icon bg
}

export function StatsCard({ label, value, subValue, change, icon, accent = 'bg-orange-50' }: StatsCardProps) {
  const isPositive = change !== undefined && change >= 0;
  const isNegative = change !== undefined && change < 0;

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-gray-500 font-medium">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {subValue && <p className="text-xs text-gray-400 mt-0.5">{subValue}</p>}
        </div>
        {icon && (
          <div className={`w-11 h-11 rounded-xl ${accent} flex items-center justify-center flex-shrink-0`}>
            {icon}
          </div>
        )}
      </div>
      {change !== undefined && (
        <div className="mt-3 flex items-center gap-1">
          <span className={`text-xs font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {isPositive ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
          </span>
          <span className="text-xs text-gray-400">so với tháng trước</span>
        </div>
      )}
    </div>
  );
}
