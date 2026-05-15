import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Provider, VerificationStatus } from '../providers/providers.entity';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadVerificationDto } from './dto/upload-verification.dto';
import {
  VerificationDocument,
  VerificationDocumentStatus,
} from './verification-document.entity';

@Injectable()
export class VerificationService {
  constructor(
    @InjectRepository(VerificationDocument)
    private readonly documentsRepo: Repository<VerificationDocument>,
    @InjectRepository(Provider)
    private readonly providersRepo: Repository<Provider>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async uploadDocument(userId: string, dto: UploadVerificationDto) {
    const provider = await this.providersRepo.findOne({ where: { userId } });
    if (!provider) {
      throw new NotFoundException('Provider profile not found');
    }

    if (
      provider.isVerified ||
      provider.verificationStatus === VerificationStatus.APPROVED
    ) {
      throw new ConflictException('Your account is already verified');
    }

    const document = this.documentsRepo.create({
      profileId: provider.id,
      documentType: dto.documentType,
      fileUrl: dto.fileUrl,
      status: VerificationDocumentStatus.PENDING,
    });
    const saved = await this.documentsRepo.save(document);

    await this.providersRepo.update(provider.id, {
      verificationStatus: VerificationStatus.PENDING,
    });

    const admins = await this.usersRepo.find({ where: { role: 'admin' } });
    await Promise.all(
      admins.map((admin) =>
        this.notificationsService.createNotification(
          admin.id,
          'system',
          'New verification submission',
          `${provider.businessName} has submitted documents for review`,
          saved.docId,
        ),
      ),
    );

    return saved;
  }

  async getStatus(userId: string) {
    const provider = await this.providersRepo.findOne({ where: { userId } });
    if (!provider) {
      throw new NotFoundException('Provider profile not found');
    }

    const documents = await this.documentsRepo.find({
      where: { profileId: provider.id },
      order: { uploadedAt: 'DESC' },
    });

    return {
      verificationStatus: provider.verificationStatus,
      isVerified: provider.isVerified,
      documents: documents.map((document) => ({
        doc_id: document.docId,
        document_type: document.documentType,
        file_url: document.fileUrl,
        status: document.status,
        admin_notes: document.adminNotes,
        uploaded_at: document.uploadedAt,
      })),
    };
  }
}
