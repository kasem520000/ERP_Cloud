import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseHandle } from '@erp/database';

import { DATABASE_HANDLE } from '../../../database/database.module.js';

import { configureProblemRecorder } from './problem-recorder.js';

/**
 * يهيّئ كاتب سجلّ الأخطاء عند الإقلاع — قبل أن يصل أوّل طلب.
 *
 * وحدةٌ صغيرة عمداً: لا منطق هنا إلّا ربطُ المقبض، لأن الكاتب يُستدعى من الفلتر العام ومن
 * معالجات العملية، وكلاهما خارج دورة حقن Nest.
 */
@Injectable()
export class ProblemEventsService implements OnModuleInit {
  constructor(@Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle) {}

  onModuleInit(): void {
    configureProblemRecorder(this.database);
  }
}
