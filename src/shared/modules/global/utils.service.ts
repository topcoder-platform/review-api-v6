export class Utils {
  private constructor() {}

  static bigIntToNumber(t) {
    return t ? Number(t) : null;
  }

  static getPrismaTimeout() {
    return {
      transactionOptions: {
        timeout: process.env.REVIEW_SERVICE_PRISMA_TIMEOUT
          ? parseInt(process.env.REVIEW_SERVICE_PRISMA_TIMEOUT, 10)
          : 10000,
      }
    }
  }
}
