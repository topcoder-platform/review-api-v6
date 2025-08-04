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
   export class MyCustomHandler extends BaseEventHandler implements OnModuleInit {
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

2. Register the handler in the KafkaModule providers array
3. The handler will automatically be registered and start consuming messages

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

### Environment Variables

All Kafka-related environment variables are documented in `.env.sample`:

- `KAFKA_BROKERS`: Comma-separated list of Kafka brokers
- `KAFKA_CLIENT_ID`: Unique client identifier
- `KAFKA_GROUP_ID`: Consumer group ID
- `KAFKA_SSL_ENABLED`: Enable SSL encryption
- Connection timeouts and retry configurations
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