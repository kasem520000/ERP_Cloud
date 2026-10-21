import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { Injectable, Logger } from '@nestjs/common';
import { env } from '@erp/config';
import { DomainError, errorCodes } from '@erp/contracts';

import { PasswordBreachChecker } from './password-breach.js';
import { evaluatePasswordPolicy } from './password-policy.js';

/**
 * Argon2id hashing with the parameters frozen by PROJECT_CONTRACT §9 and
 * SECURITY_ARCHITECTURE §2: memory 64 MiB, time cost 3, parallelism 4.
 *
 * The values come from `packages/config` so an operator can see them, but the defaults
 * ARE the frozen ones and changing them is a contract change, not a config tweak.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  /** لا يُسجَّل تحذيرُ تعذّر الفحص أكثر من مرّة كل خمس دقائق — مزوّدٌ ساقط لا يُغرق السجل. */
  private lastUnavailableLogAt = 0;

  constructor(private readonly breach: PasswordBreachChecker = new PasswordBreachChecker()) {}

  private get options() {
    return {
      memoryCost: env.AUTH_ARGON2_MEMORY_KIB,
      timeCost: env.AUTH_ARGON2_TIME_COST,
      parallelism: env.AUTH_ARGON2_PARALLELISM,
      outputLen: env.AUTH_ARGON2_OUTPUT_LENGTH,
    };
  }

  /**
   * يفرض السياسة **قبل** التجزئة فتسقط الكلمات الضعيفة رخيصةً، ثم يفحص قاعدة التسريبات.
   *
   * ترتيبٌ مقصود: القواعد المحلّية تُقاس أوّلاً، ولا يُنادَى مزوّدٌ خارجي عن كلمة مرورٍ
   * ساقطةٍ أصلاً (قصيرة أو بلا تنويع). والفحص الخارجي وحده قد يغيب — فيبقى ما يُقاس هنا.
   */
  async assertPolicy(password: string, context: { email?: string; fullName?: string } = {}): Promise<void> {
    const result = evaluatePasswordPolicy(password, context);
    if (!result.ok) {
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        'Password does not satisfy the tenant password policy',
        400,
        result.issues.map((issue) => ({ field: 'new', message: issue.message })),
      );
    }

    const verdict = await this.breach.check(password);
    if (verdict.status === 'breached') {
      if (this.breach.mode === 'warn') {
        // وضع المراقبة: يُسجَّل الحدث ويُترك القرار للسياسة المحلّية — وهذا ما يجعل
        // تشغيل الفحص ممكناً قبل فرضه، بدل أن يكون إمّا معطّلاً أو حاجزاً مفاجئاً.
        this.logger.warn(
          `password matched a breached-password range (seen ${verdict.count} times); allowed by PASSWORD_BREACH_CHECK=warn`,
        );
        return;
      }
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        'Password does not satisfy the tenant password policy',
        400,
        [
          {
            field: 'new',
            message: `Password has appeared in known data breaches (${verdict.count} times); choose one that has not been exposed`,
          },
        ],
      );
    }

    if (verdict.status === 'unknown' && verdict.reason === 'unavailable' && this.shouldLogUnavailable()) {
      const snapshot = this.breach.snapshot();
      this.logger.warn(
        `breached-password lookup unavailable (${snapshot.lastError ?? 'no detail'}); ` +
          `consecutive failures ${snapshot.consecutiveFailures}` +
          (snapshot.circuitOpenUntil ? `, circuit open until ${new Date(snapshot.circuitOpenUntil).toISOString()}` : ''),
      );
    }
  }

  /** عدّادات الفحص — تُقرأ في لوحة الصحة، لا في واجهة المستأجر. */
  breachSnapshot(): ReturnType<PasswordBreachChecker['snapshot']> {
    return this.breach.snapshot();
  }

  private shouldLogUnavailable(): boolean {
    const now = Date.now();
    if (now - this.lastUnavailableLogAt < 5 * 60_000) return false;
    this.lastUnavailableLogAt = now;
    return true;
  }

  async hash(password: string): Promise<string> {
    return argon2Hash(password, this.options);
  }

  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    if (!passwordHash) return false;
    try {
      return await argon2Verify(passwordHash, password, this.options);
    } catch {
      return false;
    }
  }
}
