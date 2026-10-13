// MQTT over secure WebSockets. All players must share at least one reachable broker.
// Public demonstration brokers: do not send private information or permanent credentials.
export const mqttBrokers=[
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081',
];
