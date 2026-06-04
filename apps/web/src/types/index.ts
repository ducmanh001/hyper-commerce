// =====================================================
// Shared TypeScript types for the web app
// =====================================================

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number; // VND
  originalPrice?: number; // VND before discount
  salePrice?: number; // VND if on sale
  images: string[];
  thumbnailUrl: string;
  sellerId: string;
  sellerName: string;
  sellerAvatar?: string;
  categoryId: string;
  categoryName: string;
  rating: number; // 0.0 - 5.0
  reviewCount: number;
  soldCount: number;
  stockQuantity: number;
  variants?: ProductVariant[];
  isFlashSale?: boolean;
  flashSaleEndsAt?: string;
  isSponsored?: boolean; // From ads service
  adImpressionId?: string; // For click tracking
  tags: string[];
  shippingInfo?: {
    estimatedDays: number;
    freeShipping: boolean;
    fee: number;
  };
}

export interface ProductVariant {
  id: string;
  name: string;
  options: Record<string, string>; // e.g. { color: 'Red', size: 'M' }
  price: number;
  stockQuantity: number;
  sku: string;
  imageUrl?: string;
}

export interface CartItem {
  productId: string;
  variantId?: string;
  quantity: number;
  unitPrice: number;
  product: Pick<Product, 'id' | 'name' | 'thumbnailUrl' | 'sellerId' | 'sellerName'>;
}

export interface Cart {
  items: CartItem[];
  subtotal: number;
  shippingFee: number;
  voucherDiscount: number;
  total: number;
  voucherCode?: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  shippingFee: number;
  discount: number;
  total: number;
  shippingAddress: Address;
  paymentMethod: string;
  createdAt: string;
  estimatedDelivery?: string;
  trackingNumber?: string;
}

export type OrderStatus =
  | 'PENDING'
  | 'STOCK_RESERVED'
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface OrderItem {
  productId: string;
  productName: string;
  thumbnailUrl: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Address {
  id?: string;
  fullName: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  street: string;
  isDefault?: boolean;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  phone?: string;
  roles: Array<'BUYER' | 'SELLER' | 'ADMIN'>;
  sellerProfile?: SellerProfile;
}

export interface SellerProfile {
  id: string;
  shopName: string;
  shopLogo?: string;
  rating: number;
  productCount: number;
  followerCount: number;
  tier: 'STANDARD' | 'PREMIUM' | 'ENTERPRISE' | 'FLAGSHIP';
  subscriptionPlan: 'FREE' | 'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE';
}

export interface LiveStream {
  id: string;
  title: string;
  sellerId: string;
  sellerName: string;
  sellerAvatar?: string;
  thumbnailUrl: string;
  viewerCount: number;
  isLive: boolean;
  startedAt: string;
  featuredProducts: Pick<Product, 'id' | 'name' | 'price' | 'thumbnailUrl'>[];
}

export interface SearchResult {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
  facets?: {
    categories: Array<{ id: string; name: string; count: number }>;
    priceRanges: Array<{ min: number; max: number; count: number }>;
    sellers: Array<{ id: string; name: string; count: number }>;
  };
  sponsored?: Product[];
  /** Spell-correction info from hybrid search — present when search-service is UP */
  query?: {
    original: string;
    corrected?: string;
    intent?: string;
  };
  /** Click-through tracking ID */
  searchId?: string;
}

export interface ApiError {
  statusCode: number;
  message: string;
  error: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}
