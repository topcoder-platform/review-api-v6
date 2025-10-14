import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

@Module({
  imports: [
    MulterModule.register({
      // Use in-memory storage to be compatible with read-only root filesystems
      // (e.g., ECS tasks with readonlyRootFilesystem). Services that need
      // persistence should stream the buffer to external storage (e.g., S3).
      storage: memoryStorage(),
    }),
  ],
  controllers: [],
  providers: [],
  exports: [MulterModule],
})
export class FileUploadModule {}
