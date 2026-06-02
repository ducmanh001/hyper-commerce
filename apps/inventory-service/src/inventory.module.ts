import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ProductStock } from './entities/product-stock.entity';
import { StockReservation } from './entities/stock-reservation.entity';
import { FlashSale } from './flash-sale/entities/flash-sale.entity';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { StockRepository } from './repositories/stock.repository';
import { ReservationRepository } from './repositories/reservation.repository';
import { AtomicStockHelper } from './helpers/atomic-stock.helper';
import { FlashSaleService } from './flash-sale/flash-sale.service';
import { InventoryReconcilerService } from './reconciler/inventory-reconciler.service';
import { KafkaProducerService } from '@hypercommerce/kafka';
import { KafkaConsumerService } from '@hypercommerce/kafka';
import { RedisClientService } from '@hypercommerce/redis';

@Module({
  imports: [TypeOrmModule.forFeature([ProductStock, StockReservation, FlashSale]), ConfigModule],
  controllers: [InventoryController],
  providers: [
    InventoryService,
    StockRepository,
    ReservationRepository,
    AtomicStockHelper,
    FlashSaleService,
    InventoryReconcilerService,
    KafkaProducerService,
    KafkaConsumerService,
    RedisClientService,
  ],
  exports: [InventoryService, StockRepository],
})
export class InventoryModule {}
