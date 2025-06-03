const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { Kafka } = require('kafkajs');
const winston = require('winston');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4010;

// Configuration from environment
const UI_PREFIX = process.env.UI_PREFIX || '/kafka';
const API_PREFIX = process.env.API_PREFIX || '/api/v1';

// Store the dashboard application start time (used as approximation for Kafka uptime)
const APP_START_TIME = Date.now();

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

// Swagger configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Kafka Dashboard API',
            version: '1.0.0',
            description: 'REST API for Kafka cluster monitoring and management',
            contact: {
                name: 'Kafka Dashboard',
                email: 'support@kafkadashboard.dev'
            }
        },
        servers: [
            {
                url: `${API_PREFIX}`,
                description: 'API server (relative to current domain)'
            }
        ],
        tags: [
            {
                name: 'Topics',
                description: 'Topic management operations'
            },
            {
                name: 'Cluster',
                description: 'Cluster health and information'
            },
            {
                name: 'Messages',
                description: 'Message operations'
            },
            {
                name: 'Consumers',
                description: 'Consumer group operations'
            }
        ]
    },
    apis: ['./src/server.js'], // Path to the API docs
};

const specs = swaggerJsdoc(swaggerOptions);
app.use(`${UI_PREFIX}/api-docs`, swaggerUi.serve, swaggerUi.setup(specs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Kafka Dashboard API Documentation'
}));

