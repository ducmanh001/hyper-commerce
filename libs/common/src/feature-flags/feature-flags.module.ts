import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeatureFlag } from './feature-flag.entity';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureGateGuard } from './feature-gate.guard';

@Module({
  imports:   [TypeOrmModule.forFeature([FeatureFlag])],
  providers: [FeatureFlagService, FeatureGateGuard],
  exports:   [FeatureFlagService, FeatureGateGuard, TypeOrmModule],
})
export class FeatureFlagsModule {}
