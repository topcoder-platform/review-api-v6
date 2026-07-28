# Kafka Development Setup

This document describes how to set up and test the Kafka consumer functionality in the TC Review API.

## Quick Start

### 1. Start Kafka Services

```bash
# Start Kafka and related services
docker compose -f docker-compose.kafka.yml up -d

# Verify services are running
docker compose -f docker-compose.kafka.yml ps
```

This will start:

- **Zookeeper** on port 2181
- **Kafka** on port 9092
- **Kafka UI** on port 8080 (web interface)

### 2. Configure Environment

```bash
# Copy the sample environment file
cp .env.sample .env

# Update the .env file with your database and other configurations
# Kafka settings are pre-configured for local development
```

### 3. Start the Application

```bash
# Install dependencies
pnpm install

# Start in development mode
pnpm run start:dev
```

The application will automatically:

- Connect to Kafka on startup
- Subscribe to registered topics
- Start consuming messages

## Testing Kafka Events

### Using Kafka UI (Recommended)

1. Open http://localhost:8080 in your browser
2. Navigate to Topics
3. Create or select the `avscan.action.scan` topic
4. Produce a test message with JSON payload:
   ```json
   {
     "scanId": "test-123",
     "submissionId": "sub-456",
     "status": "initiated",
     "timestamp": "2025-01-01T12:00:00Z"
   }
   ```

### Using Command Line

```bash
# Create a topic (optional - auto-created)
docker exec -it kafka kafka-topics --create --topic avscan.action.scan --bootstrap-server localhost:9092 --partitions 1 --replication-factor 1

# Produce a test message
docker exec -it kafka kafka-console-producer --topic avscan.action.scan --bootstrap-server localhost:9092
# Then type your JSON message and press Enter

# Consume messages (for debugging)
docker exec -it kafka kafka-console-consumer --topic avscan.action.scan --from-beginning --bootstrap-server localhost:9092
```

## Development Workflow

### Adding New Event Handlers

1. Create a new handler class extending `BaseEventHandler`:

   ```typescript
   @Injectable()
   export class MyCustomHandler
     extends BaseEventHandler
     implements OnModuleInit
   {
     private readonly topic = 'my.custom.topic';

     constructor(private readonly handlerRegistry: KafkaHandlerRegistry) {
       super(LoggerService.forRoot('MyCustomHandler'));
     }

     onModuleInit() {
       this.handlerRegistry.registerHandler(this.topic, this);
     }

     getTopic(): string {
       return this.topic;
     }

     async handle(message: any): Promise<void> {
       // Your custom logic here
     }
   }
   ```

2. Register the handler in the `src/shared/modules/kafka/handlers/registered-handlers.config.ts` config handlers array.
3. The handler will automatically be registered and start consuming messages.

### Dead Letter Queue (DLQ) Support

The application includes a robust Dead Letter Queue implementation for handling message processing failures:

1. **Configuration**:

   ```
   # DLQ Configuration in .env
   KAFKA_DLQ_ENABLED=true
   KAFKA_DLQ_TOPIC_SUFFIX=.dlq
   KAFKA_DLQ_MAX_RETRIES=3
   ```

2. **Retry Mechanism**:

   - Failed messages are automatically retried up to the configured maximum number of retries
   - Retry count is tracked per message using a unique key based on topic, partition, and offset
   - Exponential backoff is applied between retries

3. **DLQ Processing**:

   - After exhausting retries, messages are sent to a DLQ topic (original topic name + configured suffix)
   - DLQ messages include:
     - Original message content
     - Error information
     - Original topic, partition, and offset
     - Timestamp of failure
     - Original message headers

4. **Monitoring DLQ**:

   - Use Kafka UI to monitor DLQ topics (they follow the pattern `<original-topic>.dlq`)
   - Check application logs for messages with "Message sent to DLQ" or "Failed to send message to DLQ"

### Monitoring and Debugging

- **Application Logs**: Check console output for Kafka connection status and message processing
- **Kafka UI**: Monitor topics, partitions, and consumer groups at http://localhost:8080
- **Health Checks**: Kafka connection status is included in application health checks

