import { Prisma, PrismaClient } from '@prisma/client';
import {
  Producer,
  ProduceAcks,
  type ProducerOptions,
  type SASLOptions as PlatformaticSaslOptions,
} from '@platformatic/kafka';
import { Utils } from 'src/shared/modules/global/utils.service';

const SUBMISSION_AGGREGATE_TOPIC = 'submission.notification.aggregate';
const ORIGINAL_TOPIC = 'submission.notification.create';

type SubmissionForAggregate = Prisma.submissionGetPayload<{
  select: {
    id: true;
    type: true;
    status: true;
    memberId: true;
    challengeId: true;
    legacyChallengeId: true;
    legacySubmissionId: true;
    legacyUploadId: true;
    submissionPhaseId: true;
    systemFileName: true;
    fileType: true;
    fileSize: true;
    viewCount: true;
    url: true;
    isFileSubmission: true;
    submittedDate: true;
    createdAt: true;
    updatedAt: true;
    createdBy: true;
    updatedBy: true;
    prizeId: true;
  };
}>;

interface SubmissionAggregatePayload {
  resource: 'submission';
  id: string;
  type: string;
  status: string;
  memberId: string | null;
  challengeId: string | null;
  legacyChallengeId: number | null;
  legacySubmissionId: string | null;
  legacyUploadId: string | null;
  submissionPhaseId: string | null;
  systemFileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  viewCount: number | null;
  url: string | null;
  isFileSubmission: boolean;
  submittedDate: string | null;
  created: string;
  updated: string;
  createdBy: string | null;
  updatedBy: string | null;
  prizeId: number | null;
  originalTopic: string;
  v5ChallengeId?: string | null;
}

interface KafkaEnvelope {
  topic: typeof SUBMISSION_AGGREGATE_TOPIC;
  originator: string;
  timestamp: string;
  'mime-type': 'application/json';
  payload: SubmissionAggregatePayload;
}

type KafkaSaslMechanism =
  | 'plain'
  | 'scram-sha-256'
  | 'scram-sha-512'
  | 'oauthbearer';

interface KafkaSaslOptions {
  mechanism: KafkaSaslMechanism;
  username?: string;
  password?: string;
  token?: string;
}

interface KafkaCliOptions {
  brokers: string[];
  clientId: string;
  ssl: boolean;
  connectionTimeout?: number;
  requestTimeout?: number;
  retry?: {
    retries?: number;
    initialRetryTime?: number;
  };
  sasl?: KafkaSaslOptions;
}

interface ScriptOptions {
  challengeId: string;
  dryRun: boolean;
}

class SubmissionAggregatePublisher {
  private readonly prisma = new PrismaClient();
  private readonly originator: string;
  private readonly producerOptions: ProducerOptions<
    Buffer,
    Buffer,
    Buffer,
    Buffer
  >;
  private producer?: Producer<Buffer, Buffer, Buffer, Buffer>;
  private producerReady = false;

  constructor(
    originator: string,
    producerOptions: ProducerOptions<Buffer, Buffer, Buffer, Buffer>,
  ) {
    this.originator = originator;
    this.producerOptions = producerOptions;
  }

  async execute({ challengeId, dryRun }: ScriptOptions): Promise<void> {
    const submissions = await this.loadSubmissions(challengeId);

    if (submissions.length === 0) {
      console.info(
        `No submissions found for challenge identifier "${challengeId}".`,
      );
      return;
    }

    console.info(
      `Preparing ${submissions.length} submission aggregate message(s) for challenge identifier "${challengeId}".`,
    );

    const messages = submissions.map((submission) => ({
      submissionId: submission.id,
      envelope: this.buildKafkaEnvelope(submission),
    }));

    if (dryRun) {
      messages.forEach(({ submissionId, envelope }) => {
        console.info(`[dry-run] Would publish aggregate for submission ${submissionId}`);
        console.info(JSON.stringify(envelope.payload, null, 2));
      });
      return;
    }

    await this.ensureProducer();

    for (const { submissionId, envelope } of messages) {
      await this.sendMessage(envelope);
      console.info(
        `Published submission.notification.aggregate for submission ${submissionId}.`,
      );
    }

    console.info(
      `Finished publishing ${messages.length} submission aggregate message(s) to ${SUBMISSION_AGGREGATE_TOPIC}.`,
    );
  }

