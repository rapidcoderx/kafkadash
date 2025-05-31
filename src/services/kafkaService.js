const { Kafka } = require('kafkajs');
const logger = require('../utils/logger');

class KafkaService {
  constructor() {
    this.kafka = new Kafka({
      clientId: 'kafka-dashboard',
      brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092']
    });
    this.admin = this.kafka.admin();
  }

  async connect() {
    try {
      await this.admin.connect();
      logger.info('Connected to Kafka');
    } catch (error) {
      logger.error('Failed to connect to Kafka:', error);
      throw error;
    }
  }

  async getTopics() {
    try {
      const topics = await this.admin.listTopics();
      const topicDetails = await Promise.all(
        topics.map(async (topic) => {
          const offsets = await this.admin.fetchTopicOffsets(topic);
          const totalMessages = offsets.reduce((sum, offset) => sum + Number(offset.high), 0);
          return {
            name: topic,
            depth: totalMessages,
            partitions: offsets.length
          };
        })
      );
      return topicDetails;
    } catch (error) {
      logger.error('Failed to fetch topics:', error);
      throw error;
    }
  }

  async getTopicMessages(topic, limit = 3) {
    try {
      const consumer = this.kafka.consumer({ groupId: 'kafka-dashboard-group' });
      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: true });
      
      const messages = [];
      await new Promise((resolve) => {
        consumer.run({
          eachMessage: async ({ message }) => {
            if (messages.length < limit) {
              messages.push({
                key: message.key ? message.key.toString() : null,
                value: message.value ? message.value.toString() : null,
                timestamp: message.timestamp
              });
            }
            if (messages.length === limit) {
              resolve();
            }
          }
        });
      });
      
      await consumer.disconnect();
      return messages;
    } catch (error) {
      logger.error(`Failed to fetch messages for topic ${topic}:`, error);
      throw error;
    }
  }

  async getConsumers(topic) {
    try {
      const groups = await this.admin.listGroups();
      const consumerGroups = await Promise.all(
        groups.map(async (group) => {
          const groupDetails = await this.admin.describeGroups([group.groupId]);
          return {
            groupId: group.groupId,
            members: groupDetails[0].members
          };
        })
      );
      return consumerGroups;
    } catch (error) {
      logger.error('Failed to fetch consumer groups:', error);
      throw error;
    }
  }
}

module.exports = new KafkaService(); 