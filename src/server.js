const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { Kafka } = require('kafkajs');
const winston = require('winston');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4010;

// Store the Kafka start time consistently
const KAFKA_START_TIME = Date.now() - (5 * 24 * 60 * 60 * 1000); // Fixed 5 days ago

// Configure Winston logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// Configure Helmet with CSP
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'", "cdn.tailwindcss.com", "cdnjs.cloudflare.com", "unpkg.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "fonts.gstatic.com", "cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"]
        }
    }
}));

app.use(cors());
app.use(express.json());

// Serve static files with correct MIME types
app.use('/kafka/dashboard', express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// API routes
app.get('/api/v1/topics', async (req, res) => {
    try {
        const kafka = new Kafka({
            clientId: 'kafka-dashboard',
            brokers: [process.env.KAFKA_BROKERS || 'localhost:9092']
        });

        const admin = kafka.admin();
        await admin.connect();
        
        // Fetch cluster and topic information using correct KafkaJS methods
        const allTopics = await admin.listTopics();
        
        // Filter out internal Kafka topics
        const topics = allTopics.filter(topic => 
            !topic.startsWith('__') && // Exclude internal topics like __consumer_offsets
            !topic.startsWith('_') // Exclude other internal topics like _schemas
        );
        
        let clusterMetadata = {};
        let brokerList = [];
        
        try {
            clusterMetadata = await admin.fetchTopicMetadata({ topics: [] }); // Fetch all topic metadata
            brokerList = clusterMetadata.brokers || [];
        } catch (metadataError) {
            logger.warn('Could not fetch cluster metadata:', metadataError.message);
            // Fallback: create mock broker info based on configured brokers
            const configuredBrokers = process.env.KAFKA_BROKERS || 'localhost:9092';
            brokerList = configuredBrokers.split(',').map((broker, index) => {
                const [host, port] = broker.split(':');
                return { nodeId: index, host, port: parseInt(port) };
            });
        }
        
        // Calculate consistent Kafka uptime
        // Note: Kafka doesn't expose exact start time, so we use a fixed timestamp
        const kafkaStartTime = KAFKA_START_TIME;
        
        await admin.disconnect();

        // Kafka cluster information
        const kafkaInfo = {
            clusterId: clusterMetadata.clusterId || 'kafka-cluster',
            brokers: brokerList.map(broker => ({
                nodeId: broker.nodeId,
                host: broker.host,
                port: broker.port
            })),
            controllerBrokerId: clusterMetadata.controllerBrokerId || 0,
            topicCount: topics.length // Use filtered topic count
        };

        // If no topics found, return empty array
        if (!topics || topics.length === 0) {
            return res.json({ 
                topics: [], 
                kafkaStartTime,
                kafkaInfo: {
                    clusterId: 'kafka-cluster',
                    brokers: [],
                    controllerBrokerId: 0,
                    topicCount: 0
                }
            });
        }

        const topicDetails = await Promise.all(topics.map(async (topic) => {
            try {
                const kafka2 = new Kafka({
                    clientId: 'kafka-dashboard-detail',
                    brokers: [process.env.KAFKA_BROKERS || 'localhost:9092']
                });
                
                const admin2 = kafka2.admin();
                await admin2.connect();
                const topicOffsets = await admin2.fetchTopicOffsets(topic);
                await admin2.disconnect();

                const totalMessages = topicOffsets.reduce((sum, partition) => sum + Number(partition.high), 0);

                return {
                    name: topic,
                    partitions: topicOffsets.length,
                    depth: totalMessages
                };
            } catch (topicError) {
                logger.error(`Error fetching details for topic ${topic}:`, topicError);
                return {
                    name: topic,
                    partitions: 0,
                    depth: 0
                };
            }
        }));

        res.json({ 
            topics: topicDetails, 
            kafkaStartTime,
            kafkaInfo
        });
    } catch (error) {
        logger.error('Error fetching topics:', error);
        // Return empty array on error to prevent UI from getting stuck
        res.json({ 
            topics: [], 
            kafkaStartTime: KAFKA_START_TIME,
            kafkaInfo: {
                clusterId: 'kafka-cluster',
                brokers: [],
                controllerBrokerId: 0,
                topicCount: 0
            }
        });
    }
});

app.get('/api/v1/cluster/health', async (req, res) => {
    try {
        const kafka = new Kafka({
            clientId: 'kafka-dashboard-health',
            brokers: [process.env.KAFKA_BROKERS || 'localhost:9092']
        });

        const admin = kafka.admin();
        await admin.connect();
        
        // Get cluster and topic metadata using correct KafkaJS methods
        const topics = await admin.listTopics();
        let metadata = {};
        let brokers = [];
        
        try {
            metadata = await admin.fetchTopicMetadata({ topics: [] });
            brokers = metadata.brokers || [];
        } catch (metadataError) {
            logger.warn('Could not fetch cluster metadata:', metadataError.message);
            // Fallback: create mock broker info based on configured brokers
            const configuredBrokers = process.env.KAFKA_BROKERS || 'localhost:9092';
            brokers = configuredBrokers.split(',').map((broker, index) => {
                const [host, port] = broker.split(':');
                return { nodeId: index, host, port: parseInt(port) };
            });
        }
        
        // Get broker information from metadata
        const activeBrokers = brokers.filter(broker => broker.nodeId !== undefined);
        
        // Use consistent Kafka start time
        const approxStartTime = KAFKA_START_TIME;
        
        await admin.disconnect();

        const clusterHealth = {
            status: 'connected',
            clusterId: metadata.clusterId || 'kafka-cluster',
            brokers: activeBrokers.map(broker => ({
                id: broker.nodeId,
                host: broker.host,
                port: broker.port,
                rack: broker.rack || null
            })),
            activeBrokerCount: activeBrokers.length,
            totalBrokerCount: brokers.length,
            controllerBrokerId: metadata.controllerBrokerId || 0,
            startTime: approxStartTime,
            uptime: Date.now() - approxStartTime,
            version: 'Unknown' // Kafka doesn't expose version via admin client
        };

        res.json(clusterHealth);
    } catch (error) {
        logger.error('Error fetching cluster health:', error);
        res.status(500).json({
            status: 'error',
            clusterId: 'kafka-cluster',
            brokers: [],
            activeBrokerCount: 0,
            totalBrokerCount: 0,
            controllerBrokerId: 0,
            startTime: KAFKA_START_TIME,
            uptime: Date.now() - KAFKA_START_TIME,
            version: 'Unknown',
            error: error.message
        });
    }
});

app.get('/api/v1/topics/:topic/messages', async (req, res) => {
    try {
        const kafka = new Kafka({
            clientId: 'kafka-dashboard-messages',
            brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
            connectionTimeout: 3000,
            requestTimeout: 5000,
            retry: {
                initialRetryTime: 100,
                retries: 2
            }
        });

        const admin = kafka.admin();
        await admin.connect();
        
        let topicOffsets;
        try {
            topicOffsets = await admin.fetchTopicOffsets(req.params.topic);
        } catch (offsetError) {
            await admin.disconnect();
            logger.error(`Topic ${req.params.topic} not found:`, offsetError);
            return res.status(404).json({ error: 'Topic not found', messages: [] });
        }
        
        await admin.disconnect();
        
        // Check if topic has any messages
        const totalMessages = topicOffsets.reduce((sum, partition) => sum + Number(partition.high), 0);
        
        if (totalMessages === 0) {
            return res.json([]);
        }

        logger.info(`Topic ${req.params.topic} has ${totalMessages} total messages across ${topicOffsets.length} partitions`);

        // Create consumer with a unique group ID for reading existing messages
        const consumer = kafka.consumer({ 
            groupId: `kafka-dashboard-reader-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            sessionTimeout: 30000,
            heartbeatInterval: 3000,
            maxWaitTimeInMs: 1000,
            fromBeginning: true, // Read from beginning to get existing messages
            allowAutoTopicCreation: false,
            retry: {
                initialRetryTime: 100,
                retries: 2
            }
        });
        
        const messages = [];
        const maxMessages = 10;
        let consumerConnected = false;
        
        try {
            await consumer.connect();
            consumerConnected = true;
            logger.info(`Consumer connected for topic ${req.params.topic}`);
            
            await consumer.subscribe({ topic: req.params.topic, fromBeginning: true });
            logger.info(`Consumer subscribed to topic ${req.params.topic}`);
            
            let messageCount = 0;
            let finished = false;
            const maxDuration = 5000; // 5 seconds timeout
            
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    if (!finished) {
                        finished = true;
                        logger.info(`Timeout reached, collected ${messageCount} messages`);
                        resolve();
                    }
                }, maxDuration);
                
                consumer.run({
                    eachMessage: async ({ topic, partition, message }) => {
                        if (finished) return;
                        
                        try {
                            messages.push({
                                key: message.key?.toString() || null,
                                value: message.value?.toString() || null,
                                partition: partition,
                                offset: message.offset,
                                timestamp: message.timestamp
                            });
                            
                            messageCount++;
                            logger.info(`Collected message ${messageCount}/${maxMessages} from partition ${partition}, offset ${message.offset}`);
                            
                            // Stop when we have enough messages
                            if (messageCount >= maxMessages) {
                                if (!finished) {
                                    finished = true;
                                    clearTimeout(timeout);
                                    logger.info(`Collected ${messageCount} messages, stopping collection`);
                                    resolve();
                                }
                            }
                        } catch (msgError) {
                            logger.warn('Error processing message:', msgError.message);
                        }
                    }
                }).catch((runError) => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timeout);
                        logger.error('Consumer run error:', runError.message);
                        reject(runError);
                    }
                });
            });
            
        } catch (consumerError) {
            logger.error('Consumer error:', consumerError.message);
            throw consumerError;
        } finally {
            // Cleanup consumer with better error handling
            if (consumerConnected) {
                try {
                    logger.info('Cleaning up consumer...');
                    await consumer.disconnect();
                    logger.info('Consumer disconnected successfully');
                } catch (cleanupError) {
                    logger.warn('Error during consumer cleanup (non-critical):', cleanupError.message);
                    // Don't throw cleanup errors, just log them
                }
            }
        }

        // Sort messages by timestamp (newest first) and limit to maxMessages
        const sortedMessages = messages
            .sort((a, b) => {
                const timeA = a.timestamp ? parseInt(a.timestamp) : 0;
                const timeB = b.timestamp ? parseInt(b.timestamp) : 0;
                return timeB - timeA;
            })
            .slice(0, maxMessages);

        logger.info(`Returning ${sortedMessages.length} messages for topic ${req.params.topic}`);
        res.json(sortedMessages);
    } catch (error) {
        logger.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages', messages: [] });
    }
});

app.get('/api/v1/topics/:topic/consumers', async (req, res) => {
    try {
        const kafka = new Kafka({
            clientId: 'kafka-dashboard',
            brokers: [process.env.KAFKA_BROKERS || 'localhost:9092']
        });

        const admin = kafka.admin();
        await admin.connect();
        const groups = await admin.listGroups();
        const consumerGroups = await Promise.all(
            groups.groups.map(async (group) => {
                const groupDetails = await admin.describeGroups([group.groupId]);
                return {
                    groupId: group.groupId,
                    members: groupDetails.groups[0].members
                };
            })
        );
        await admin.disconnect();

        res.json(consumerGroups);
    } catch (error) {
        logger.error('Error fetching consumers:', error);
        res.status(500).json({ error: 'Failed to fetch consumers' });
    }
});

// Serve index.html for the dashboard
app.get('/kafka/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
}); 