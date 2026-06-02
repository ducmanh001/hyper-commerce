import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export type FlashSaleStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';

@Entity('flash_sales')
@Index(['productId', 'status'])
@Index(['startTime', 'endTime'])
export class FlashSale {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'product_id' })
  @Index()
  productId!: string;

  @Column({ name: 'variant_id', nullable: true })
  variantId?: string;

  @Column({ name: 'seller_id' })
  sellerId!: string;

  @Column({ name: 'original_price', type: 'bigint' })
  originalPrice!: number;

  @Column({ name: 'sale_price', type: 'bigint' })
  salePrice!: number;

  /** Alias for backwards-compat with service code */
  get flashPrice(): number { return this.salePrice; }

  @Column({ name: 'allocated_stock', type: 'int' })
  allocatedStock!: number;

  /** Alias for backwards-compat with service code */
  get quantity(): number { return this.allocatedStock; }

  @Column({ name: 'sold_count', type: 'int', default: 0 })
  soldCount!: number;

  @Column({ name: 'per_user_limit', type: 'int', default: 1 })
  perUserLimit!: number;

  @Column({ type: 'enum', enum: ['SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED'], default: 'SCHEDULED' })
  status!: FlashSaleStatus;

  @Column({ name: 'start_time', type: 'timestamptz' })
  startTime!: Date;

  @Column({ name: 'end_time', type: 'timestamptz' })
  endTime!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
