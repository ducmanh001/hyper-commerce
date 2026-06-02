import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.ADMIN_JWT_SECRET,
        signOptions: {
          // Admin tokens last 8h (shift-length sessions)
          expiresIn: process.env.ADMIN_JWT_EXPIRY ?? '8h',
        },
      }),
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
