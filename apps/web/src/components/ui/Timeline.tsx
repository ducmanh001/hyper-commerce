interface TimelineEvent {
  label:       string;
  description?: string;
  timestamp?:  string;
  status:      'done' | 'active' | 'pending';
}

interface TimelineProps {
  events: TimelineEvent[];
}

export function Timeline({ events }: TimelineProps) {
  return (
    <ol className="relative ml-3">
      {events.map((ev, i) => (
        <li key={i} className="mb-8 ml-6 last:mb-0">
          {/* Connector line */}
          {i < events.length - 1 && (
            <span className={`absolute left-0 top-1 w-px h-[calc(100%+0.5rem)] ${ev.status === 'done' ? 'bg-[#EE4D2D]' : 'bg-gray-200'}`} />
          )}
          {/* Dot */}
          <span className={`
            absolute -left-1.5 flex items-center justify-center w-4 h-4 rounded-full border-2
            ${ev.status === 'done'    ? 'bg-[#EE4D2D] border-[#EE4D2D]' : ''}
            ${ev.status === 'active'  ? 'bg-white border-[#EE4D2D] ring-2 ring-[#EE4D2D]/20' : ''}
            ${ev.status === 'pending' ? 'bg-white border-gray-300' : ''}
          `}>
            {ev.status === 'done' && (
              <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z"/>
              </svg>
            )}
            {ev.status === 'active' && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#EE4D2D]" />
            )}
          </span>

          <div className="ml-2">
            <h4 className={`text-sm font-semibold ${ev.status === 'pending' ? 'text-gray-400' : 'text-gray-800'}`}>
              {ev.label}
            </h4>
            {ev.description && (
              <p className="text-xs text-gray-500 mt-0.5">{ev.description}</p>
            )}
            {ev.timestamp && (
              <time className="text-xs text-gray-400">{ev.timestamp}</time>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
