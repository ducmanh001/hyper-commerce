import { Star } from 'lucide-react';

interface ReviewSectionProps {
  productId: string;
  rating: number;
  reviewCount: number;
}

export function ReviewSection({ rating, reviewCount }: ReviewSectionProps) {
  if (reviewCount === 0) {
    return <p className="text-gray-500 text-sm">Chưa có đánh giá nào cho sản phẩm này.</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-6 mb-6 pb-6 border-b">
        <div className="text-center">
          <p className="text-5xl font-extrabold text-primary-500">{rating.toFixed(1)}</p>
          <div className="flex justify-center my-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} className={`w-4 h-4 ${i < Math.round(rating) ? 'fill-yellow-400 stroke-yellow-400' : 'stroke-gray-300'}`} />
            ))}
          </div>
          <p className="text-sm text-gray-500">{reviewCount.toLocaleString('vi-VN')} đánh giá</p>
        </div>
        <div className="flex-1 space-y-1">
          {[5, 4, 3, 2, 1].map((star) => (
            <div key={star} className="flex items-center gap-2 text-sm">
              <span className="text-gray-500 w-4">{star}</span>
              <Star className="w-3 h-3 fill-yellow-400 stroke-yellow-400" />
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div
                  className="bg-yellow-400 h-2 rounded-full"
                  style={{ width: `${star === 5 ? 70 : star === 4 ? 20 : 5}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-500">Đang tải đánh giá...</p>
    </div>
  );
}