// Serve static files with correct MIME types
app.use(`${UI_PREFIX}/dashboard`, express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// API routes

/**
 * @swagger
 * components:
 *   schemas:
 *     Topic:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: The topic name
 *           example: "user-events"
 *         partitions:
 *           type: integer
 *           description: Number of partitions
 *           example: 3
 *         depth:
 *           type: integer
 *           description: Total number of messages in the topic
 *           example: 1500
 *     
 *     CreateTopicRequest:
 *       type: object
 *       required:
 *         - topicName
 *       properties:
 *         topicName:
 *           type: string
 *           pattern: '^[a-zA-Z0-9._-]+$'
 *           description: Name of the topic (letters, numbers, dots, underscores, hyphens only)
 *           example: "user-events"
 *         numPartitions:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 1
 *           description: Number of partitions
 *           example: 3
 *         replicationFactor:
 *           type: integer
 *           minimum: 1
 *           maximum: 10
 *           default: 1
 *           description: Replication factor
 *           example: 1
 *     
 *     KafkaInfo:
 *       type: object
 *       properties:
 *         clusterId:
 *           type: string
 *           example: "kafka-cluster"
 *         brokers:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               nodeId:
 *                 type: integer
 *               host:
 *                 type: string
 *               port:
 *                 type: integer
 *         controllerBrokerId:
 *           type: integer
 *         topicCount:
 *           type: integer
 *     
 *     Message:
 *       type: object
 *       properties:
 *         key:
 *           type: string
 *           nullable: true
 *           description: Message key
 *         value:
 *           type: string
 *           nullable: true
 *           description: Message value
 *         partition:
 *           type: integer
 *           description: Partition number
 *         offset:
 *           type: string
 *           description: Message offset
 *         timestamp:
 *           type: string
 *           description: Message timestamp
 *     
 *     ProduceMessageRequest:
 *       type: object
 *       properties:
 *         key:
 *           type: string
 *           nullable: true
 *           description: Message key
 *           example: "user-123"
 *         value:
 *           type: string
 *           description: Message value
 *           example: "{\"userId\": 123, \"action\": \"login\"}"
 *         headers:
 *           type: object
 *           additionalProperties:
 *             type: string
 *           description: Message headers
 *           example: {"source": "web-app", "version": "1.0"}
 *     
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Error message
 *         message:
 *           type: string
 *           description: Detailed error description
 */

/**
 * @swagger
 * /topics:
 *   get:
 *     summary: List all Kafka topics
 *     description: Retrieves all non-internal Kafka topics with their metadata including partitions and message counts
 *     tags: [Topics]
 *     responses:
 *       200:
 *         description: Successful response with topics list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 topics:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Topic'
 *                 kafkaStartTime:
 *                   type: integer
 *                   description: Kafka cluster start timestamp
 *                 kafkaInfo:
 *                   $ref: '#/components/schemas/KafkaInfo'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get(`${API_PREFIX}/topics`, async (req, res) => {
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
        
        // Calculate uptime based on application start time
        // Note: Kafka doesn't expose exact start time, so we use dashboard start time
        const kafkaStartTime = APP_START_TIME;
        
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
            kafkaStartTime: APP_START_TIME,
            kafkaInfo: {
                clusterId: 'kafka-cluster',
                brokers: [],
                controllerBrokerId: 0,
                topicCount: 0
            }
        });
    }
});

/**
 * @swagger
 * /topics:
 *   post:
 *     summary: Create a new Kafka topic
 *     description: Creates a new Kafka topic with specified partitions and replication factor
 *     tags: [Topics]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTopicRequest'
 *     responses:
 *       201:
 *         description: Topic created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Topic 'user-events' created successfully"
 *                 topic:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     partitions:
 *                       type: integer
 *                     replicationFactor:
 *                       type: integer
 *                 timestamp:
 *                   type: integer
 *       400:
 *         description: Invalid request parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Topic already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Create a new topic
app.post(`${API_PREFIX}/topics`, async (req, res) => {
    const startTime = Date.now();
    const { topicName, numPartitions = 1, replicationFactor = 1 } = req.body;
    
    try {
        // Validate required fields
        if (!topicName || typeof topicName !== 'string') {
            return res.status(400).json({ 
                error: 'Topic name is required and must be a string' 
            });
        }
        
        // Validate topic name format
        if (!/^[a-zA-Z0-9._-]+$/.test(topicName)) {
            return res.status(400).json({ 
                error: 'Topic name can only contain letters, numbers, dots, underscores, and hyphens' 
            });
        }
        
        // Validate partition count
        if (!Number.isInteger(numPartitions) || numPartitions < 1 || numPartitions > 100) {
            return res.status(400).json({ 
                error: 'Number of partitions must be an integer between 1 and 100' 
            });
        }
        
        // Validate replication factor
        if (!Number.isInteger(replicationFactor) || replicationFactor < 1 || replicationFactor > 10) {
            return res.status(400).json({ 
                error: 'Replication factor must be an integer between 1 and 10' 
            });
        }
        
        const kafka = new Kafka({
            clientId: 'kafka-dashboard-admin',
            brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
            connectionTimeout: 5000,
            requestTimeout: 10000,
            retry: {
                initialRetryTime: 100,
                retries: 3
            }
        });

        const admin = kafka.admin();
        await admin.connect();
        
        // Check if topic already exists
        const existingTopics = await admin.listTopics();
        if (existingTopics.includes(topicName)) {
            await admin.disconnect();
            return res.status(409).json({ 
                error: 'Topic already exists',
                message: `Topic '${topicName}' already exists` 
            });
        }
        
        // Create the topic
        await admin.createTopics({
            topics: [{
                topic: topicName,
                numPartitions: numPartitions,
                replicationFactor: replicationFactor,
                configEntries: [
                    // Add some sensible defaults for development
                    { name: 'cleanup.policy', value: 'delete' },
                    { name: 'retention.ms', value: '604800000' }, // 7 days
                    { name: 'segment.ms', value: '86400000' } // 1 day
                ]
            }]
        });
        
        await admin.disconnect();
        
        const duration = Date.now() - startTime;
        logger.info(`Topic '${topicName}' created successfully in ${duration}ms`, {
            topicName,
            numPartitions,
            replicationFactor,
            duration
        });
        
        res.status(201).json({
            success: true,
            message: `Topic '${topicName}' created successfully`,
            topic: {
                name: topicName,
                partitions: numPartitions,
                replicationFactor: replicationFactor
            },
            timestamp: Date.now()
        });
        
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`Error creating topic '${topicName}' after ${duration}ms:`, error);
        
        // Handle specific Kafka errors
        if (error.type === 'TOPIC_ALREADY_EXISTS') {
            res.status(409).json({ 
                error: 'Topic already exists',
                message: `Topic '${topicName}' already exists` 
            });
        } else if (error.type === 'INVALID_TOPIC_EXCEPTION') {
            res.status(400).json({ 
                error: 'Invalid topic name',
                message: error.message 
            });
        } else if (error.type === 'INVALID_REPLICATION_FACTOR') {
            res.status(400).json({ 
                error: 'Invalid replication factor',
                message: 'Replication factor cannot exceed the number of available brokers' 
            });
        } else {
            res.status(500).json({ 
                error: 'Failed to create topic',
                message: error.message 
            });
        }
    }
});

/**
 * @swagger
 * /cluster/health:
 *   get:
 *     summary: Get Kafka cluster health status
 *     description: Retrieves comprehensive health information about the Kafka cluster including brokers, uptime, and metadata
 *     tags: [Cluster]
 *     responses:
 *       200:
 *         description: Cluster health information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [connected, error]
 *                   example: "connected"
 *                 clusterId:
 *                   type: string
 *                   example: "kafka-cluster"
 *                 brokers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       host:
 *                         type: string
 *                       port:
 *                         type: integer
 *                       rack:
 *                         type: string
 *                         nullable: true
 *                 activeBrokerCount:
 *                   type: integer
 *                 totalBrokerCount:
 *                   type: integer
 *                 controllerBrokerId:
 *                   type: integer
 *                 startTime:
 *                   type: integer
 *                   description: Cluster start timestamp
 *                 uptime:
 *                   type: integer
 *                   description: Cluster uptime in milliseconds
 *                 version:
 *                   type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "error"
 *                 error:
 *                   type: string
 */
app.get(`${API_PREFIX}/cluster/health`, async (req, res) => {
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
            logger.info('Fetched metadata brokers:', JSON.stringify(brokers, null, 2));
            logger.info('Metadata structure:', JSON.stringify({ 
                hasClusterId: !!metadata.clusterId,
                hasControllerBrokerId: !!metadata.controllerBrokerId,
                brokersCount: brokers.length,
                firstBroker: brokers[0] ? JSON.stringify(brokers[0]) : 'none'
            }));
        } catch (metadataError) {
            logger.warn('Could not fetch cluster metadata:', metadataError.message);
            // Fallback: create mock broker info based on configured brokers
            const configuredBrokers = process.env.KAFKA_BROKERS || 'localhost:9092';
            brokers = configuredBrokers.split(',').map((broker, index) => {
                const [host, port] = broker.split(':');
                return { nodeId: index, host, port: parseInt(port) };
            });
            logger.info('Using fallback brokers:', JSON.stringify(brokers, null, 2));
        }
        
        // Get broker information from metadata
        const activeBrokers = brokers.filter(broker => broker.nodeId !== undefined);
        logger.info('Active brokers after filtering:', JSON.stringify(activeBrokers, null, 2));
        logger.info('Active broker count:', activeBrokers.length);
        
        // Use application start time as approximation for Kafka uptime
        const approxStartTime = APP_START_TIME;
        
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
            startTime: APP_START_TIME,
            uptime: Date.now() - APP_START_TIME,
            version: 'Unknown',
            error: error.message
        });
    }
});

