import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, timingSafeEqual } from 'crypto';
import {
  DataSource,
  QueryFailedError,
  Repository,
  EntityManager,
} from 'typeorm';
import { User } from '../users/user.entity';
import { RevenueCatWebhookEvent } from './revenuecat-webhook-event.entity';
import { UserEntitlement } from './user-entitlement.entity';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITLEMENTS = new Set(['boo_plus', 'boo_pro']);
const EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
  'PRODUCT_CHANGE',
]);

type RevenueCatEvent = {
  id: string;
  type: string;
  app_user_id?: unknown;
  aliases?: unknown;
  entitlement_ids?: unknown;
  entitlement_id?: unknown;
  event_timestamp_ms?: unknown;
  expiration_at_ms?: unknown;
  product_id?: unknown;
  environment?: unknown;
  will_renew?: unknown;
};

@Injectable()
export class RevenueCatEntitlementsService {
  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(RevenueCatWebhookEvent)
    private readonly eventRepo: Repository<RevenueCatWebhookEvent>,
  ) {}

  async processWebhook(
    authorization: string | undefined,
    payload: unknown,
  ): Promise<{ accepted: true; category: string }> {
    this.assertAuthorization(authorization);
    const event = this.parseEvent(payload);
    const timestamp = new Date(event.event_timestamp_ms as number);
    const environment = this.stringValue(event.environment) ?? 'UNKNOWN';
    if (!EVENT_TYPES.has(event.type)) {
      return this.recordIgnoredEvent(event, timestamp, 'unsupported_event');
    }
    if (this.isTestEnvironment(environment) && !this.allowTestStore()) {
      return this.recordIgnoredEvent(event, timestamp, 'test_store_rejected');
    }

    const entitlementIds = this.entitlementIds(event);
    const knownEntitlement = entitlementIds.find((id) => ENTITLEMENTS.has(id));
    if (!knownEntitlement) {
      return this.recordIgnoredEvent(event, timestamp, 'unknown_entitlement');
    }

    const userId = await this.resolveUserId(event);
    if (!userId) {
      return this.recordIgnoredEvent(event, timestamp, 'unresolved_identity');
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const existing = await manager.findOne(RevenueCatWebhookEvent, {
          where: { eventId: event.id },
        });
        if (existing) {
          return { accepted: true, category: 'duplicate' };
        }
        const eventRecord = manager.create(RevenueCatWebhookEvent, {
          eventId: event.id,
          eventType: event.type,
          eventTimestamp: timestamp,
          status: 'received',
        });
        await manager.save(eventRecord);

        const user = await manager
          .getRepository(User)
          .createQueryBuilder('user')
          .where('user.id = :userId', { userId })
          .setLock('pessimistic_write')
          .getOne();
        if (!user) {
          eventRecord.status = 'unresolved_identity';
          await manager.save(eventRecord);
          return { accepted: true, category: 'unresolved_identity' };
        }

        let category = 'ignored';
        for (const entitlementId of entitlementIds.filter((id) =>
          ENTITLEMENTS.has(id),
        )) {
          if (!this.roleMatches(user.role, entitlementId)) {
            category = 'role_mismatch';
            continue;
          }
          const entitlement = await manager
            .getRepository(UserEntitlement)
            .createQueryBuilder('entitlement')
            .where('entitlement.user_id = :userId', { userId })
            .andWhere('entitlement.entitlement_id = :entitlementId', {
              entitlementId,
            })
            .setLock('pessimistic_write')
            .getOne();
          if (
            entitlement?.latestEventTimestamp &&
            entitlement.latestEventTimestamp >= timestamp
          ) {
            category = 'stale';
            continue;
          }
          const next =
            entitlement ??
            manager.create(UserEntitlement, {
              userId,
              entitlementId,
              productId: null,
              environment,
              activeUntil: null,
              willRenew: null,
              latestEventTimestamp: timestamp,
            });
          this.applyEvent(next, event, timestamp, environment);
          await manager.save(next);
          category = 'applied';
        }
        eventRecord.status = category;
        await manager.save(eventRecord);
        return { accepted: true, category };
      });
    } catch (error) {
      if (error instanceof QueryFailedError && this.isUniqueViolation(error)) {
        return { accepted: true, category: 'duplicate' };
      }
      throw error;
    }
  }

  async hasActiveEntitlement(
    manager: EntityManager,
    userId: string,
    entitlementId: string,
  ): Promise<boolean> {
    const row = await manager
      .getRepository(UserEntitlement)
      .createQueryBuilder('entitlement')
      .where('entitlement.user_id = :userId', { userId })
      .andWhere('entitlement.entitlement_id = :entitlementId', {
        entitlementId,
      })
      .andWhere('entitlement.active_until IS NOT NULL')
      .andWhere('entitlement.active_until > CURRENT_TIMESTAMP')
      .setLock('pessimistic_write')
      .getOne();
    return row != null;
  }

  private assertAuthorization(authorization: string | undefined): void {
    const configured = this.config
      .get<string>('REVENUECAT_WEBHOOK_AUTH_TOKEN')
      ?.trim();
    if (!configured || !authorization) throw new UnauthorizedException();
    const expected = Buffer.from(configured, 'utf8');
    const actual = Buffer.from(authorization, 'utf8');
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new UnauthorizedException();
    }
  }

  private parseEvent(payload: unknown): RevenueCatEvent {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Malformed RevenueCat webhook');
    }
    const root = payload as Record<string, unknown>;
    const raw = root.event;
    if (!raw || typeof raw !== 'object') {
      throw new BadRequestException('Malformed RevenueCat webhook');
    }
    const event = raw as Record<string, unknown>;
    const id = this.stringValue(event.id);
    const type = this.stringValue(event.type)?.toUpperCase();
    const timestampMs = this.numberValue(event.event_timestamp_ms);
    if (!id || !type || !timestampMs || timestampMs <= 0) {
      throw new BadRequestException('Malformed RevenueCat webhook');
    }
    if (!EVENT_TYPES.has(type)) {
      return {
        ...(event as RevenueCatEvent),
        id,
        type,
        event_timestamp_ms: timestampMs,
      };
    }
    return {
      ...(event as RevenueCatEvent),
      id,
      type,
      event_timestamp_ms: timestampMs,
    };
  }

  private async resolveUserId(event: RevenueCatEvent): Promise<string | null> {
    const candidates = [
      this.stringValue(event.app_user_id),
      ...(Array.isArray(event.aliases)
        ? event.aliases.map((alias) => this.stringValue(alias))
        : []),
    ].filter((value): value is string => !!value && UUID.test(value));
    for (const candidate of candidates) {
      const user = await this.userRepo.findOne({ where: { id: candidate } });
      if (user) return user.id;
    }
    return null;
  }

  private entitlementIds(event: RevenueCatEvent): string[] {
    const values = Array.isArray(event.entitlement_ids)
      ? event.entitlement_ids
      : [event.entitlement_id];
    return values
      .map((value) => this.stringValue(value)?.trim().toLowerCase())
      .filter((value): value is string => !!value);
  }

  private applyEvent(
    row: UserEntitlement,
    event: RevenueCatEvent,
    timestamp: Date,
    environment: string,
  ): void {
    row.latestEventTimestamp = timestamp;
    row.environment = environment;
    row.productId = this.stringValue(event.product_id) ?? row.productId;
    const type = event.type;
    if (type === 'INITIAL_PURCHASE' || type === 'RENEWAL') {
      row.activeUntil = this.expiration(event);
      row.willRenew = this.booleanValue(event.will_renew);
    } else if (type === 'UNCANCELLATION') {
      row.willRenew = true;
    } else if (type === 'CANCELLATION') {
      row.willRenew = false;
    } else if (type === 'EXPIRATION') {
      row.activeUntil = timestamp;
      row.willRenew = false;
    }
    // BILLING_ISSUE and PRODUCT_CHANGE intentionally preserve access and
    // expiration until RevenueCat sends the authoritative follow-up event.
  }

  private expiration(event: RevenueCatEvent): Date | null {
    const value = this.numberValue(event.expiration_at_ms);
    return value && value > 0 ? new Date(value) : null;
  }

  private async recordIgnoredEvent(
    event: RevenueCatEvent,
    timestamp: Date,
    category: string,
  ): Promise<{ accepted: true; category: string }> {
    try {
      await this.eventRepo.insert({
        eventId: event.id,
        eventType: event.type,
        eventTimestamp: timestamp,
        status: category,
      });
    } catch (error) {
      if (
        !(error instanceof QueryFailedError && this.isUniqueViolation(error))
      ) {
        throw error;
      }
    }
    return { accepted: true, category };
  }

  private roleMatches(role: string, entitlementId: string): boolean {
    return (
      (entitlementId === 'boo_plus' && role === 'owner') ||
      (entitlementId === 'boo_pro' && role === 'provider')
    );
  }

  private isTestEnvironment(environment: string): boolean {
    return /sandbox|test/i.test(environment);
  }

  private allowTestStore(): boolean {
    return (
      this.config.get<string>('REVENUECAT_ALLOW_TEST_STORE')?.toLowerCase() ===
      'true'
    );
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  private booleanValue(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  private isUniqueViolation(error: QueryFailedError): boolean {
    return (error.driverError as { code?: string })?.code === '23505';
  }
}