### Kafka Client and Recovery

- The service uses `@platformatic/kafka` 2.8.0 for broker failover and consumer group recovery fixes.
- Platformatic Kafka 2.x raises the aggregate consumer Fetch limit to 50 MiB. The service deliberately retains the previous 10 MiB `maxBytes` limit to avoid increasing its per-consumer memory envelope.
- Terminal consumer or producer client errors and offset commit timeouts mark Kafka health as `reconnecting` and start the shared reconnect lifecycle. A successful reconnect returns health to `ready`; exhausted attempts mark it as `failed` with the last failure reason.

### Environment Variables

All Kafka-related environment variables are documented in `.env.sample`:

- `KAFKA_BROKERS`: Comma-separated list of Kafka brokers
- `KAFKA_CLIENT_ID`: Unique client identifier
- `KAFKA_GROUP_ID`: Consumer group ID
- `KAFKA_SSL_ENABLED`: Enable SSL encryption
- **Connection and consumer timing**:
  - `KAFKA_CONNECTION_TIMEOUT`: Maximum time to establish a broker connection; defaults to `10000` ms
  - `KAFKA_REQUEST_TIMEOUT`: Client-side deadline for an in-flight Kafka request; defaults to `30000` ms
  - `KAFKA_BROKER_TIMEOUT`: Timeout sent to broker APIs that support one; defaults to `5000` ms
  - `KAFKA_MAX_WAIT_TIME`: Maximum time the broker may hold an idle Fetch request; defaults to `5000` ms
  - `KAFKA_SESSION_TIMEOUT`: Consumer group session timeout; defaults to `60000` ms
  - `KAFKA_HEARTBEAT_INTERVAL`: Consumer group heartbeat interval; defaults to `3000` ms
- `KAFKA_REQUEST_TIMEOUT` must be greater than both `KAFKA_BROKER_TIMEOUT` and `KAFKA_MAX_WAIT_TIME`. The sum of `KAFKA_HEARTBEAT_INTERVAL` and `KAFKA_REQUEST_TIMEOUT` must be less than `KAFKA_SESSION_TIMEOUT`.
- **Retry configuration**:
  - `KAFKA_RETRY_ATTEMPTS`: Maximum client and reconnection attempts
  - `KAFKA_INITIAL_RETRY_TIME`: Initial retry delay in milliseconds
  - `KAFKA_MAX_RETRY_TIME`: Maximum retry delay in milliseconds
  - Reconnection delays use bounded jitter so multiple service tasks do not reconnect to the brokers simultaneously
- **DLQ Configuration**:
  - `KAFKA_DLQ_ENABLED`: Enable/disable the Dead Letter Queue feature
  - `KAFKA_DLQ_TOPIC_SUFFIX`: Suffix to append to original topic name for DLQ topics
  - `KAFKA_DLQ_MAX_RETRIES`: Maximum number of retries before sending to DLQ

## Troubleshooting

### Common Issues

1. **Connection Refused**: Ensure Kafka is running with `docker compose -f docker-compose.kafka.yml ps`
2. **Topic Not Found**: Topics are auto-created by default, or create manually using Kafka UI
3. **Consumer Group Issues**: Check consumer group status in Kafka UI under "Consumers"
4. **DLQ Topics Missing**: DLQ topics are created automatically when the first message is sent to them

### Cleanup

```bash
# Stop and remove Kafka services
docker compose -f docker-compose.kafka.yml down

# Remove volumes (clears all Kafka data)
docker compose -f docker-compose.kafka.yml down -v
```

## Production Considerations

- Configure SSL/TLS and SASL authentication for production environments
- Set appropriate retention policies for topics
- Monitor consumer lag and processing metrics
- Ensure DLQ topics have appropriate retention policies (longer than source topics)
- Set up alerts for:
  - Messages in DLQ topics
  - High retry rates
  - Consumer failures
- Implement a process for reviewing and potentially reprocessing DLQ messages
