import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import { User } from '../users/user.entity';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetToken } from './password-reset-token.entity';
import { StreamService } from '../stream/stream.service';
import { Provider } from '../providers/providers.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokensRepo: Repository<PasswordResetToken>,
    @InjectRepository(Provider)
    private readonly providersRepo: Repository<Provider>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly streamService: StreamService,
  ) {}

  private readonly forgotPasswordMessage = {
    message: 'If this email exists, a reset link has been sent',
  };
  private readonly forgotPasswordAttempts = new Map<string, number[]>();

  private issueTokens(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: (this.config.get<string>('JWT_EXPIRES_IN') ?? '15m') as any,
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: (this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ??
        '7d') as any,
    });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        full_name: user.fullName,
      },
    };
  }

  async register(dto: SignupDto) {
    const exists = await this.usersRepo.findOne({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.usersRepo.create({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      role: dto.role ?? 'owner',
    });
    await this.usersRepo.save(user);
    await this.streamService.upsertStreamUser(
      user.id,
      user.fullName,
      user.role,
    );
    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.isBanned) {
      throw new ForbiddenException(
        'Your account has been suspended. Please contact support@boo.co.ke',
      );
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const tokens = this.issueTokens(user);
    const streamToken = this.streamService.generateStreamToken(user.id);

    let isVerified: boolean | undefined;
    if (user.role === 'provider') {
      const profile = await this.providersRepo.findOne({ where: { userId: user.id } });
      isVerified = profile?.isVerified ?? false;
    }
    await this.streamService.upsertStreamUser(user.id, user.fullName, user.role, isVerified);

    return {
      ...tokens,
      stream_token: streamToken,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    if (!this.allowForgotPasswordAttempt(email)) {
      return this.forgotPasswordMessage;
    }

    const user = await this.usersRepo.findOne({ where: { email } });
    if (!user) return this.forgotPasswordMessage;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentRequests = await this.passwordResetTokensRepo.count({
      where: {
        userId: user.id,
        createdAt: MoreThan(oneHourAgo),
      },
    });
    if (recentRequests >= 3) return this.forgotPasswordMessage;

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await this.passwordResetTokensRepo.save(
      this.passwordResetTokensRepo.create({
        userId: user.id,
        token,
        expiresAt,
      }),
    );

    try {
      await this.sendPasswordResetEmail(user, token);
    } catch (error) {
      this.logger.warn(
        `Password reset email failed for user ${user.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    return this.forgotPasswordMessage;
  }

  async resetPassword(dto: ResetPasswordDto) {
    const resetToken = await this.passwordResetTokensRepo.findOne({
      where: { token: dto.token },
    });
    if (!resetToken) {
      throw new BadRequestException('Invalid or expired reset link');
    }
    if (resetToken.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'This reset link has expired. Please request a new one.',
      );
    }
    if (resetToken.usedAt !== null) {
      throw new BadRequestException('This reset link has already been used');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.usersRepo.update(resetToken.userId, { passwordHash });
    await this.passwordResetTokensRepo.update(resetToken.tokenId, {
      usedAt: new Date(),
    });

    return {
      message:
        'Password updated successfully. Please log in with your new password.',
    };
  }

  async refresh(token: string) {
    try {
      const payload = this.jwtService.verify<{ sub: string }>(token, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
      const user = await this.usersRepo.findOne({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException();
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
    return safe;
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

  async becomeProvider(userId: string) {
    await this.usersRepo.update(userId, { role: 'provider' });
    return this.me(userId);
  }

  private async sendPasswordResetEmail(user: User, token: string) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('RESEND_FROM_EMAIL');
    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    if (!apiKey || !from || !frontendUrl) {
      throw new BadRequestException('Password reset email is not configured');
    }

    const resetUrl = `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    const name = this.escapeHtml(user.fullName || 'there');
    const resend = new Resend(apiKey);

    const resendResult = await resend.emails.send({
      from,
      to: user.email,
      subject: 'Reset your Boo password',
      html: `
<div style="font-family: Arial, sans-serif; max-width: 500px;">
  <img src="${frontendUrl.replace(/\/$/, '')}/assets/assets/images/boo_logo.svg" width="80" alt="Boo"/>
  <h2>Reset your password</h2>
  <p>Hi ${name},</p>
  <p>We received a request to reset your Boo password. Click the button below to choose a new password:</p>
  <a href="${resetUrl}" style="background:#FF8C00; color:white; padding:12px 24px; border-radius:8px; text-decoration:none; display:inline-block;">
    Reset Password
  </a>
  <p>This link expires in 15 minutes.</p>
  <p>If you didn't request this, ignore this email.</p>
  <hr/>
  <small>Boo Pet Care Platform | support@boo.co.ke</small>
</div>`,
    });
    this.logger.log(`Resend result for ${user.email}: ${JSON.stringify(resendResult)}`);
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private allowForgotPasswordAttempt(email: string) {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const attempts = (this.forgotPasswordAttempts.get(email) ?? []).filter(
      (timestamp) => timestamp > oneHourAgo,
    );

    if (attempts.length >= 3) {
      this.forgotPasswordAttempts.set(email, attempts);
      return false;
    }

    attempts.push(now);
    this.forgotPasswordAttempts.set(email, attempts);
    return true;
  }
}