/**
 * @swagger
 * /topics/{topic}/messages:
 *   get:
 *     summary: Get messages from a specific topic
 *     description: Retrieves the latest messages from a Kafka topic. Returns up to 5 most recent messages with intelligent caching.
 *     tags: [Messages]
 *     parameters:
 *       - in: path
 *         name: topic
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the Kafka topic
 *         example: "user-events"
 *     responses:
 *       200:
 *         description: List of messages from the topic
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Message'
 *       404:
 *         description: Topic not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Topic not found"
 *                 messages:
 *                   type: array
 *                   items: {}
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 messages:
 *                   type: array
 *                   items: {}
 */
app.get(`${API_PREFIX}/topics/:topic/messages`, async (req, res) => {
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

/**
 * @swagger
 * /topics/{topic}/consumers:
 *   get:
 *     summary: Get consumer groups for a topic
 *     description: Retrieves all consumer groups and their members that are consuming from the specified topic
 *     tags: [Consumers]
 *     parameters:
 *       - in: path
 *         name: topic
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the Kafka topic
 *         example: "user-events"
 *     responses:
 *       200:
 *         description: List of consumer groups
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   groupId:
 *                     type: string
 *                     description: Consumer group ID
 *                     example: "user-service-consumers"
 *                   members:
 *                     type: array
 *                     items:
 *                       type: object
 *                     description: List of consumer group members
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get(`${API_PREFIX}/topics/:topic/consumers`, async (req, res) => {
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

/**
 * @swagger
 * /api/v1/topics/{topic}/produce:
 *   post:
 *     summary: Produce a message to a topic
 *     description: Sends a message to the specified Kafka topic with optional key and headers
 *     tags: [Messages]
 *     parameters:
 *       - in: path
 *         name: topic
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the Kafka topic
 *         example: "user-events"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProduceMessageRequest'
 *     responses:
 *       200:
 *         description: Message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 topic:
 *                   type: string
 *                   example: "user-events"
 *                 partition:
 *                   type: integer
 *                   example: 0
 *                 offset:
 *                   type: string
 *                   example: "42"
 *                 timestamp:
 *                   type: integer
 *       404:
 *         description: Topic not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/v1/topics/:topic/produce', async (req, res) => {
    const startTime = Date.now();
    const topicName = req.params.topic;
    const { key, value, headers } = req.body;
    
    try {
        const kafka = new Kafka({
            clientId: 'kafka-dashboard-producer',
            brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
            connectionTimeout: 3000,
            requestTimeout: 5000,
            retry: {
                initialRetryTime: 100,
                retries: 2
            }
        });

        const producer = kafka.producer();
        await producer.connect();
        
        // Prepare the message
        const message = {
            key: key || null,
            value: value || '',
            headers: {}
        };
        
        // Parse headers if provided
        if (headers && typeof headers === 'object') {
            Object.keys(headers).forEach(headerKey => {
                if (headers[headerKey] !== '' && headers[headerKey] !== null && headers[headerKey] !== undefined) {
                    message.headers[headerKey] = String(headers[headerKey]);
                }
            });
        }
        
        // Send the message
        const result = await producer.send({
            topic: topicName,
            messages: [message]
        });
        
        await producer.disconnect();
        
        const duration = Date.now() - startTime;
        logger.info(`Message sent to topic ${topicName} in ${duration}ms`, {
            topic: topicName,
            partition: result[0].partition,
            offset: result[0].baseOffset,
            duration
        });
        
        res.json({
            success: true,
            topic: topicName,
            partition: result[0].partition,
            offset: result[0].baseOffset,
            timestamp: Date.now()
        });
        
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`Error producing message to topic ${topicName} after ${duration}ms:`, error);
        
        if (error.type === 'UNKNOWN_TOPIC_OR_PARTITION') {
            res.status(404).json({ 
                error: 'Topic not found',
                message: `Topic '${topicName}' does not exist` 
            });
        } else {
            res.status(500).json({ 
                error: 'Failed to produce message',
                message: error.message 
            });
        }
    }
});

// Serve index.html for the dashboard
app.get(`${UI_PREFIX}/dashboard`, (req, res) => {
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
    const baseUrl = `http://localhost:${port}`;
    logger.info(`🚀 Kafka Dashboard Server started successfully!`);
    logger.info(`📊 Dashboard UI: ${baseUrl}${UI_PREFIX}/dashboard`);
    logger.info(`🔌 API Endpoints: ${baseUrl}${API_PREFIX}`);
    logger.info(`📚 API Documentation: ${baseUrl}${UI_PREFIX}/api-docs`);
    logger.info(`⚡ Server running on port ${port}`);
});