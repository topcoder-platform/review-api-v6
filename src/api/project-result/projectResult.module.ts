import { Module } from '@nestjs/common';
import { ProjectResultController } from './projectResult.controller';
import { ProjectResultService } from './projectResult.service';
import { GlobalProvidersModule } from '../../shared/modules/global/globalProviders.module';

@Module({
  imports: [GlobalProvidersModule],
  controllers: [ProjectResultController],
  providers: [ProjectResultService],
  exports: [ProjectResultService],
})
export class ProjectResultModule {}
