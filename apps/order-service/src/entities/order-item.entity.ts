import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('order_items')
@Index(['orderId'])
@Index(['productId'])
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  orderId!: string;

  @Column({ type: 'varchar', length: 36 })
  productId!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  variantId?: string;

  @Column({ type: 'varchar', length: 100 })
  productName!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  sellerId?: string;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ type: 'bigint' })
  unitPrice!: number; // in smallest currency unit

  @Column({ type: 'bigint' })
  subtotal!: number;

  @Column({ type: 'jsonb', nullable: true })
  snapshot?: Record<string, unknown>; // Product snapshot at time of order

  @CreateDateColumn()
  createdAt!: Date;
}
