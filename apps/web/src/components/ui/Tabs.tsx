'use client';

import { ReactNode, useState } from 'react';

interface Tab {
  key:      string;
  label:    ReactNode;
  content:  ReactNode;
  badge?:   number;
}

interface TabsProps {
  tabs:        Tab[];
  defaultTab?: string;
  onChange?:   (key: string) => void;
}

export function Tabs({ tabs, defaultTab, onChange }: TabsProps) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.key ?? '');

  const handleChange = (key: string) => {
    setActive(key);
    onChange?.(key);
  };

  const current = tabs.find((t) => t.key === active);

  return (
    <div>
      <div className="flex border-b border-gray-200 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => handleChange(tab.key)}
            className={`
              flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-all
              ${active === tab.key
                ? 'border-[#EE4D2D] text-[#EE4D2D]'
                : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'}
            `}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="bg-[#EE4D2D] text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="py-4">
        {current?.content}
      </div>
    </div>
  );
}