  async dispose(): Promise<void> {
    await this.prisma.$disconnect();

    if (this.producer) {
      try {
        await this.producer.close();
      } catch (error) {
        console.warn('Failed to close Kafka producer cleanly', error);
      }
    }
  }

  private async loadSubmissions(
    challengeId: string,
  ): Promise<SubmissionForAggregate[]> {
    const trimmedId = challengeId.trim();
    if (!trimmedId) {
      throw new Error('Challenge ID is required');
    }

    const whereClauses: Prisma.submissionWhereInput[] = [
      { challengeId: trimmedId },
    ];

    if (/^\d+$/.test(trimmedId)) {
      try {
        whereClauses.push({ legacyChallengeId: BigInt(trimmedId) });
      } catch (error) {
        console.warn(
          `Unable to interpret challenge identifier ${trimmedId} as legacy challenge id: ${(error as Error).message}`,
        );
      }
    }

    return this.prisma.submission.findMany({
      where: { OR: whereClauses },
      orderBy: [
        { submittedDate: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        id: true,
        type: true,
        status: true,
        memberId: true,
        challengeId: true,
        legacyChallengeId: true,
        legacySubmissionId: true,
        legacyUploadId: true,
        submissionPhaseId: true,
        systemFileName: true,
        fileType: true,
        fileSize: true,
        viewCount: true,
        url: true,
        isFileSubmission: true,
        submittedDate: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true,
        updatedBy: true,
        prizeId: true,
      },
    });
  }

  private buildKafkaEnvelope(submission: SubmissionForAggregate): KafkaEnvelope {
    return {
      topic: SUBMISSION_AGGREGATE_TOPIC,
      originator: this.originator,
      timestamp: new Date().toISOString(),
      'mime-type': 'application/json',
      payload: this.buildPayload(submission),
    };
  }

  private buildPayload(
    submission: SubmissionForAggregate,
  ): SubmissionAggregatePayload {
    const submittedDate = toIsoString(submission.submittedDate);
    const updatedAt =
      toIsoString(submission.updatedAt) ?? submission.createdAt.toISOString();

    return {
      resource: 'submission',
      id: submission.id,
      type: submission.type,
      status: submission.status,
      memberId: submission.memberId ?? null,
      challengeId: submission.challengeId ?? null,
      legacyChallengeId: Utils.bigIntToNumber(submission.legacyChallengeId),
      legacySubmissionId: submission.legacySubmissionId ?? null,
      legacyUploadId: submission.legacyUploadId ?? null,
      submissionPhaseId: submission.submissionPhaseId ?? null,
      systemFileName: submission.systemFileName ?? null,
      fileType: submission.fileType ?? null,
      fileSize: submission.fileSize ?? null,
      viewCount: submission.viewCount ?? null,
      url: submission.url ?? null,
      isFileSubmission: Boolean(submission.isFileSubmission),
      submittedDate,
      created: submission.createdAt.toISOString(),
      updated: updatedAt,
      createdBy: submission.createdBy ?? null,
      updatedBy: submission.updatedBy ?? null,
      prizeId: Utils.bigIntToNumber(submission.prizeId),
      originalTopic: ORIGINAL_TOPIC,
      v5ChallengeId: submission.challengeId ?? null,
    };
  }

  private async ensureProducer(): Promise<void> {
    if (this.producer && this.producerReady) {
      return;
    }

    if (!this.producer) {
      this.producer = new Producer(this.producerOptions);
    }

    await this.producer.connectToBrokers(null);
    this.producerReady = true;
  }

  private async sendMessage(envelope: KafkaEnvelope): Promise<void> {
    if (!this.producer || !this.producerReady) {
      throw new Error('Kafka producer is not ready');
    }

    await this.producer.send({
      messages: [
        {
          topic: SUBMISSION_AGGREGATE_TOPIC,
          key: Buffer.from(envelope.payload.id),
          value: Buffer.from(JSON.stringify(envelope)),
        },
      ],
      acks: ProduceAcks.ALL,
    });
  }
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function parseArgs(argv: string[]): ScriptOptions {
  let dryRun = false;
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positional.push(arg);
  }

  const challengeId = positional[0];
  if (!challengeId) {
    throw new Error(
      'Usage: ts-node scripts/publish-submission-aggregates.ts <challengeId> [--dry-run]',
    );
  }

  return { challengeId, dryRun };
}

function parseKafkaOptionsFromEnv(): KafkaCliOptions {
  const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);

