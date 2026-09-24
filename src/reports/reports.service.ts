import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AdminAuditLog } from '../admin/admin-audit-log.entity';
import { Booking } from '../bookings/bookings.entity';
import { Provider } from '../providers/providers.entity';
import { StreamService } from '../stream/stream.service';
import { User } from '../users/user.entity';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsDto } from './dto/list-reports.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { Report, ReportReason, ReportStatus } from './report.entity';

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Provider)
    private readonly providers: Repository<Provider>,
    @InjectRepository(Booking)
    private readonly bookings: Repository<Booking>,
    @InjectRepository(AdminAuditLog)
    private readonly audit: Repository<AdminAuditLog>,
    private readonly dataSource: DataSource,
    private readonly stream: StreamService,
  ) {}

  async create(reporterUserId: string, dto: CreateReportDto) {
    const description = dto.description;
    if (description !== undefined && !description.trim()) {
      throw new BadRequestException('Description cannot be blank');
    }
    if (dto.reason === ReportReason.OTHER && !description?.trim()) {
      throw new BadRequestException(
        'A description is required when the reason is other',
      );
    }
    if (
      (dto.streamChannelType && !dto.streamChannelId) ||
      (!dto.streamChannelType && dto.streamChannelId)
    ) {
      throw new BadRequestException(
        'Stream channel type and ID must be provided together',
      );
    }
    if (!dto.providerProfileId && !dto.bookingId && !dto.streamChannelId) {
      throw new BadRequestException('A report context is required');
    }

    const reporter = await this.users.findOne({
      where: { id: reporterUserId },
    });
    if (!reporter || !['owner', 'provider'].includes(reporter.role)) {
      throw new ForbiddenException(
        'Only owners and providers can submit reports',
      );
    }

    let reportedUserId: string | null = null;
    let providerProfileId = dto.providerProfileId ?? null;
    let bookingId = dto.bookingId ?? null;
    let streamChannelType = dto.streamChannelType ?? null;
    let streamChannelId = dto.streamChannelId ?? null;

    if (
      providerProfileId &&
      !dto.bookingId &&
      !dto.streamChannelId &&
      reporter.role !== 'owner'
    ) {
      throw new ForbiddenException(
        'Providers must report another participant through a booking or conversation',
      );
    }

    if (providerProfileId) {
      const provider = await this.providers.findOne({
        where: { id: providerProfileId },
      });
      if (!provider) throw new NotFoundException('Provider profile not found');
      const target = await this.users.findOne({
        where: { id: provider.userId },
      });
      if (!target || target.role !== 'provider') {
        throw new NotFoundException('Provider user not found');
      }
      reportedUserId = target.id;
    }

    if (bookingId) {
      const booking = await this.bookings.findOne({
        where: { bookingId },
        relations: ['provider'],
      });
      if (!booking) throw new NotFoundException('Booking not found');
      let bookingTarget: string;
      if (booking.ownerId === reporterUserId) {
        bookingTarget = booking.provider.userId;
      } else if (booking.provider?.userId === reporterUserId) {
        bookingTarget = booking.ownerId;
      } else {
        throw new ForbiddenException('You cannot report this booking');
      }
      if (providerProfileId && providerProfileId !== booking.providerId) {
        throw new BadRequestException(
          'Report contexts identify different providers',
        );
      }
      providerProfileId = providerProfileId ?? booking.providerId;
      reportedUserId = this.mergeTarget(reportedUserId, bookingTarget);
    }

    if (streamChannelId) {
      if (streamChannelType !== 'messaging') {
        throw new BadRequestException(
          'Only messaging channels can be reported',
        );
      }
      const channel = await this.stream.getChannelParticipantData(
        streamChannelType,
        streamChannelId,
      );
      if (!channel || channel.memberIds.length !== 2) {
        throw new NotFoundException('Conversation not found');
      }
      if (!channel.memberIds.includes(reporterUserId)) {
        throw new ForbiddenException(
          'You are not a member of this conversation',
        );
      }
      const members = await this.users.findBy({ id: In(channel.memberIds) });
      if (members.length !== 2)
        throw new NotFoundException('Conversation not found');
      const other = members.find((member) => member.id !== reporterUserId);
      if (!other || !['owner', 'provider'].includes(other.role)) {
        throw new BadRequestException(
          'Conversation is not an owner-provider channel',
        );
      }
      const provider =
        members.find((member) => member.role === 'provider') ?? null;
      const owner = members.find((member) => member.role === 'owner') ?? null;
      if (!provider || !owner || provider.id === owner.id) {
        throw new BadRequestException(
          'Conversation is not an owner-provider channel',
        );
      }
      if (
        !(await this.stream.isAuthorizedOwnerProviderChannel(
          streamChannelType,
          streamChannelId,
          owner.id,
          provider.id,
        ))
      ) {
        throw new BadRequestException('Conversation reference is invalid');
      }
      const channelProvider = await this.providers.findOne({
        where: { userId: provider.id },
      });
      if (!channelProvider)
        throw new NotFoundException('Provider profile not found');
      if (providerProfileId && providerProfileId !== channelProvider.id) {
        throw new BadRequestException(
          'Report contexts identify different providers',
        );
      }
      providerProfileId = providerProfileId ?? channelProvider.id;
      reportedUserId = this.mergeTarget(reportedUserId, other.id);
    }

    if (!reportedUserId || reportedUserId === reporterUserId) {
      throw new BadRequestException('A valid other participant is required');
    }

    const fingerprint = [
      reporterUserId,
      reportedUserId,
      dto.reason,
      providerProfileId ?? 'null',
      bookingId ?? 'null',
      streamChannelType ?? 'null',
      streamChannelId ?? 'null',
    ].join('|');

    return this.dataSource.transaction(async (manager) => {
      // A transaction-scoped advisory lock serializes only identical report
      // fingerprints while avoiding a long-lived lock on the user row.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        fingerprint,
      ]);

      const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
      const duplicateQuery = manager
        .getRepository(Report)
        .createQueryBuilder('report')
        .where('report.reporter_user_id = :reporterUserId', { reporterUserId })
        .andWhere('report.reported_user_id = :reportedUserId', {
          reportedUserId,
        })
        .andWhere('report.reason = :reason', { reason: dto.reason })
        .andWhere('report.status IN (:...statuses)', {
          statuses: [ReportStatus.SUBMITTED, ReportStatus.REVIEWING],
        })
        .andWhere('report.created_at >= :since', { since })
        .andWhere(
          providerProfileId
            ? 'report.provider_profile_id = :providerProfileId'
            : 'report.provider_profile_id IS NULL',
          providerProfileId ? { providerProfileId } : {},
        )
        .andWhere(
          bookingId
            ? 'report.booking_id = :bookingId'
            : 'report.booking_id IS NULL',
          bookingId ? { bookingId } : {},
        );
      if (streamChannelId) {
        duplicateQuery.andWhere('report.stream_channel_id = :streamChannelId', {
          streamChannelId,
        });
      } else {
        duplicateQuery.andWhere('report.stream_channel_id IS NULL');
      }
      if (streamChannelType) {
        duplicateQuery.andWhere(
          'report.stream_channel_type = :streamChannelType',
          { streamChannelType },
        );
      } else {
        duplicateQuery.andWhere('report.stream_channel_type IS NULL');
      }
      if (await duplicateQuery.getOne()) {
        throw new ConflictException('A similar report was recently submitted');
      }

      const report = manager.create(Report, {
        reporterUserId,
        reportedUserId,
        providerProfileId,
        bookingId,
        streamChannelType,
        streamChannelId,
        reason: dto.reason,
        description: description ?? null,
        status: ReportStatus.SUBMITTED,
        assignedAdminId: null,
        resolutionNotes: null,
        resolvedAt: null,
      });
      const saved = await manager.save(Report, report);
      return this.publicReport(saved);
    });
  }

  async mine(userId: string, dto: ListReportsDto) {
    const [rows, total] = await this.reports.findAndCount({
      where: {
        reporterUserId: userId,
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.reason ? { reason: dto.reason } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: (dto.page - 1) * dto.limit,
      take: dto.limit,
    });
    return {
      data: rows.map((report) => this.publicReport(report)),
      page: dto.page,
      limit: dto.limit,
      total,
    };
  }

  async adminList(dto: ListReportsDto) {
    const where = {
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.reason ? { reason: dto.reason } : {}),
    };
    const [rows, total] = await this.reports.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (dto.page - 1) * dto.limit,
      take: dto.limit,
    });
    return {
      data: rows.map((report) => this.adminReport(report)),
      page: dto.page,
      limit: dto.limit,
      total,
    };
  }

  async adminGet(reportId: string) {
    const report = await this.reports.findOne({ where: { reportId } });
    if (!report) throw new NotFoundException('Report not found');
    return this.adminModerationReport(report);
  }

  async adminConversationContext(reportId: string) {
    const report = await this.reports.findOne({ where: { reportId } });
    if (!report) throw new NotFoundException('Report not found');
    if (!report.streamChannelType || !report.streamChannelId) {
      throw new BadRequestException('This report has no conversation context');
    }
    if (report.streamChannelType !== 'messaging') {
      throw new BadRequestException('Unsupported conversation context');
    }

    const channel = await this.stream.getChannelParticipantData(
      report.streamChannelType,
      report.streamChannelId,
    );
    if (!channel || channel.memberIds.length !== 2) {
      throw new NotFoundException('Conversation evidence is unavailable');
    }
    const members = await this.users.findBy({ id: In(channel.memberIds) });
    if (members.length !== 2) {
      throw new NotFoundException('Conversation evidence is unavailable');
    }
    const owner = members.find((member) => member.role === 'owner');
    const provider = members.find((member) => member.role === 'provider');
    if (!owner || !provider) {
      throw new NotFoundException('Conversation evidence is unavailable');
    }
    if (
      !(await this.stream.isAuthorizedOwnerProviderChannel(
        report.streamChannelType,
        report.streamChannelId,
        owner.id,
        provider.id,
      ))
    ) {
      throw new NotFoundException('Conversation evidence is unavailable');
    }

    let messages: Array<Record<string, unknown>>;
    try {
      messages = await this.stream.getChannelMessages(
        report.streamChannelType,
        report.streamChannelId,
        report.createdAt,
      );
    } catch {
      throw new NotFoundException('Conversation evidence is unavailable');
    }
    const safeMembers = new Map(
      members.map((member) => [
        member.id,
        {
          id: member.id,
          displayName: member.fullName ?? 'Boo user',
          role: member.role,
        },
      ]),
    );
    return {
      channelType: report.streamChannelType,
      channelId: report.streamChannelId,
      messages: messages.slice(0, 50).map((message) => {
        const sender = (message.user ?? {}) as Record<string, unknown>;
        const senderId = sender.id?.toString() ?? '';
        return {
          id: message.id?.toString() ?? '',
          sender: safeMembers.get(senderId) ?? {
            id: senderId,
            displayName: 'Boo user',
            role: 'user',
          },
          text: message.text?.toString() ?? '',
          createdAt: message.created_at ?? null,
        };
      }),
    };
  }

  private async adminModerationReport(report: Report) {
    const [reporter, reported] = await this.users.findBy({
      id: In([report.reporterUserId, report.reportedUserId]),
    });
    const reporterUser = [reporter, reported].find(
      (user) => user?.id === report.reporterUserId,
    );
    const reportedUser = [reporter, reported].find(
      (user) => user?.id === report.reportedUserId,
    );
    if (!reporterUser || !reportedUser)
      throw new NotFoundException('Report users not found');

    const provider = report.providerProfileId
      ? await this.providers.findOne({
          where: { id: report.providerProfileId },
        })
      : null;
    const booking = report.bookingId
      ? await this.bookings.findOne({
          where: { bookingId: report.bookingId },
          relations: ['owner', 'provider', 'service'],
        })
      : null;
    const assignedAdmin = report.assignedAdminId
      ? await this.users.findOne({
          where: { id: report.assignedAdminId, role: 'admin' },
        })
      : null;

    const reportCounts = await this.reports
      .createQueryBuilder('history')
      .select('history.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('history.reported_user_id = :reportedUserId', {
        reportedUserId: reportedUser.id,
      })
      .groupBy('history.status')
      .getRawMany<{ status: ReportStatus; count: string }>();
    const moderationRows = await this.audit
      .createQueryBuilder('log')
      .select(['log.action AS action', 'log.performed_at AS performed_at'])
      .where('log.target_type = :targetType', { targetType: 'user' })
      .andWhere('log.target_id = :targetId', { targetId: reportedUser.id })
      .andWhere('log.action IN (:...actions)', {
        actions: ['user_warned', 'user_banned', 'user_unbanned'],
      })
      .orderBy('log.performed_at', 'DESC')
      .limit(20)
      .getRawMany<{ action: string; performed_at: Date }>();

    return {
      ...this.adminReport(report),
      reporter: this.safeAdminUser(reporterUser),
      reportedAccount: this.safeAdminUser(reportedUser),
      assignedAdmin: assignedAdmin ? this.safeAdminUser(assignedAdmin) : null,
      provider: provider
        ? {
            profileId: provider.id,
            businessName: provider.businessName,
            verificationStatus: provider.verificationStatus,
            serviceCategories: (provider.services ?? [])
              .filter((service) => service.isActive)
              .map((service) => service.category),
          }
        : null,
      booking: booking
        ? {
            bookingId: booking.bookingId,
            status: booking.status,
            bookingDatetime: booking.bookingDatetime,
            serviceName: booking.service?.serviceName ?? null,
            serviceCategory: booking.service?.category ?? null,
            ownerName: booking.owner?.fullName ?? 'Boo owner',
            providerName: booking.provider?.businessName ?? 'Boo provider',
          }
        : null,
      history: {
        previousReports: Object.fromEntries(
          reportCounts.map((row) => [row.status, Number(row.count)]),
        ),
        moderationActions: moderationRows.map((row) => ({
          action: row.action,
          performedAt: row.performed_at,
        })),
      },
    };
  }

  private safeAdminUser(user: User) {
    return {
      id: user.id,
      displayName: user.fullName ?? 'Boo user',
      role: user.role,
      isBanned: user.isBanned,
    };
  }

  async updateStatus(
    reportId: string,
    adminId: string,
    dto: UpdateReportStatusDto,
  ) {
    if (!dto.status && !dto.assignedAdminId) {
      throw new BadRequestException('A status or assignee change is required');
    }
    return this.dataSource.transaction(async (manager) => {
      const report = await manager.findOne(Report, {
        where: { reportId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!report) throw new NotFoundException('Report not found');
      if (
        report.status === ReportStatus.RESOLVED ||
        report.status === ReportStatus.DISMISSED
      ) {
        throw new ConflictException('This report is already closed');
      }

      if (dto.assignedAdminId) {
        const assignee = await manager.findOne(User, {
          where: { id: dto.assignedAdminId },
        });
        if (!assignee || assignee.role !== 'admin') {
          throw new BadRequestException(
            'assignedAdminId must identify an admin',
          );
        }
        report.assignedAdminId = assignee.id;
      }

      if (dto.status) {
        const allowed =
          (report.status === ReportStatus.SUBMITTED &&
            [ReportStatus.REVIEWING, ReportStatus.DISMISSED].includes(
              dto.status,
            )) ||
          (report.status === ReportStatus.REVIEWING &&
            [ReportStatus.RESOLVED, ReportStatus.DISMISSED].includes(
              dto.status,
            ));
        if (!allowed)
          throw new BadRequestException('Invalid report status transition');
        if (
          [ReportStatus.RESOLVED, ReportStatus.DISMISSED].includes(
            dto.status,
          ) &&
          !dto.resolutionNotes?.trim()
        ) {
          throw new BadRequestException(
            'Resolution notes are required when closing a report',
          );
        }
        report.status = dto.status;
        if (
          [ReportStatus.RESOLVED, ReportStatus.DISMISSED].includes(dto.status)
        ) {
          report.resolutionNotes = dto.resolutionNotes!.trim();
          report.resolvedAt = new Date();
        }
      } else if (dto.resolutionNotes !== undefined) {
        throw new BadRequestException(
          'Resolution notes require a terminal status',
        );
      }

      const saved = await manager.save(Report, report);
      await manager.save(
        AdminAuditLog,
        manager.create(AdminAuditLog, {
          adminId,
          action: 'report_status_updated',
          targetType: 'report',
          targetId: saved.reportId,
          details: {
            status: saved.status,
            assigned_admin_id: saved.assignedAdminId,
          },
        }),
      );
      return this.adminReport(saved);
    });
  }

  private mergeTarget(current: string | null, next: string): string {
    if (current && current !== next) {
      throw new BadRequestException('Report contexts identify different users');
    }
    return next;
  }

  private publicReport(report: Report) {
    return {
      reportId: report.reportId,
      providerProfileId: report.providerProfileId,
      bookingId: report.bookingId,
      streamChannelType: report.streamChannelType,
      streamChannelId: report.streamChannelId,
      reason: report.reason,
      status: report.status,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }

  private adminReport(report: Report) {
    return {
      reportId: report.reportId,
      reporterUserId: report.reporterUserId,
      reportedUserId: report.reportedUserId,
      providerProfileId: report.providerProfileId,
      bookingId: report.bookingId,
      streamChannelType: report.streamChannelType,
      streamChannelId: report.streamChannelId,
      reason: report.reason,
      description: report.description,
      status: report.status,
      assignedAdminId: report.assignedAdminId,
      resolutionNotes: report.resolutionNotes,
      resolvedAt: report.resolvedAt,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }
}
