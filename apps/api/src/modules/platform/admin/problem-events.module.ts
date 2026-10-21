import { Module } from '@nestjs/common';

import { ProblemEventsService } from './problem-events.service.js';
import { ProblemIngestController } from './problem-ingest.controller.js';

@Module({
  controllers: [ProblemIngestController],
  providers: [ProblemEventsService],
})
export class ProblemEventsModule {}
