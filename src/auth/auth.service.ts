import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  BadGatewayException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { Resend } from 'resend';
import { performance } from 'node:perf_hooks';
import { User } from '../users/user.entity';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { StreamService } from '../stream/stream.service';
import { Provider } from '../providers/providers.entity';
import { EmailVerificationCode } from './email-verification-code.entity';
import { ConfirmEmailVerificationDto } from './dto/confirm-email-verification.dto';
import { PasswordResetCode } from './password-reset-code.entity';
import { buildBooOtpEmail } from './transactional-email.templates';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(PasswordResetCode)
    private readonly passwordResetCodesRepo: Repository<PasswordResetCode>,
    @InjectRepository(EmailVerificationCode)
    private readonly emailVerificationRepo: Repository<EmailVerificationCode>,
    @InjectRepository(Provider)
    private readonly providersRepo: Repository<Provider>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly streamService: StreamService,
    private readonly dataSource: DataSource,
  ) {}

  private readonly passwordResetMessage = {
    message:
      'If an account exists for this email, a password reset code has been sent.',
  };

  private tokenLifetime(key: string, fallback: string): number | string {
    const configured = this.config.get<string>(key)?.trim() || fallback;
    // JWT libraries interpret bare strings as milliseconds, but numeric values as seconds.
    if (/^\d+$/.test(configured)) {
      const seconds = Number(configured);
      if (!Number.isSafeInteger(seconds) || seconds <= 0) {
        throw new Error('JWT duration must be a positive number of seconds');
      }
      return seconds;
    }
    return configured;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private issueTokens(user: User) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      authVersion: user.authVersion ?? 0,
    };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: this.tokenLifetime('JWT_EXPIRES_IN', '15m') as any,
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.tokenLifetime('JWT_REFRESH_EXPIRES_IN', '7d') as any,
    });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: user.fullName,
        emailVerified: Boolean(user.emailVerifiedAt),
      },
    };
  }

  private async authenticationResponse(user: User) {
    let streamToken: string | null = null;
    try {
      let isVerified: boolean | undefined;
      if (user.role === 'provider') {
        const profile = await this.providersRepo.findOne({
          where: { userId: user.id },
        });
        isVerified = profile?.isVerified ?? false;
      }
      await this.streamService.upsertStreamUser(
        user.id,
        user.fullName,
        user.role,
        isVerified,
      );
      streamToken = this.streamService.generateStreamToken(user.id);
    } catch {
      this.logger.warn(
        'Stream setup failed; Boo authentication remains available',
      );
    }
    // Issue Boo tokens after optional chat setup so they are fresh on delivery.
    return { ...this.issueTokens(user), stream_token: streamToken };
  }

  async register(dto: SignupDto) {
    const email = this.normalizeEmail(dto.email);
    const exists = await this.usersRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = :email', { email })
      .getOne();
    if (exists) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.usersRepo.create({
      email,
      passwordHash,
      fullName: dto.fullName,
      role: dto.role ?? 'owner',
    });
    await this.usersRepo.save(user);
    return this.authenticationResponse(user);
  }

  async login(dto: LoginDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = :email', { email })
      .getOne();
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.isBanned) {
      throw new ForbiddenException(
        'Your account has been suspended. Please contact support@boo.co.ke',
      );
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.authenticationResponse(user);
  }

  private passwordResetCodeHash(userId: string, code: string): string {
    const secret = this.config.get<string>('PASSWORD_RESET_SECRET')?.trim();
    if (!secret) throw new Error('Password reset secret is not configured');
    return createHmac('sha256', secret)
      .update(`password-reset:${userId}:${code}`, 'utf8')
      .digest('hex');
  }

  /**
   * Keep valid reset requests within a bounded timing envelope. Resend latency
   * is never delayed or cancelled; this only pads faster paths to 750-1000ms.
   */
  private async equalizePasswordResetTiming(startedAt: number): Promise<void> {
    const minimumMs = 750 + randomInt(0, 251);
    const remainingMs = minimumMs - (performance.now() - startedAt);
    if (remainingMs > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.ceil(remainingMs)),
      );
    }
  }

  async requestPasswordReset(dto: PasswordResetRequestDto) {
    const startedAt = performance.now();
    try {
      const email = this.normalizeEmail(dto.email);
      const user = await this.usersRepo
        .createQueryBuilder('user')
        .where('LOWER(user.email) = :email', { email })
        .getOne();
      if (!user) return this.passwordResetMessage;

      const now = new Date();
      let issued: {
        resetId: string;
        email: string;
        code: string;
        expiresAt: Date;
      } | null = null;

      try {
        issued = await this.dataSource.transaction(async (manager) => {
          const lockedUser = await manager.findOne(User, {
            where: { id: user.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!lockedUser) return null;

          const recent = await manager.find(PasswordResetCode, {
            where: {
              userId: lockedUser.id,
              createdAt: MoreThan(new Date(now.getTime() - 60 * 60 * 1000)),
              deliveryFailedAt: IsNull(),
            },
            order: { createdAt: 'DESC' },
          });
          const lastSuccessful = recent[0];
          if (lastSuccessful) {
            const elapsed = Math.floor(
              (now.getTime() - lastSuccessful.lastSentAt.getTime()) / 1000,
            );
            if (elapsed < 60 || recent.length >= 3) return null;
          }

          await manager
            .createQueryBuilder()
            .update(PasswordResetCode)
            .set({ consumedAt: now })
            .where('user_id = :userId AND consumed_at IS NULL', {
              userId: lockedUser.id,
            })
            .execute();

          const code = randomInt(100000, 1000000).toString();
          const record = manager.create(PasswordResetCode, {
            userId: lockedUser.id,
            codeHash: this.passwordResetCodeHash(lockedUser.id, code),
            expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
            failedAttempts: 0,
            consumedAt: null,
            lastSentAt: now,
            deliveryFailedAt: null,
          });
          const saved = await manager.save(PasswordResetCode, record);
          return {
            resetId: saved.resetId,
            email: lockedUser.email,
            code,
            expiresAt: saved.expiresAt,
          };
        });

        if (issued) {
          try {
            await this.sendPasswordResetEmail(
              issued.email,
              issued.code,
              issued.expiresAt,
            );
          } catch (error) {
            await this.passwordResetCodesRepo.update(issued.resetId, {
              consumedAt: new Date(),
              deliveryFailedAt: new Date(),
            });
            this.logger.warn(
              `Password reset delivery failed user=${user.id} category=${
                error instanceof Error ? 'provider_error' : 'unknown_error'
              }`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `Password reset request failed category=${
            error instanceof Error ? 'persistence_error' : 'unknown_error'
          }`,
        );
      }
      return this.passwordResetMessage;
    } finally {
      await this.equalizePasswordResetTiming(startedAt);
    }
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto) {
    const email = this.normalizeEmail(dto.email);
    const now = new Date();
    const outcome = await this.dataSource.transaction(async (manager) => {
      const user = await manager
        .createQueryBuilder(User, 'user')
        .addSelect('user.passwordHash')
        .where('LOWER(user.email) = :email', { email })
        .setLock('pessimistic_write')
        .getOne();
      if (!user) return { kind: 'invalid_code' as const };

      const reset = await manager.findOne(PasswordResetCode, {
        where: { userId: user.id, consumedAt: IsNull() },
        order: { createdAt: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reset) return { kind: 'invalid_code' as const };
      if (reset.expiresAt.getTime() <= now.getTime()) {
        reset.consumedAt = now;
        await manager.save(PasswordResetCode, reset);
        return { kind: 'expired' as const };
      }
      if (reset.failedAttempts >= 5) {
        reset.consumedAt = now;
        await manager.save(PasswordResetCode, reset);
        return { kind: 'exhausted' as const };
      }

      const expected = Buffer.from(reset.codeHash, 'hex');
      const actual = Buffer.from(
        this.passwordResetCodeHash(user.id, dto.code),
        'hex',
      );
      const valid =
        expected.length === actual.length && timingSafeEqual(expected, actual);
      if (!valid) {
        reset.failedAttempts += 1;
        if (reset.failedAttempts >= 5) reset.consumedAt = now;
        await manager.save(PasswordResetCode, reset);
        return reset.failedAttempts >= 5
          ? { kind: 'exhausted' as const }
          : { kind: 'incorrect' as const };
      }

      user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
      user.authVersion = (user.authVersion ?? 0) + 1;
      reset.consumedAt = now;
      await manager.save(PasswordResetCode, reset);
      await manager
        .createQueryBuilder()
        .update(PasswordResetCode)
        .set({ consumedAt: now })
        .where('user_id = :userId AND consumed_at IS NULL', { userId: user.id })
        .execute();
      await manager.save(User, user);
      return { kind: 'confirmed' as const };
    });

    switch (outcome.kind) {
      case 'confirmed':
        return {
          message: 'Password updated successfully. Please sign in again.',
        };
      case 'expired':
        throw new BadRequestException(
          'This reset code has expired. Request a new code.',
        );
      case 'exhausted':
        throw new BadRequestException(
          'Too many incorrect attempts. Request a new code.',
        );
      case 'incorrect':
        throw new BadRequestException('Incorrect reset code.');
      case 'invalid_code':
        throw new BadRequestException('Invalid or expired reset code.');
    }
  }

  async refresh(token: string) {
    try {
      const payload = this.jwtService.verify<{
        sub: string;
        authVersion: number;
      }>(token, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
      const user = await this.usersRepo.findOne({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException();
      if (payload.authVersion !== user.authVersion) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }
      if (user.isBanned)
        throw new ForbiddenException(
          'Your account has been suspended. Please contact support.',
        );
      return this.issueTokens(user);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async me(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...safe } = user;
    return { ...safe, emailVerified: Boolean(user.emailVerifiedAt) };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const updates: Partial<User> = {};
    if (dto.fullName !== undefined) updates.fullName = dto.fullName;
    if (dto.location !== undefined) updates.location = dto.location;
    if (Object.keys(updates).length > 0) {
      await this.usersRepo.update(userId, updates);
    }
    return this.me(userId);
  }

  private maskedEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '••••';
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${'•'.repeat(Math.max(2, local.length - visible.length))}@${domain}`;
  }

  private verificationCodeHash(userId: string, code: string): string {
    const secret = this.config.get<string>('EMAIL_VERIFICATION_SECRET')?.trim();
    if (!secret) throw new Error('Email verification secret is not configured');
    return createHmac('sha256', secret)
      .update(`${userId}:${code}`, 'utf8')
      .digest('hex');
  }

  async emailVerificationStatus(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return {
      emailVerified: Boolean(user.emailVerifiedAt),
      emailVerifiedAt: user.emailVerifiedAt,
      maskedEmail: this.maskedEmail(user.email),
    };
  }

  async sendEmailVerificationCode(userId: string) {
    if (!this.config.get<string>('EMAIL_VERIFICATION_SECRET')?.trim()) {
      throw new ServiceUnavailableException(
        'Email confirmation is temporarily unavailable. Please try again later.',
      );
    }
    const now = new Date();
    const result = await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new UnauthorizedException();
      if (user.emailVerifiedAt) return { alreadyVerified: true as const };

      const recent = await manager.find(EmailVerificationCode, {
        where: {
          userId,
          createdAt: MoreThan(new Date(now.getTime() - 60 * 60 * 1000)),
          deliveryFailedAt: IsNull(),
        },
        order: { createdAt: 'DESC' },
      });
      const lastSuccessful = recent[0];
      if (lastSuccessful) {
        const elapsed = Math.floor(
          (now.getTime() - lastSuccessful.lastSentAt.getTime()) / 1000,
        );
        if (elapsed < 60) {
          throw new ForbiddenException({
            code: 'EMAIL_VERIFICATION_COOLDOWN',
            message: 'Please wait before requesting another code.',
            retryAfterSeconds: 60 - elapsed,
          });
        }
        if (recent.length >= 3) {
          throw new ForbiddenException({
            code: 'EMAIL_VERIFICATION_RATE_LIMITED',
            message: 'Too many confirmation emails. Please try again later.',
            retryAfterSeconds: Math.max(
              1,
              Math.ceil(
                (recent[recent.length - 1].createdAt.getTime() +
                  60 * 60 * 1000 -
                  now.getTime()) /
                  1000,
              ),
            ),
          });
        }
      }

      await manager
        .createQueryBuilder()
        .update(EmailVerificationCode)
        .set({ consumedAt: now })
        .where('user_id = :userId AND consumed_at IS NULL', { userId })
        .execute();

      const code = randomInt(100000, 1000000).toString();
      const record = manager.create(EmailVerificationCode, {
        userId,
        codeHash: this.verificationCodeHash(userId, code),
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        failedAttempts: 0,
        consumedAt: null,
        lastSentAt: now,
        deliveryFailedAt: null,
      });
      const saved = await manager.save(EmailVerificationCode, record);
      return {
        verificationId: saved.verificationId,
        userEmail: user.email,
        code,
        expiresAt: saved.expiresAt,
      };
    });

    if ('alreadyVerified' in result) {
      return { sent: false, alreadyVerified: true };
    }

    try {
      await this.sendEmailVerificationEmail(
        result.userEmail,
        result.code,
        result.expiresAt,
      );
    } catch (error) {
      await this.emailVerificationRepo.update(result.verificationId, {
        consumedAt: new Date(),
        deliveryFailedAt: new Date(),
      });
      this.logger.warn(
        `Email verification delivery failed user=${userId} category=${
          error instanceof Error ? 'provider_error' : 'unknown_error'
        }`,
      );
      throw new BadGatewayException(
        'We could not send the confirmation email. Please try again.',
      );
    }

    return {
      sent: true,
      maskedEmail: this.maskedEmail(result.userEmail),
      expiresInSeconds: Math.max(
        0,
        Math.ceil((result.expiresAt.getTime() - Date.now()) / 1000),
      ),
      resendAvailableInSeconds: 60,
    };
  }

  async confirmEmailVerificationCode(
    userId: string,
    dto: ConfirmEmailVerificationDto,
  ) {
    const now = new Date();
    const outcome = await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new UnauthorizedException();
      if (user.emailVerifiedAt) {
        return {
          kind: 'already_verified' as const,
          emailVerifiedAt: user.emailVerifiedAt,
        };
      }

      const codeRecord = await manager.findOne(EmailVerificationCode, {
        where: { userId, consumedAt: IsNull() },
        order: { createdAt: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!codeRecord) {
        return { kind: 'no_active_code' as const };
      }
      if (codeRecord.expiresAt.getTime() <= now.getTime()) {
        codeRecord.consumedAt = now;
        await manager.save(EmailVerificationCode, codeRecord);
        return { kind: 'code_expired' as const };
      }
      if (codeRecord.failedAttempts >= 5) {
        if (!codeRecord.consumedAt) {
          codeRecord.consumedAt = now;
          await manager.save(EmailVerificationCode, codeRecord);
        }
        return { kind: 'code_exhausted' as const };
      }

      const expected = Buffer.from(codeRecord.codeHash, 'hex');
      const actual = Buffer.from(
        this.verificationCodeHash(userId, dto.code),
        'hex',
      );
      const valid =
        expected.length === actual.length && timingSafeEqual(expected, actual);
      if (!valid) {
        codeRecord.failedAttempts += 1;
        if (codeRecord.failedAttempts >= 5) codeRecord.consumedAt = now;
        await manager.save(EmailVerificationCode, codeRecord);
        return codeRecord.failedAttempts >= 5
          ? { kind: 'code_exhausted' as const }
          : { kind: 'incorrect_code' as const };
      }

      user.emailVerifiedAt = now;
      codeRecord.consumedAt = now;
      await manager.save(EmailVerificationCode, codeRecord);
      await manager.save(User, user);
      return { kind: 'confirmed' as const, emailVerifiedAt: now };
    });

    switch (outcome.kind) {
      case 'already_verified':
      case 'confirmed':
        return {
          emailVerified: true,
          emailVerifiedAt: outcome.emailVerifiedAt,
        };
      case 'no_active_code':
        throw new BadRequestException('No active confirmation code.');
      case 'code_expired':
        throw new BadRequestException('This confirmation code has expired.');
      case 'code_exhausted':
        throw new BadRequestException(
          'Too many incorrect attempts. Request a new code.',
        );
      case 'incorrect_code':
        throw new BadRequestException('Incorrect confirmation code.');
    }
  }

  private async sendEmailVerificationEmail(
    email: string,
    code: string,
    expiresAt: Date,
  ) {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const from = this.config.get<string>('RESEND_FROM_EMAIL')?.trim();
    if (!apiKey || !from) throw new Error('email_delivery_not_configured');
    const resend = new Resend(apiKey);
    const minutes = Math.max(
      1,
      Math.ceil((expiresAt.getTime() - Date.now()) / 60000),
    );
    const message = buildBooOtpEmail({
      kind: 'email_confirmation',
      code,
      expiresInMinutes: minutes,
      supportEmail: this.config.get<string>('SUPPORT_EMAIL'),
    });
    const result = await resend.emails.send({
      from,
      to: email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (result.error) throw new Error('email_delivery_provider_error');
  }

  async becomeProvider(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.role !== 'owner') {
      throw new ForbiddenException('Only owner accounts can become providers');
    }
    await this.usersRepo.update(userId, { role: 'provider' });
    return this.me(userId);
  }

  private async sendPasswordResetEmail(
    email: string,
    code: string,
    expiresAt: Date,
  ) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('RESEND_FROM_EMAIL');
    if (!apiKey || !from) throw new Error('email_delivery_not_configured');
    const minutes = Math.max(
      1,
      Math.ceil((expiresAt.getTime() - Date.now()) / 60000),
    );
    const message = buildBooOtpEmail({
      kind: 'password_reset',
      code,
      expiresInMinutes: minutes,
      supportEmail: this.config.get<string>('SUPPORT_EMAIL'),
    });
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to: email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (result.error) throw new Error('email_delivery_provider_error');
  }
}
