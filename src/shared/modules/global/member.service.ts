import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MemberPrismaService } from './member-prisma.service';

export class MemberInfo {
  userId: string;
  email: string;
}

@Injectable()
export class MemberService {
  private readonly logger: Logger = new Logger(MemberService.name);

  constructor(private readonly memberPrisma: MemberPrismaService) {}

  /**
   * Get user emails from Member API
   * @param userIds user id list
   * @returns user info list
   */
  async getUserEmails(userIds: string[]) {
    if (!userIds || userIds.length === 0) return [];

    try {
      const ids = userIds.map((id) => BigInt(id));
      const members = await this.memberPrisma.member.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, email: true },
      });

      return members.map((m) => ({ userId: String(m.userId), email: m.email }));
    } catch (e) {
      this.logger.error(`Can't get member info from DB: ${e}`);
      throw new InternalServerErrorException('Cannot get data from Member DB.');
    }
  }
}
