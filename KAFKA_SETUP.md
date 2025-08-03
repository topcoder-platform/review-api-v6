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

## Troubleshooting

### Common Issues

1. **Connection Refused**: Ensure Kafka is running with `docker compose -f docker-compose.kafka.yml ps`
2. **Topic Not Found**: Topics are auto-created by default, or create manually using Kafka UI
3. **Consumer Group Issues**: Check consumer group status in Kafka UI under "Consumers"

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
- Configure dead letter queues for failed messages
- Set up proper alerting for consumer failures