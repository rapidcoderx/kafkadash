#!/usr/bin/env node

const http = require('http');

// Start the server process
const { spawn } = require('child_process');
const server = spawn('node', ['src/server.js'], {
    cwd: __dirname,
    stdio: 'inherit'
});

// Wait a bit for the server to start
setTimeout(() => {
    console.log('\n--- Testing Messages Endpoint ---');
    
    // Test the messages endpoint
    const options = {
        hostname: 'localhost',
        port: 4010,
        path: '/api/v1/topics/test-topic/messages',
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const req = http.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log(`Status: ${res.statusCode}`);
            console.log('Response:', data);
            server.kill();
            process.exit(0);
        });
    });

    req.on('error', (err) => {
        console.error('Request error:', err.message);
        server.kill();
        process.exit(1);
    });

    req.end();
}, 3000);

// Handle cleanup
process.on('SIGINT', () => {
    server.kill();
    process.exit(0);
});
