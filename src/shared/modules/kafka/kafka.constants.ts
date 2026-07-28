/**
 * Default Kafka timing values in milliseconds.
 *
 * The client-side request deadline intentionally exceeds broker and Fetch
 * waits, while the consumer session allows a heartbeat request to time out
 * before the broker evicts the consumer from its group.
 */
export const KAFKA_TIMING_DEFAULTS = {
  connectionTimeout: 10000,
  requestTimeout: 30000,
  brokerTimeout: 5000,
  sessionTimeout: 60000,
  heartbeatInterval: 3000,
  maxWaitTime: 5000,
} as const;
