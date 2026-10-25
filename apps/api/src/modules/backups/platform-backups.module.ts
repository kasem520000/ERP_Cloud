import { Module } from '@nestjs/common';
import type { DatabaseHandle } from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { OBJECT_STORAGE, type ObjectStoragePort } from '../platform-services/files/object-storage.js';

import {
  ARTIFACT_STORE_FS,
  ARTIFACT_STORE_S3,
  FileArtifactStore,
  S3ArtifactStore,
} from './artifact-store.js';
import {
  GOOGLE_DRIVE_PORT,
  GoogleDriveRestPort,
} from './google-drive.port.js';
import { PlatformBackupsController } from './platform-backups.controller.js';
import { PlatformBackupsService } from './platform-backups.service.js';

@Module({
  imports: [PlatformModule],
  controllers: [PlatformBackupsController],
  providers: [
    PlatformBackupsService,
    { provide: ARTIFACT_STORE_FS, useFactory: () => new FileArtifactStore() },
    {
      provide: ARTIFACT_STORE_S3,
      useFactory: (storage: ObjectStoragePort) => new S3ArtifactStore(storage),
      inject: [OBJECT_STORAGE],
    },
    {
      provide: GOOGLE_DRIVE_PORT,
      useFactory: (database: DatabaseHandle) => new GoogleDriveRestPort(database),
      inject: [DATABASE_HANDLE],
    },
  ],
  exports: [PlatformBackupsService],
})
export class PlatformBackupsModule {}
