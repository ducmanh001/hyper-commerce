import Link from 'next/link';

const CATEGORIES = [
  { id: 'all',        name: 'Tất cả',         emoji: '🏪', href: '/products' },
  { id: 'electronics',name: 'Điện Tử',        emoji: '📱', href: '/products?category=electronics' },
  { id: 'fashion',    name: 'Thời Trang',      emoji: '👗', href: '/products?category=fashion' },
  { id: 'beauty',     name: 'Làm Đẹp',         emoji: '💄', href: '/products?category=beauty' },
  { id: 'home',       name: 'Gia Đình',        emoji: '🏠', href: '/products?category=home' },
  { id: 'food',       name: 'Thực Phẩm',       emoji: '🍜', href: '/products?category=food' },
  { id: 'sports',     name: 'Thể Thao',        emoji: '⚽', href: '/products?category=sports' },
  { id: 'books',      name: 'Sách',            emoji: '📚', href: '/products?category=books' },
  { id: 'automotive', name: 'Xe Cộ',          emoji: '🚗', href: '/products?category=automotive' },
  { id: 'pets',       name: 'Thú Cưng',        emoji: '🐾', href: '/products?category=pets' },
];

export function CategoryNav() {
  return (
    <nav className="overflow-x-auto scrollbar-none py-3">
      <ul className="flex gap-2 min-w-max px-1">
        {CATEGORIES.map((cat) => (
          <li key={cat.id}>
            <Link href={cat.href} className="category-pill group text-gray-600">
              <span className="text-2xl group-hover:scale-110 transition-transform duration-200 leading-none">
                {cat.emoji}
              </span>
              <span className="text-xs font-semibold">{cat.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

