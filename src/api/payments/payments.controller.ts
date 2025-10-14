import {
  Controller,
  Get,
  Param,
  Req,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtUser, isAdmin } from 'src/shared/modules/global/jwt.service';
import { ResourceApiService } from 'src/shared/modules/global/resource.service';
import { FinancePrismaService } from 'src/shared/modules/global/finance-prisma.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly financeDb: FinancePrismaService,
    private readonly resourceApi: ResourceApiService,
  ) {}

  @Get('challenges/:challengeId')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List payments (winnings) for a challenge with role-aware filtering',
  })
  async getPaymentsForChallenge(
    @Param('challengeId') challengeId: string,
    @Req() req: any,
    @Query('winnerOnly') winnerOnly?: string,
  ) {
    const authUser: JwtUser | undefined = req['user'] as JwtUser;
    if (!authUser) {
      throw new UnauthorizedException('Missing or invalid token');
    }

    // Defaults
    let allowAllForChallenge = false;
    let filterWinnerId: string | undefined = undefined;

    // Admins (and M2M tokens) can see all payments for the challenge
    if (authUser.isMachine || isAdmin(authUser)) {
      allowAllForChallenge = true;
    } else {
      const requesterId = String(authUser.userId ?? '').trim();
      if (!requesterId) {
        throw new UnauthorizedException(
          'Authenticated user is missing required identifier',
        );
      }

      // If explicitly requested to see only own winnings, enforce winner filter
      if ((winnerOnly || '').toLowerCase() === 'true') {
        filterWinnerId = requesterId;
      }

      // Check copilot assignment for this challenge
      try {
        const roles = await this.resourceApi.getMemberResourcesRoles(
          challengeId,
          requesterId,
        );
        const hasCopilotRole = roles.some((r) =>
          String(r.roleName ?? '')
            .toLowerCase()
            .includes('copilot'),
        );
        if (hasCopilotRole) {
          allowAllForChallenge = true;
        }
      } catch {
        // If resource API returns 403/404, we still allow submitter visibility.
      }

      // If not admin nor copilot, limit to winner_id = requester
      if (!allowAllForChallenge) {
        filterWinnerId = requesterId;
      }
    }

    // Query finance DB
    const rows = await this.financeDb.getWinningsByExternalId(
      challengeId,
      filterWinnerId,
    );

    // Shape the response similar to Wallet Admin winnings
    const data = rows.map((w) => ({
      id: w.winning_id,
      type: 'PAYMENT',
      handle: '', // handle to be resolved by the caller if needed
      winnerId: w.winner_id,
      origin: '',
      category: w.category ?? 'CONTEST_PAYMENT',
      title: w.title ?? undefined,
      description: w.description ?? '',
      externalId: w.external_id ?? challengeId,
      attributes: { url: '' },
      details: (w.details || []).map((d) => ({
        id: d.id,
        netAmount: d.net_amount ?? '0',
        grossAmount: d.gross_amount ?? '0',
        totalAmount: d.total_amount ?? '0',
        installmentNumber: d.installment_number ?? 1,
        status: d.status ?? 'OWED',
        currency: d.currency ?? 'USD',
        datePaid: d.date_paid
          ? new Date(d.date_paid as any).toISOString()
          : null,
      })),
      createdAt: w.created_at
        ? new Date(w.created_at as any).toISOString()
        : new Date().toISOString(),
      releaseDate: (w.details?.[0]?.release_date as any)
        ? new Date(w.details?.[0]?.release_date as any).toISOString()
        : new Date().toISOString(),
      datePaid: (w.details?.[0]?.date_paid as any)
        ? new Date(w.details?.[0]?.date_paid as any).toISOString()
        : null,
    }));

    return {
      winnings: data,
      pagination: {
        totalItems: data.length,
        totalPages: 1,
        pageSize: data.length,
        currentPage: 1,
      },
    };
  }
}
