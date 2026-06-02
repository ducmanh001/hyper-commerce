import { Eye } from 'lucide-react';

// Placeholder LiveStreamCard — real implementation would fetch from live-service WebSocket
export function LiveStreamCard() {
  return (
    <div className="card overflow-hidden cursor-pointer group hover:shadow-md transition-shadow">
      <div className="relative aspect-video bg-gradient-to-br from-purple-900 to-pink-900">
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse inline-block" />
          LIVE
        </div>
        <div className="absolute bottom-2 right-2 flex items-center gap-1 text-white text-xs bg-black/50 rounded px-2 py-0.5">
          <Eye className="w-3 h-3" />
          1.2K
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-white/40 text-4xl">📺</div>
        </div>
      </div>
      <div className="p-2">
        <p className="text-sm font-medium text-gray-800 truncate">Unboxing mỹ phẩm Hàn Quốc</p>
        <p className="text-xs text-gray-500">Shop Nữ Hoàng Beauty</p>
      </div>
    </div>
  );
}
