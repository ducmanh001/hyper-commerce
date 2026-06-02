import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { MOCK_LIVE_STREAMS } from '@/lib/mock-data';

export const metadata: Metadata = { title: 'Live Stream | HyperCommerce' };

interface LiveRoom {
  id:          string;
  title:       string;
  sellerName:  string;
  sellerAvatar?: string;
  thumbnailUrl?: string;
  viewerCount: number;
  category:    string;
  isFlashSale: boolean;
}

async function getLiveRooms(): Promise<LiveRoom[]> {
  try {
    const res = await fetch(`${process.env.GATEWAY_URL ?? 'http://localhost:4000'}/api/live/rooms/active`, {
      next: { revalidate: 30 },
    });
    if (res.ok) {
      const data = await res.json();
      const items: LiveRoom[] = data.items ?? [];
      if (items.length > 0) return items;
    }
  } catch { /* fall through */ }

  // Mock fallback
  return MOCK_LIVE_STREAMS.map((s) => ({
    id:          s.id,
    title:       s.title,
    sellerName:  s.hostName,
    sellerAvatar: s.hostAvatar,
    thumbnailUrl: s.thumbnailUrl,
    viewerCount: s.viewerCount,
    category:    'Tất cả',
    isFlashSale: s.id === 'live-1',
  }));
}

export default async function LiveListPage() {
  const rooms = await getLiveRooms();

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <h1 className="text-2xl font-bold">Live Stream</h1>
          <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded-full font-medium">
            {rooms.length} phòng đang phát
          </span>
        </div>

        {rooms.length === 0 ? (
          <div className="text-center py-24 text-gray-500">
            <p className="text-4xl mb-4">📺</p>
            <p className="text-lg font-medium">Chưa có phòng live nào</p>
            <p className="text-sm mt-1">Quay lại sau nhé!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {rooms.map((room) => (
              <Link key={room.id} href={`/live/${room.id}`}>
                <div className="group rounded-xl overflow-hidden bg-gray-900 hover:ring-2 hover:ring-[#EE4D2D] transition-all">
                  <div className="relative aspect-video bg-gray-800">
                    {room.thumbnailUrl ? (
                      <Image
                        src={room.thumbnailUrl}
                        alt={room.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 640px) 100vw, 25vw"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-gray-700">📹</div>
                    )}

                    {/* LIVE badge */}
                    <span className="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded">
                      LIVE
                    </span>

                    {/* Flash sale badge */}
                    {room.isFlashSale && (
                      <span className="absolute top-2 right-2 bg-[#EE4D2D] text-white text-xs font-bold px-2 py-0.5 rounded">
                        ⚡ Flash
                      </span>
                    )}

                    {/* Viewer count */}
                    <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full">
                      <span>👁</span>
                      <span>{room.viewerCount.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="p-3">
                    <p className="text-sm font-medium text-white line-clamp-2">{room.title}</p>
                    <div className="flex items-center gap-2 mt-2">
                      {room.sellerAvatar ? (
                        <Image src={room.sellerAvatar} alt={room.sellerName} width={20} height={20} className="rounded-full" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center text-xs">
                          {room.sellerName.charAt(0)}
                        </div>
                      )}
                      <span className="text-xs text-gray-400">{room.sellerName}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
