'use client';

interface ProductFiltersProps {
  currentCategory?: string;
  currentMinPrice?: number;
  currentMaxPrice?: number;
}

const CATEGORIES = [
  { id: 'electronics', name: '📱 Điện Tử' },
  { id: 'fashion', name: '👗 Thời Trang' },
  { id: 'beauty', name: '💄 Làm Đẹp' },
  { id: 'home', name: '🏠 Gia Đình' },
  { id: 'food', name: '🍜 Thực Phẩm' },
  { id: 'sports', name: '⚽ Thể Thao' },
];

const PRICE_RANGES = [
  { label: 'Dưới 100K', min: 0, max: 100_000 },
  { label: '100K – 500K', min: 100_000, max: 500_000 },
  { label: '500K – 1M', min: 500_000, max: 1_000_000 },
  { label: 'Trên 1M', min: 1_000_000, max: undefined },
];

export function ProductFilters({ currentCategory, currentMinPrice, currentMaxPrice }: ProductFiltersProps) {
  return (
    <div className="space-y-6">
      {/* Categories */}
      <div>
        <h3 className="font-semibold text-sm text-gray-700 mb-2 uppercase tracking-wide">Danh mục</h3>
        <ul className="space-y-1">
          {CATEGORIES.map((cat) => (
            <li key={cat.id}>
              <a
                href={`/products?category=${cat.id}`}
                className={`block px-3 py-2 text-sm rounded-md transition-colors ${
                  currentCategory === cat.id
                    ? 'bg-primary-50 text-primary-600 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {cat.name}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {/* Price ranges */}
      <div>
        <h3 className="font-semibold text-sm text-gray-700 mb-2 uppercase tracking-wide">Khoảng giá</h3>
        <ul className="space-y-1">
          {PRICE_RANGES.map((range) => (
            <li key={range.label}>
              <a
                href={`/products?minPrice=${range.min}${range.max ? `&maxPrice=${range.max}` : ''}${currentCategory ? `&category=${currentCategory}` : ''}`}
                className={`block px-3 py-2 text-sm rounded-md transition-colors ${
                  currentMinPrice === range.min && currentMaxPrice === range.max
                    ? 'bg-primary-50 text-primary-600 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {range.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