  if (!brokers.length) {
    throw new Error('At least one Kafka broker must be provided via KAFKA_BROKERS.');
  }

  const saslUsername = process.env.KAFKA_SASL_USERNAME;
  const saslOptions = saslUsername
    ? {
        mechanism:
          (process.env.KAFKA_SASL_MECHANISM as
            | KafkaSaslMechanism
            | undefined) || 'plain',
        username: saslUsername,
        password: process.env.KAFKA_SASL_PASSWORD,
        token: process.env.KAFKA_SASL_TOKEN,
      }
    : undefined;

  return {
    brokers,
    clientId: process.env.KAFKA_CLIENT_ID || 'review-api-v6-scripts',
    ssl: process.env.KAFKA_SSL_ENABLED === 'true',
    connectionTimeout: parseOptionalInt(process.env.KAFKA_CONNECTION_TIMEOUT),
    requestTimeout: parseOptionalInt(process.env.KAFKA_REQUEST_TIMEOUT),
    retry: {
      retries: parseOptionalInt(process.env.KAFKA_RETRY_ATTEMPTS),
      initialRetryTime: parseOptionalInt(process.env.KAFKA_INITIAL_RETRY_TIME),
    },
    sasl: saslOptions,
  };
}

function createProducerOptions(): ProducerOptions<
  Buffer,
  Buffer,
  Buffer,
  Buffer
> {
  const kafkaOptions = parseKafkaOptionsFromEnv();
  const producerOptions: ProducerOptions<Buffer, Buffer, Buffer, Buffer> = {
    clientId: kafkaOptions.clientId,
    bootstrapBrokers: kafkaOptions.brokers,
  };

  if (kafkaOptions.connectionTimeout !== undefined) {
    producerOptions.connectTimeout = kafkaOptions.connectionTimeout;
  }

  if (kafkaOptions.requestTimeout !== undefined) {
    producerOptions.timeout = kafkaOptions.requestTimeout;
  }

  if (kafkaOptions.retry?.retries !== undefined) {
    producerOptions.retries = kafkaOptions.retry.retries;
  }

  if (kafkaOptions.retry?.initialRetryTime !== undefined) {
    producerOptions.retryDelay = kafkaOptions.retry.initialRetryTime;
  }

  const sasl = mapSaslOptions(kafkaOptions.sasl);
  if (sasl) {
    producerOptions.sasl = sasl;
  }

  if (kafkaOptions.ssl) {
    producerOptions.tls = {};
  }

  return producerOptions;
}

function mapSaslOptions(
  sasl?: KafkaSaslOptions,
): PlatformaticSaslOptions | undefined {
  if (!sasl) {
    return undefined;
  }

  const mechanismMap: Record<
    KafkaSaslMechanism,
    PlatformaticSaslOptions['mechanism']
  > = {
    plain: 'PLAIN',
    'scram-sha-256': 'SCRAM-SHA-256',
    'scram-sha-512': 'SCRAM-SHA-512',
    oauthbearer: 'OAUTHBEARER',
  };

  const mappedMechanism = mechanismMap[sasl.mechanism];
  if (sasl.mechanism === 'oauthbearer') {
    if (!sasl.token) {
      throw new Error(
        'KAFKA_SASL_TOKEN is required when using oauthbearer SASL mechanism',
      );
    }

    return {
      mechanism: mappedMechanism,
      token: sasl.token,
      username: sasl.username,
    };
  }

  return {
    mechanism: mappedMechanism,
    username: sasl.username,
    password: sasl.password,
  };
}

function parseOptionalInt(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const originator = process.env.KAFKA_MESSAGE_ORIGINATOR || 'review-api-v6';
  const publisher = new SubmissionAggregatePublisher(
    originator,
    createProducerOptions(),
  );

  try {
    await publisher.execute(args);
  } catch (error) {
    console.error('Failed to publish submission aggregate messages', error);
    process.exitCode = 1;
  } finally {
    await publisher.dispose();
  }
}

void main();
