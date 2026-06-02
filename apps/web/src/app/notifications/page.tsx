'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import { useAuthStore } from '@/lib/store/auth';
import { Tabs } from '@/components/ui/Tabs';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

interface Notification {
  id:        string;
  type:      string;
  title:     string;
  body:      string;
  readAt?:   string;
  createdAt: string;
  metadata?: Record<string, string>;
}

const TYPE_ICONS: Record<string, string> = {
  ORDER_CONFIRMED:  '✅',
  ORDER_SHIPPED:    '🚚',
  ORDER_DELIVERED:  '📦',
  PAYMENT_SUCCESS:  '💳',
  FLASH_SALE:       '⚡',
  PROMOTION:        '🏷️',
  SYSTEM:           '🔔',
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading]             = useState(true);
  const [filter, setFilter]               = useState<'all' | 'unread'>('all');
  const accessToken                       = useAuthStore((s) => s.accessToken);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (filter === 'unread') params.set('unread', 'true');
      const res  = await fetch(`/api/notifications?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      setNotifications(data.items ?? []);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [filter, accessToken]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    setNotifications((ns) => ns.map((n) => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
  };

  const markAllRead = async () => {
    await fetch('/api/notifications/read-all', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    setNotifications((ns) => ns.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  };

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  const list = filter === 'unread' ? notifications.filter((n) => !n.readAt) : notifications;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Thông báo</h1>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-sm text-[#EE4D2D] hover:underline">
              Đọc tất cả
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4">
          {(['all', 'unread'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === f ? 'bg-[#EE4D2D] text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-[#EE4D2D]'
              }`}
            >
              {f === 'all' ? 'Tất cả' : `Chưa đọc${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl p-4 flex gap-3">
                <Skeleton circle className="w-10 h-10 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" rounded />
                  <Skeleton className="h-3 w-full" rounded />
                </div>
              </div>
            ))
          ) : list.length === 0 ? (
            <EmptyState icon="🔔" title="Không có thông báo" message="Bạn đã đọc tất cả thông báo" />
          ) : (
            list.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.readAt && markRead(n.id)}
                className={`w-full text-left bg-white rounded-xl p-4 border transition-colors hover:border-[#EE4D2D]/30 ${
                  !n.readAt ? 'border-[#EE4D2D]/20 bg-[#FFF8F7]' : 'border-gray-100'
                }`}
              >
                <div className="flex gap-3">
                  <span className="text-2xl flex-shrink-0 mt-0.5">
                    {TYPE_ICONS[n.type] ?? '🔔'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium ${!n.readAt ? 'text-gray-900' : 'text-gray-700'}`}>
                        {n.title}
                      </p>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: vi })}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                  </div>
                  {!n.readAt && (
                    <span className="w-2 h-2 rounded-full bg-[#EE4D2D] flex-shrink-0 mt-2" />
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
