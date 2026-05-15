import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, BookingStatus } from '../bookings/bookings.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Provider, VerificationStatus } from '../providers/providers.entity';
import { ServiceOffering } from '../providers/service-offering.entity';
import { Review } from '../reviews/review.entity';
import { User, UserRole } from '../users/user.entity';
import {
  VerificationDocument,
  VerificationDocumentStatus,
} from '../verification/verification-document.entity';
import { AdminAuditLog } from './admin-audit-log.entity';
import { ReviewVerificationDto } from './dto/review-verification.dto';
import { UpdateUserBanDto } from './dto/update-user-ban.dto';

type BookingReportStatus = BookingStatus | 'all';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(VerificationDocument)
    private readonly documentsRepo: Repository<VerificationDocument>,
    @InjectRepository(Provider)
    private readonly providersRepo: Repository<Provider>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Booking)
    private readonly bookingsRepo: Repository<Booking>,
    @InjectRepository(ServiceOffering)
    private readonly servicesRepo: Repository<ServiceOffering>,
    @InjectRepository(Review)
    private readonly reviewsRepo: Repository<Review>,
    @InjectRepository(AdminAuditLog)
    private readonly auditRepo: Repository<AdminAuditLog>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async logAdminAction(
    adminId: string,
    action: string,
    targetType?: string,
    targetId?: string,
    details?: Record<string, unknown>,
  ) {
    const entry = this.auditRepo.create({
      adminId,
      action,
      targetType: targetType ?? null,
      targetId: targetId ?? null,
      details: details ?? null,
    });
    return this.auditRepo.save(entry);
  }

  async getAuditLog() {
    const rows = await this.auditRepo
      .createQueryBuilder('log')
      .leftJoin(User, 'admin', 'admin.id = log.admin_id')
      .select([
        'log.log_id AS log_id',
        'log.action AS action',
        'log.target_type AS target_type',
        'log.target_id AS target_id',
        'log.details AS details',
        'log.performed_at AS performed_at',
        'admin.full_name AS admin_name',
      ])
      .orderBy('log.performed_at', 'DESC')
      .limit(50)
      .getRawMany();

    return rows.map((row) => ({
      log_id: row.log_id,
      admin_name: row.admin_name ?? 'Admin',
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      details: row.details,
      performed_at: row.performed_at,
    }));
  }

  async getVerificationQueue(
    status:
      | VerificationDocumentStatus
      | 'all' = VerificationDocumentStatus.PENDING,
    search?: string,
  ) {
    const qb = this.documentsRepo
      .createQueryBuilder('doc')
      .innerJoin(Provider, 'provider', 'provider.profile_id = doc.profile_id')
      .innerJoin(User, 'user', 'user.id = provider.user_id')
      .orderBy('doc.uploaded_at', 'DESC')
      .select([
        'doc.doc_id AS doc_id',
        'doc.document_type AS document_type',
        'doc.file_url AS file_url',
        'doc.status AS status',
        'doc.uploaded_at AS uploaded_at',
        'doc.admin_notes AS admin_notes',
        'provider.profile_id AS provider_profile_id',
        'provider.business_name AS provider_business_name',
        'provider.verification_status AS provider_verification_status',
        'user.full_name AS user_full_name',
        'user.email AS user_email',
      ]);
    if (status !== 'all') {
      qb.where('doc.status = :status', { status });
    }
    if (search?.trim()) {
      const trimmed = `%${search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(provider.business_name) LIKE :search OR LOWER(user.full_name) LIKE :search OR LOWER(user.email) LIKE :search)',
        { search: trimmed },
      );
    }

    const rows = await qb.getRawMany();

    const grouped = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const providerId = row.provider_profile_id;
      if (!grouped.has(providerId)) {
        grouped.set(providerId, {
          provider: {
            profile_id: providerId,
            business_name: row.provider_business_name,
            verification_status: row.provider_verification_status,
            user: {
              full_name: row.user_full_name,
              email: row.user_email,
            },
          },
          latest_uploaded_at: row.uploaded_at,
          documents: [],
        });
      }

      const item = grouped.get(providerId)!;
      const documents = item.documents as Record<string, unknown>[];
      documents.push({
        doc_id: row.doc_id,
        document_type: row.document_type,
        file_url: row.file_url,
        status: row.status,
        uploaded_at: row.uploaded_at,
        admin_notes: row.admin_notes,
      });

      const latest = new Date(item.latest_uploaded_at as string);
      const uploaded = new Date(row.uploaded_at);
      if (uploaded > latest) item.latest_uploaded_at = row.uploaded_at;
    }

    return [...grouped.values()];
  }

  async reviewVerificationDocument(
    docId: string,
    adminId: string,
    dto: ReviewVerificationDto,
  ) {
    const document = await this.documentsRepo.findOne({ where: { docId } });
    if (!document)
      throw new NotFoundException('Verification document not found');

    document.status = dto.decision as VerificationDocumentStatus;
    if (dto.adminNotes !== undefined) document.adminNotes = dto.adminNotes;
    document.reviewedBy = adminId;
    document.reviewedAt = new Date();
    const saved = await this.documentsRepo.save(document);

    const providerDocs = await this.documentsRepo.find({
      where: { profileId: document.profileId },
    });
    const anyRejected = providerDocs.some(
      (doc) => doc.status === VerificationDocumentStatus.REJECTED,
    );
    const allApproved =
      providerDocs.length > 0 &&
      providerDocs.every(
        (doc) => doc.status === VerificationDocumentStatus.APPROVED,
      );

    const provider = await this.providersRepo.findOne({
      where: { id: document.profileId },
    });
    if (!provider) throw new NotFoundException('Provider profile not found');

    if (anyRejected) {
      await this.providersRepo.update(provider.id, {
        verificationStatus: VerificationStatus.REJECTED,
        isVerified: false,
      });
      await this.notificationsService.createNotification(
        provider.userId,
        'verification_rejected',
        'Verification unsuccessful',
        `Your documents were not approved. Reason: ${
          dto.adminNotes ?? 'No reason provided'
        }. Please resubmit with correct documents.`,
        saved.docId,
      );
    } else if (allApproved) {
      await this.providersRepo.update(provider.id, {
        verificationStatus: VerificationStatus.APPROVED,
        isVerified: true,
      });
      await this.notificationsService.createNotification(
        provider.userId,
        'verification_approved',
        'Your account is verified ✓',
        'Congratulations! You now have the Boo Verified badge. Clients will see you first in search results.',
        saved.docId,
      );
    }

    await this.logAdminAction(
      adminId,
      `verification_${dto.decision}`,
      'verification_document',
      saved.docId,
      {
        profile_id: provider.id,
        business_name: provider.businessName,
        admin_notes: dto.adminNotes ?? null,
      },
    );

    return saved;
  }

  async getUsers(role?: UserRole, isBanned?: string) {
    const qb = this.usersRepo
      .createQueryBuilder('user')
      .leftJoin(Provider, 'provider', 'provider.user_id = user.id')
      .select([
        'user.id AS id',
        'user.full_name AS full_name',
        'user.email AS email',
        'user.role AS role',
        'user.is_banned AS is_banned',
        'user.created_at AS created_at',
        'provider.verification_status AS verification_status',
      ])
      .orderBy('user.created_at', 'DESC');

    if (role) qb.andWhere('user.role = :role', { role });
    if (isBanned === 'true' || isBanned === 'false') {
      qb.andWhere('user.is_banned = :isBanned', {
        isBanned: isBanned === 'true',
      });
    }

    const rows = await qb.getRawMany();
    return rows.map((row) => ({
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      role: row.role,
      is_banned: row.is_banned,
      created_at: row.created_at,
      ...(row.role === 'provider'
        ? { verification_status: row.verification_status }
        : {}),
    }));
  }

  async updateUserBanStatus(
    userId: string,
    adminId: string,
    dto: UpdateUserBanDto,
  ) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'admin')
      throw new ForbiddenException('Cannot ban another admin');

    await this.usersRepo.update(user.id, { isBanned: dto.isBanned });
    if (dto.isBanned) {
      await this.notificationsService.createNotification(
        user.id,
        'system',
        'Account suspended',
        'Your Boo account has been suspended due to policy violations. Contact support@boo.co.ke for assistance.',
      );
    } else {
      await this.notificationsService.createNotification(
        user.id,
        'system',
        'Account Reinstated',
        'Your Boo account has been reinstated. You can now log in and use the platform again.',
      );
    }

    await this.logAdminAction(
      adminId,
      dto.isBanned ? 'user_banned' : 'user_unbanned',
      'user',
      user.id,
      {
        full_name: user.fullName,
        email: user.email,
        role: user.role,
      },
    );

    return {
      id: user.id,
      full_name: user.fullName,
      email: user.email,
      role: user.role,
      is_banned: dto.isBanned,
      created_at: user.createdAt,
      success: true,
      message: dto.isBanned
        ? 'User banned successfully'
        : 'User unbanned successfully',
    };
  }

  async warnUser(userId: string, adminId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'admin')
      throw new ForbiddenException('Cannot warn another admin');

    await this.notificationsService.createNotification(
      user.id,
      'system',
      'Account warning',
      'Warning: Your account has been flagged for excessive cancellations. Further violations may result in suspension.',
    );

    await this.logAdminAction(adminId, 'user_warned', 'user', user.id, {
      full_name: user.fullName,
      email: user.email,
      role: user.role,
      reason: 'excessive_cancellations',
    });

    return {
      id: user.id,
      full_name: user.fullName,
      email: user.email,
      role: user.role,
      warned: true,
    };
  }

  async getUserBookingHistory(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const bookings = await this.bookingsRepo
      .createQueryBuilder('booking')
      .innerJoin('booking.owner', 'owner')
      .innerJoin('booking.provider', 'provider')
      .innerJoin('booking.service', 'service')
      .where('owner.id = :userId', { userId })
      .select([
        'booking.bookingId',
        'booking.status',
        'booking.bookingDatetime',
        'booking.createdAt',
        'booking.declineReason',
        'provider.businessName',
        'service.serviceName',
        'service.price',
        'service.category',
      ])
      .orderBy('booking.createdAt', 'DESC')
      .limit(50)
      .getMany();

    return bookings.map((booking) => ({
      booking_id: booking.bookingId,
      status: booking.status,
      booking_datetime: booking.bookingDatetime,
      created_at: booking.createdAt,
      decline_reason: booking.declineReason,
      provider: { business_name: booking.provider.businessName },
      service: {
        service_name: booking.service.serviceName,
        price: booking.service.price,
        category: booking.service.category,
      },
    }));
  }

  async getStats() {
    const [
      totalUsers,
      owners,
      providers,
      admins,
      banned,
      totalBookings,
      pendingBookings,
      acceptedBookings,
      completedBookings,
      cancelledBookings,
      declinedBookings,
      pendingVerification,
      approvedVerification,
      rejectedVerification,
      totalVerification,
      totalReviews,
      totalServices,
      activeServices,
    ] = await Promise.all([
      this.usersRepo.count(),
      this.usersRepo.count({ where: { role: 'owner' } }),
      this.usersRepo.count({ where: { role: 'provider' } }),
      this.usersRepo.count({ where: { role: 'admin' } }),
      this.usersRepo.count({ where: { isBanned: true } }),
      this.bookingsRepo.count(),
      this.bookingsRepo.count({ where: { status: BookingStatus.PENDING } }),
      this.bookingsRepo.count({ where: { status: BookingStatus.ACCEPTED } }),
      this.bookingsRepo.count({ where: { status: BookingStatus.COMPLETED } }),
      this.bookingsRepo.count({ where: { status: BookingStatus.CANCELLED } }),
      this.bookingsRepo.count({ where: { status: BookingStatus.DECLINED } }),
      this.documentsRepo.count({
        where: { status: VerificationDocumentStatus.PENDING },
      }),
      this.documentsRepo.count({
        where: { status: VerificationDocumentStatus.APPROVED },
      }),
      this.documentsRepo.count({
        where: { status: VerificationDocumentStatus.REJECTED },
      }),
      this.documentsRepo.count(),
      this.reviewsRepo.count(),
      this.servicesRepo.count(),
      this.servicesRepo.count({ where: { isActive: true } }),
    ]);

    const avgResult = await this.reviewsRepo
      .createQueryBuilder('review')
      .select('COALESCE(AVG(review.rating), 0)', 'average')
      .getRawOne();

    const flaggedResult = await this.bookingsRepo.query(`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT owner_id
        FROM bookings
        WHERE status = 'cancelled'
        GROUP BY owner_id
        HAVING COUNT(*) >= 3
      ) flagged
    `);

    return {
      users: {
        total: totalUsers,
        owners,
        providers,
        admins,
        banned,
      },
      bookings: {
        total: totalBookings,
        pending: pendingBookings,
        accepted: acceptedBookings,
        completed: completedBookings,
        cancelled: cancelledBookings,
        declined: declinedBookings,
      },
      verification: {
        pending: pendingVerification,
        approved: approvedVerification,
        rejected: rejectedVerification,
        total: totalVerification,
      },
      reviews: {
        total: totalReviews,
        averageRating: Number(avgResult?.average ?? 0),
      },
      services: {
        total: totalServices,
        active: activeServices,
      },
      flaggedUsers: Number(flaggedResult?.[0]?.count ?? 0),
    };
  }

  async getBookings(status: BookingReportStatus = 'all', page = 1, limit = 20) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const qb = this.bookingsRepo
      .createQueryBuilder('booking')
      .innerJoin('booking.owner', 'owner')
      .innerJoin('booking.provider', 'provider')
      .innerJoin('booking.service', 'service')
      .select([
        'booking.bookingId',
        'booking.status',
        'booking.bookingDatetime',
        'booking.createdAt',
        'booking.declineReason',
        'owner.id',
        'owner.fullName',
        'provider.id',
        'provider.businessName',
        'service.serviceId',
        'service.serviceName',
        'service.price',
        'service.durationMinutes',
        'service.pricingUnit',
      ])
      .orderBy('booking.createdAt', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit);

    if (status !== 'all') qb.where('booking.status = :status', { status });

    const [bookings, total] = await qb.getManyAndCount();
    return {
      page: safePage,
      limit: safeLimit,
      total,
      data: bookings.map((booking) => ({
        booking_id: booking.bookingId,
        status: booking.status,
        booking_datetime: booking.bookingDatetime,
        created_at: booking.createdAt,
        decline_reason: booking.declineReason,
        owner: { full_name: booking.owner.fullName },
        provider: { business_name: booking.provider.businessName },
        service: {
          service_name: booking.service.serviceName,
          price: booking.service.price,
          duration_minutes: booking.service.durationMinutes,
          pricing_unit: booking.service.pricingUnit,
        },
      })),
    };
  }

  async getServices(category?: string, isActive?: string) {
    const qb = this.servicesRepo
      .createQueryBuilder('service')
      .innerJoin('service.provider', 'provider')
      .select([
        'service.serviceId',
        'service.serviceName',
        'service.category',
        'service.price',
        'service.durationMinutes',
        'service.pricingUnit',
        'service.isActive',
        'provider.id',
        'provider.businessName',
        'provider.isVerified',
      ])
      .orderBy('service.createdAt', 'DESC');

    if (category) qb.andWhere('service.category = :category', { category });
    if (isActive === 'true' || isActive === 'false') {
      qb.andWhere('service.isActive = :isActive', {
        isActive: isActive === 'true',
      });
    }

    const services = await qb.getMany();
    return services.map((service) => ({
      service_id: service.serviceId,
      service_name: service.serviceName,
      category: service.category,
      price: service.price,
      duration_minutes: service.durationMinutes,
      pricing_unit: service.pricingUnit,
      is_active: service.isActive,
      provider: {
        business_name: service.provider.businessName,
        is_verified: service.provider.isVerified,
      },
    }));
  }

  async getFlaggedUsers() {
    return this.bookingsRepo.query(`
      SELECT 
        bookings.owner_id,
        COUNT(*)::int AS cancel_count,
        users.full_name,
        users.email
      FROM bookings
      JOIN users ON bookings.owner_id = users.id
      WHERE bookings.status = 'cancelled'
      GROUP BY bookings.owner_id, users.full_name, users.email
      HAVING COUNT(*) >= 3
      ORDER BY cancel_count DESC
    `);
  }

  async getProviderPerformanceReport(query: {
    isVerified?: string;
    category?: string;
    minRating?: string;
    sortBy?: 'rating' | 'bookings' | 'reviews';
  }) {
    const minRating = Number(query.minRating ?? 0);
    const sortMap = {
      rating: 'p.average_rating DESC',
      bookings: 'total_bookings DESC',
      reviews: 'p.total_reviews DESC',
    };
    const params: unknown[] = [Number.isFinite(minRating) ? minRating : 0];
    const filters = ['p.average_rating >= $1'];
    if (query.isVerified === 'true' || query.isVerified === 'false') {
      params.push(query.isVerified === 'true');
      filters.push(`p.is_verified = $${params.length}`);
    }
    if (query.category) {
      params.push(query.category);
      filters.push(`svc_category.category = $${params.length}`);
    }

    const rows = await this.providersRepo.query(
      `
      WITH service_counts AS (
        SELECT profile_id, category, COUNT(*) AS service_count
        FROM services
        GROUP BY profile_id, category
      ),
      svc_category AS (
        SELECT DISTINCT ON (profile_id)
          profile_id,
          category
        FROM service_counts
        ORDER BY profile_id, service_count DESC, category ASC
      ),
      booking_counts AS (
        SELECT
          provider_id,
          COUNT(*)::int AS total_bookings,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_bookings
        FROM bookings
        GROUP BY provider_id
      )
      SELECT
        p.profile_id,
        p.business_name,
        p.is_verified,
        p.average_rating::float AS average_rating,
        p.total_reviews::int AS total_reviews,
        svc_category.category,
        COALESCE(booking_counts.total_bookings, 0)::int AS total_bookings,
        COALESCE(booking_counts.completed_bookings, 0)::int AS completed_bookings,
        CASE
          WHEN COALESCE(booking_counts.total_bookings, 0) = 0 THEN 0
          ELSE ROUND(
            (booking_counts.completed_bookings::numeric / booking_counts.total_bookings::numeric) * 100,
            2
          )::float
        END AS completion_rate,
        p.created_at AS joined_date,
        (p.is_verified = false AND p.average_rating >= 4.0) AS recommend_verification
      FROM provider_profiles p
      LEFT JOIN svc_category ON svc_category.profile_id = p.profile_id
      LEFT JOIN booking_counts ON booking_counts.provider_id = p.profile_id
      WHERE ${filters.join(' AND ')}
      ORDER BY ${sortMap[query.sortBy ?? 'rating'] ?? sortMap.rating}
      `,
      params,
    );

    return {
      summary: {
        totalProviders: rows.length,
        recommendedForVerification: rows.filter(
          (row) => row.recommend_verification,
        ).length,
        verified: rows.filter((row) => row.is_verified).length,
        unverified: rows.filter((row) => !row.is_verified).length,
      },
      data: rows,
    };
  }

  async getBookingActivityReport(query: {
    startDate?: string;
    endDate?: string;
    status?: string;
    groupBy?: 'week' | 'month';
  }) {
    const params: unknown[] = [];
    const filters: string[] = [];
    if (query.startDate) {
      params.push(query.startDate);
      filters.push(`b.created_at >= $${params.length}`);
    }
    if (query.endDate) {
      params.push(query.endDate);
      filters.push(`b.created_at <= $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      filters.push(`b.status = $${params.length}`);
    }

    const groupBy = query.groupBy === 'month' ? 'month' : 'week';
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = await this.bookingsRepo.query(
      `
      SELECT
        DATE_TRUNC('${groupBy}', b.created_at) AS period,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE b.status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE b.status = 'accepted')::int AS accepted,
        COUNT(*) FILTER (WHERE b.status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE b.status = 'declined')::int AS declined,
        COALESCE(SUM(s.price), 0)::float AS revenue_potential
      FROM bookings b
      LEFT JOIN services s ON s.service_id = b.service_id
      ${where}
      GROUP BY period
      ORDER BY period ASC
      `,
      params,
    );

    return {
      summary: {
        total: rows.reduce((sum, row) => sum + Number(row.total), 0),
        completed: rows.reduce((sum, row) => sum + Number(row.completed), 0),
        cancelled: rows.reduce((sum, row) => sum + Number(row.cancelled), 0),
        declined: rows.reduce((sum, row) => sum + Number(row.declined), 0),
        revenuePotential: rows.reduce(
          (sum, row) => sum + Number(row.revenue_potential),
          0,
        ),
      },
      groupBy,
      data: rows,
    };
  }

  async getServiceCatalogReport(query: {
    category?: string;
    minPrice?: string;
    maxPrice?: string;
    isActive?: string;
  }) {
    const params: unknown[] = [];
    const filters: string[] = [];
    if (query.category) {
      params.push(query.category);
      filters.push(`s.category = $${params.length}`);
    }
    if (query.minPrice) {
      params.push(Number(query.minPrice));
      filters.push(`s.price >= $${params.length}`);
    }
    if (query.maxPrice) {
      params.push(Number(query.maxPrice));
      filters.push(`s.price <= $${params.length}`);
    }
    if (query.isActive === 'true' || query.isActive === 'false') {
      params.push(query.isActive === 'true');
      filters.push(`s.is_active = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = await this.servicesRepo.query(
      `
      SELECT
        s.service_id,
        s.service_name,
        s.category,
        s.price::float AS price,
        s.duration_minutes,
        s.pricing_unit,
        s.is_active,
        p.business_name,
        p.is_verified
      FROM services s
      JOIN provider_profiles p ON s.profile_id = p.profile_id
      ${where}
      ORDER BY s.category ASC, s.price ASC
      `,
      params,
    );

    return {
      summary: {
        totalServices: rows.length,
        activeServices: rows.filter((row) => row.is_active).length,
        inactiveServices: rows.filter((row) => !row.is_active).length,
        averagePrice:
          rows.length === 0
            ? 0
            : rows.reduce((sum, row) => sum + Number(row.price), 0) /
              rows.length,
      },
      data: rows,
    };
  }

  async getTrustSafetyReport(query: {
    minCancellations?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const parsedMinCancellations = Number(query.minCancellations ?? 3);
    const minCancellations = Number.isFinite(parsedMinCancellations)
      ? Math.max(parsedMinCancellations, 1)
      : 3;
    const params: unknown[] = [minCancellations];
    const filters = [`b.status = 'cancelled'`];
    if (query.startDate) {
      params.push(query.startDate);
      filters.push(`b.created_at >= $${params.length}`);
    }
    if (query.endDate) {
      params.push(query.endDate);
      filters.push(`b.created_at <= $${params.length}`);
    }
    const where = `WHERE ${filters.join(' AND ')}`;
    const flaggedOwners = await this.bookingsRepo.query(
      `
      WITH owner_counts AS (
        SELECT
          b.owner_id,
          COUNT(*)::int AS total_bookings,
          COUNT(*) FILTER (WHERE b.status = 'cancelled')::int AS cancellations
        FROM bookings b
        ${query.startDate || query.endDate ? `WHERE ${filters.filter((filter) => filter !== `b.status = 'cancelled'`).join(' AND ')}` : ''}
        GROUP BY b.owner_id
      ),
      category_counts AS (
        SELECT
          b.owner_id,
          s.category,
          COUNT(*)::int AS cancel_count,
          ROW_NUMBER() OVER (
            PARTITION BY b.owner_id
            ORDER BY COUNT(*) DESC, s.category ASC
          ) AS row_num
        FROM bookings b
        LEFT JOIN services s ON s.service_id = b.service_id
        ${where}
        GROUP BY b.owner_id, s.category
      )
      SELECT
        owner_counts.owner_id,
        owner_counts.total_bookings,
        owner_counts.cancellations AS cancel_count,
        CASE
          WHEN owner_counts.total_bookings = 0 THEN 0
          ELSE ROUND((owner_counts.cancellations::numeric / owner_counts.total_bookings::numeric) * 100, 2)::float
        END AS cancellation_rate,
        COALESCE(category_counts.category, 'Uncategorized') AS most_cancelled_category,
        u.full_name,
        u.email,
        u.is_banned
      FROM owner_counts
      JOIN users u ON owner_counts.owner_id = u.id
      LEFT JOIN category_counts
        ON category_counts.owner_id = owner_counts.owner_id
        AND category_counts.row_num = 1
      WHERE owner_counts.cancellations >= $1
      ORDER BY owner_counts.cancellations DESC
      `,
      params,
    );

    const declineParams: unknown[] = [];
    const declineFilters: string[] = [];
    if (query.startDate) {
      declineParams.push(query.startDate);
      declineFilters.push(`b.created_at >= $${declineParams.length}`);
    }
    if (query.endDate) {
      declineParams.push(query.endDate);
      declineFilters.push(`b.created_at <= $${declineParams.length}`);
    }
    const declineWhere = declineFilters.length
      ? `AND ${declineFilters.join(' AND ')}`
      : '';
    const declineBreakdown = await this.bookingsRepo.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(decline_reason), ''), 'No reason provided') AS decline_reason,
        COUNT(*)::int AS count
      FROM bookings b
      WHERE b.status = 'declined'
      ${declineWhere}
      GROUP BY decline_reason
      ORDER BY count DESC
      `,
      declineParams,
    );

    return {
      summary: {
        flaggedOwners: flaggedOwners.length,
        totalCancellations: flaggedOwners.reduce(
          (sum, row) => sum + Number(row.cancel_count),
          0,
        ),
        mostCancelledCategory:
          flaggedOwners[0]?.most_cancelled_category ?? 'None',
        averageCancellationRate:
          flaggedOwners.length === 0
            ? 0
            : flaggedOwners.reduce(
                (sum, row) => sum + Number(row.cancellation_rate),
                0,
              ) / flaggedOwners.length,
        declineReasonCount: declineBreakdown.length,
      },
      flaggedOwners,
      declineReasons: declineBreakdown,
    };
  }

  async getPetOwnershipReport(query: { minPets?: string }) {
    const minPets = Math.max(0, parseInt(query.minPets ?? '0', 10) || 0);

    const distributionRows = await this.usersRepo.query(
      `
      SELECT
        pet_count,
        COUNT(*)::int AS owner_count
      FROM (
        SELECT u.id, COUNT(pp.pet_id)::int AS pet_count
        FROM users u
        LEFT JOIN pet_profiles pp ON pp.owner_id = u.id
        WHERE u.role = 'owner'
        GROUP BY u.id
      ) sub
      GROUP BY pet_count
      ORDER BY pet_count ASC
      `,
    );

    const topOwners = await this.usersRepo.query(
      `
      SELECT
        u.id             AS owner_id,
        u.full_name      AS owner_name,
        u.email,
        COUNT(pp.pet_id)::int                        AS pet_count,
        STRING_AGG(DISTINCT pp.species, ', ')        AS species_list,
        u.created_at                                 AS joined_at
      FROM users u
      LEFT JOIN pet_profiles pp ON pp.owner_id = u.id
      WHERE u.role = 'owner'
      GROUP BY u.id, u.full_name, u.email, u.created_at
      HAVING COUNT(pp.pet_id) >= $1
      ORDER BY pet_count DESC
      LIMIT 50
      `,
      [minPets],
    );

    const totalPetOwners = distributionRows
      .filter((r: { pet_count: string }) => Number(r.pet_count) > 0)
      .reduce(
        (sum: number, r: { owner_count: string }) => sum + Number(r.owner_count),
        0,
      );
    const ownersWithNoPets = Number(
      distributionRows.find(
        (r: { pet_count: string }) => Number(r.pet_count) === 0,
      )?.owner_count ?? 0,
    );
    const totalPets = distributionRows.reduce(
      (sum: number, r: { pet_count: string; owner_count: string }) =>
        sum + Number(r.pet_count) * Number(r.owner_count),
      0,
    );
    const topOwner = topOwners.length > 0 ? topOwners[0] : null;

    return {
      summary: {
        totalPetOwners,
        ownersWithNoPets,
        totalPets,
        mostPets: topOwner ? Number(topOwner.pet_count) : 0,
        avgPetsPerOwner:
          totalPetOwners === 0
            ? 0
            : parseFloat((totalPets / totalPetOwners).toFixed(1)),
      },
      distribution: distributionRows,
      topOwners,
    };
  }

  async getPetActivityReport(query: { species?: string }) {
    const petFilters: string[] = [];
    const params: unknown[] = [];

    if (query.species) {
      params.push(query.species.toLowerCase());
      petFilters.push(`LOWER(pp.species) = $${params.length}`);
    }
    const petWhere = petFilters.length
      ? `WHERE ${petFilters.join(' AND ')}`
      : '';

    const speciesRows = await this.usersRepo.query(
      `
      SELECT
        pp.species,
        COUNT(DISTINCT pp.pet_id)::int AS pet_count,
        COUNT(b.booking_id)::int AS booking_count
      FROM pet_profiles pp
      LEFT JOIN bookings b ON b.pet_id = pp.pet_id
      ${petWhere}
      GROUP BY pp.species
      ORDER BY pet_count DESC
      `,
      params,
    );

    const topPetParams: unknown[] = [];
    const topPetFilters: string[] = [];
    if (query.species) {
      topPetParams.push(query.species.toLowerCase());
      topPetFilters.push(`LOWER(pp.species) = $${topPetParams.length}`);
    }
    const topPetWhere = topPetFilters.length
      ? `WHERE ${topPetFilters.join(' AND ')}`
      : '';

    const topPets = await this.usersRepo.query(
      `
      SELECT
        pp.pet_id,
        pp.name            AS pet_name,
        pp.species,
        pp.breed,
        u.full_name        AS owner_name,
        COUNT(b.booking_id)::int AS booking_count,
        MAX(b.booking_datetime)  AS last_booking
      FROM pet_profiles pp
      LEFT JOIN users u ON u.id = pp.owner_id
      LEFT JOIN bookings b ON b.pet_id = pp.pet_id
      ${topPetWhere}
      GROUP BY pp.pet_id, pp.name, pp.species, pp.breed, u.full_name
      ORDER BY booking_count DESC
      LIMIT 50
      `,
      topPetParams,
    );

    const totalPets = speciesRows.reduce(
      (sum: number, row: { pet_count: string }) => sum + Number(row.pet_count),
      0,
    );
    const totalBookings = speciesRows.reduce(
      (sum: number, row: { booking_count: string }) =>
        sum + Number(row.booking_count),
      0,
    );
    const mostPopularSpecies =
      speciesRows.length > 0 ? speciesRows[0].species : 'N/A';
    const topPet = topPets.length > 0 ? topPets[0] : null;

    return {
      summary: {
        totalPets,
        totalBookings,
        mostPopularSpecies,
        topPet: topPet
          ? `${topPet.pet_name} (${topPet.booking_count} bookings)`
          : 'N/A',
        avgBookingsPerPet:
          totalPets === 0
            ? 0
            : parseFloat((totalBookings / totalPets).toFixed(1)),
      },
      bySpecies: speciesRows,
      topPets,
    };
  }

  async getUserSummaryReport(query: {
    role?: UserRole;
    startDate?: string;
    endDate?: string;
  }) {
    const params: unknown[] = [];
    const filters: string[] = [];
    if (query.role) {
      params.push(query.role);
      filters.push(`role = $${params.length}`);
    }
    if (query.startDate) {
      params.push(query.startDate);
      filters.push(`created_at >= $${params.length}`);
    }
    if (query.endDate) {
      params.push(query.endDate);
      filters.push(`created_at <= $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = await this.usersRepo.query(
      `
      SELECT
        role,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_banned = true)::int AS banned,
        DATE_TRUNC('month', created_at) AS month
      FROM users
      ${where}
      GROUP BY role, month
      ORDER BY month ASC, role ASC
      `,
      params,
    );

    return {
      summary: {
        totalUsers: rows.reduce((sum, row) => sum + Number(row.total), 0),
        bannedUsers: rows.reduce((sum, row) => sum + Number(row.banned), 0),
        roles: [...new Set(rows.map((row) => row.role))],
      },
      data: rows,
    };
  }
}
