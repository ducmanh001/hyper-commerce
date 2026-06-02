import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  VersionColumn,
  Index,
} from 'typeorm';

@Entity('product_stock')
@Index(['productId', 'variantId'], { unique: true })
export class ProductStock {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  productId!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  variantId?: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  sellerId?: string;

  /** Physical available stock in DB — single source of truth */
  @Column({ type: 'int', default: 0 })
  available!: number;

  /** Amount currently reserved (ORDER_CREATED, awaiting payment) */
  @Column({ type: 'int', default: 0 })
  reserved!: number;

  /** Total physical stock = available + reserved + sold */
  @Column({ type: 'int', default: 0 })
  total!: number;

  /** Threshold below which low-stock alert fires */
  @Column({ type: 'int', default: 10 })
  lowStockThreshold!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /** Optimistic locking prevents concurrent over-reservation */
  @VersionColumn()
  version!: number;

  @UpdateDateColumn()
  updatedAt!: Date;
}
