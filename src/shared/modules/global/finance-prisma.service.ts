import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

type WinningDetail = {
  id: string;
  net_amount: string | null;
  gross_amount: string | null;
  total_amount: string | null;
  installment_number: number | null;
  status: string | null;
  currency: string | null;
  date_paid: Date | null;
  release_date: Date | null;
};

type WinningRow = {
  winning_id: string;
  winner_id: string;
  category: string | null;
  title: string | null;
  description: string | null;
  external_id: string | null;
  created_at: Date | null;
  details: WinningDetail[];
};

/**
 * Lightweight Prisma client targeting the Finance DB via FINANCE_DB_URL.
 * Uses raw SQL queries, so no finance models are required in the generated client.
 */
@Injectable()
export class FinancePrismaService implements OnModuleInit, OnModuleDestroy {
  private client: PrismaClient;

  constructor() {
    const url = process.env.FINANCE_DB_URL || process.env.FINANCE_DATABASE_URL;
    if (!url) {
      // Intentionally not throwing here to allow app to boot; service methods will throw if used without URL
      // This helps other features to work when payments are not configured.

      console.warn(
        '[FinancePrismaService] FINANCE_DB_URL not set; payments features disabled.',
      );
    }

    this.client = new PrismaClient({
      datasources: url ? { db: { url } } : undefined,
    });
  }

  async onModuleInit(): Promise<void> {
    // Best-effort connect; if url is missing we skip connect and throw later on query
    try {
      await this.client.$connect();
    } catch (err) {
      console.error(
        '[FinancePrismaService] Failed to connect to Finance DB',
        err,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.$disconnect();
    } catch {
      // ignore
    }
  }

  /**
   * Fetch winnings for a challenge by `external_id`. When winnerId is provided, results are filtered to the user.
   */
  async getWinningsByExternalId(
    challengeId: string,
    winnerId?: string,
  ): Promise<WinningRow[]> {
    const hasUrl = Boolean(
      process.env.FINANCE_DB_URL || process.env.FINANCE_DATABASE_URL,
    );
    if (!hasUrl) {
      throw new Error('FINANCE_DB_URL is not configured');
    }

    // Query base winnings rows
    const baseRows: Array<{
      winning_id: string;
      winner_id: string;
      category: string | null;
      title: string | null;
      description: string | null;
      external_id: string | null;
      created_at: Date | null;
    }> = await this.client.$queryRaw(
      Prisma.sql`SELECT w.winning_id, w.winner_id, w.category, w.title, w.description, w.external_id, w.created_at
                 FROM winnings w
                 WHERE w.external_id = ${challengeId}
                   AND w.type = 'PAYMENT'
                 ${winnerId ? Prisma.sql`AND w.winner_id = ${winnerId}` : Prisma.sql``}`,
    );

    if (!baseRows.length) {
      return [] as WinningRow[];
    }

    const ids = baseRows.map((r) => r.winning_id);
    const idsList = Prisma.join(ids);

    // Query payment details for these winnings
    const paymentRows: Array<{
      payment_id: string;
      winnings_id: string;
      net_amount: any;
      gross_amount: any;
      total_amount: any;
      installment_number: number | null;
      status: string | null;
      currency: string | null;
      date_paid: Date | null;
      release_date: Date | null;
    }> = await this.client.$queryRaw(
      Prisma.sql`SELECT p.payment_id, p.winnings_id, p.net_amount, p.gross_amount, p.total_amount, p.installment_number, p.payment_status as status, p.currency, p.date_paid, p.release_date
                 FROM payment p
                 WHERE p.winnings_id = ANY(ARRAY[${idsList}]::uuid[])`,
    );

    const detailMap = new Map<string, WinningDetail[]>();
    for (const p of paymentRows) {
      const arr = detailMap.get(p.winnings_id) || [];
      arr.push({
        id: p.payment_id,
        net_amount: p.net_amount?.toString?.() ?? p.net_amount,
        gross_amount: p.gross_amount?.toString?.() ?? p.gross_amount,
        total_amount: p.total_amount?.toString?.() ?? p.total_amount,
        installment_number: p.installment_number ?? null,
        status: p.status ?? null,
        currency: p.currency ?? null,
        date_paid: p.date_paid ?? null,
        release_date: p.release_date ?? null,
      });
      detailMap.set(p.winnings_id, arr);
    }

    // Attach details
    const result: WinningRow[] = baseRows.map((w) => ({
      ...w,
      details: detailMap.get(w.winning_id) || [],
    }));
    return result;
  }
}
