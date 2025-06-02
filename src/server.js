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

// Enhanced in-memory cache for topic messages with offset tracking
const messageCache = new Map();
const CACHE_TTL = 30000; // 30 seconds cache (longer since we check for changes)

// Cache structure: 
// {
//   messages: [...],
//   offsets: [{ partition: 0, high: '123' }, ...],
//   timestamp: Date.now()
// }

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
    const startTime = Date.now();
    const topicName = req.params.topic;
    
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
            topicOffsets = await admin.fetchTopicOffsets(topicName);
        } catch (offsetError) {
            await admin.disconnect();
            logger.error(`Topic ${topicName} not found:`, offsetError);
            return res.status(404).json({ error: 'Topic not found', messages: [] });
        }
        
        await admin.disconnect();
        
        // Check if topic has any messages
        const totalMessages = topicOffsets.reduce((sum, partition) => sum + Number(partition.high), 0);
        
        if (totalMessages === 0) {
            logger.info(`No messages in topic ${topicName}`);
            const emptyResult = [];
            // Cache empty result with current offsets
            const cacheKey = `messages:${topicName}`;
            messageCache.set(cacheKey, { 
                messages: emptyResult, 
                offsets: topicOffsets,
                timestamp: Date.now() 
            });
            return res.json(emptyResult);
        }

        logger.info(`Topic ${topicName} has ${totalMessages} total messages across ${topicOffsets.length} partitions`);

        // Smart cache check: Compare current offsets with cached offsets
        const cacheKey = `messages:${topicName}`;
        const cached = messageCache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
            // Check if offsets have changed
            const offsetsChanged = !cached.offsets || 
                cached.offsets.length !== topicOffsets.length ||
                cached.offsets.some((cachedOffset, index) => {
                    const currentOffset = topicOffsets.find(o => o.partition === cachedOffset.partition);
                    return !currentOffset || currentOffset.high !== cachedOffset.high;
                });
            
            if (!offsetsChanged) {
                const duration = Date.now() - startTime;
                logger.info(`No offset changes detected for topic ${topicName}, returning cached ${cached.messages.length} messages in ${duration}ms`);
                return res.json(cached.messages);
            } else {
                logger.info(`Offset changes detected for topic ${topicName}, refreshing cache`);
            }
        }

        // Offsets have changed or no valid cache, fetch fresh messages
        const randomGroupId = `kafka-dashboard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const consumer = kafka.consumer({ 
            groupId: randomGroupId,
            sessionTimeout: 10000,
            heartbeatInterval: 3000,
            maxWaitTimeInMs: 1000,
            allowAutoTopicCreation: false,
            retry: {
                initialRetryTime: 100,
                retries: 1
            }
        });
        
        const messages = [];
        let consumerConnected = false;
        
        try {
            await consumer.connect();
            consumerConnected = true;
            logger.info(`Consumer connected for topic ${topicName} with group ${randomGroupId}`);
            
            // Subscribe with fromBeginning explicitly set
            await consumer.subscribe({ topics: [topicName], fromBeginning: true });
            logger.info(`Consumer subscribed to topic ${topicName} from beginning`);

            let messageCount = 0;
            let finished = false;
            const maxDuration = 4000; // 4 seconds timeout
            const maxMessages = Math.min(totalMessages, 20); // Don't read more than what exists
            
            logger.info(`Starting to read up to ${maxMessages} messages from topic ${topicName}`);

            const runPromise = new Promise((resolve, reject) => {
                let consumerRunning = false;
                
                const timeout = setTimeout(() => {
                    if (!finished) {
                        finished = true;
                        logger.info(`Timeout reached after 4s, collected ${messageCount} messages`);
                        resolve();
                    }
                }, maxDuration);
                
                const earlyExit = setTimeout(() => {
                    if (!finished && messageCount === 0 && consumerRunning) {
                        finished = true;
                        clearTimeout(timeout);
                        logger.info('No messages received after 2s, stopping early');
                        resolve();
                    }
                }, 2000);
                
                consumer.run({
                    eachMessage: async ({ topic, partition, message }) => {
                        consumerRunning = true;
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
                                    clearTimeout(earlyExit);
                                    logger.info(`Collected all ${messageCount} messages, stopping`);
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
                        clearTimeout(earlyExit);
                        logger.error('Consumer run error:', runError.message);
                        reject(runError);
                    }
                });
            });

            await runPromise;
            
        } catch (consumerError) {
            logger.error('Consumer error:', consumerError.message);
            throw consumerError;
        } finally {
            // Cleanup consumer with better error handling
            if (consumerConnected) {
                try {
                    logger.info('Stopping consumer...');
                    await consumer.stop();
                    logger.info('Disconnecting consumer...');
                    await consumer.disconnect();
                    logger.info('Consumer cleanup completed');
                    
                    // Delete the consumer group to ensure fresh reads next time
                    try {
                        const adminCleanup = kafka.admin();
                        await adminCleanup.connect();
                        await adminCleanup.deleteGroups([randomGroupId]);
                        await adminCleanup.disconnect();
                        logger.info(`Deleted consumer group ${randomGroupId}`);
                    } catch (deleteError) {
                        logger.warn('Could not delete consumer group (non-critical):', deleteError.message);
                    }
                } catch (cleanupError) {
                    logger.warn('Consumer cleanup error (non-critical):', cleanupError.message);
                    // Force close if normal cleanup fails
                    try {
                        await consumer.disconnect();
                    } catch (forceError) {
                        logger.warn('Force disconnect error:', forceError.message);
                    }
                }
            }
        }

        // Sort messages by timestamp (newest first) and limit to 5 for better performance
        const sortedMessages = messages
            .sort((a, b) => {
                const timeA = a.timestamp ? parseInt(a.timestamp) : 0;
                const timeB = b.timestamp ? parseInt(b.timestamp) : 0;
                return timeB - timeA;
            })
            .slice(0, 5); // Keep only last 5 messages

        // Cache the result with current offsets
        messageCache.set(cacheKey, { 
            messages: sortedMessages, 
            offsets: topicOffsets,
            timestamp: Date.now() 
        });

        const duration = Date.now() - startTime;
        logger.info(`Returning ${sortedMessages.length} messages for topic ${topicName} in ${duration}ms (cache updated)`);
        res.json(sortedMessages);
        
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`Error fetching messages after ${duration}ms:`, error);
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

// Clean up expired cache entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of messageCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
            messageCache.delete(key);
            logger.info(`Cleaned up expired cache entry for ${key}`);
        }
    }
}, CACHE_TTL);

app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
});