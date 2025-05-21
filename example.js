const OSCRelayClient = require('./client');

const client = new OSCRelayClient('ws://localhost:8080');

// Add optional message filters
client.addFilter('^/avatar/.*');

// Handle incoming messages
client.onMessage(message => {
    console.log('Received:', message);
});

// Connect to relay
client.connect();

// Send test message
setTimeout(() => {
    client.send('/avatar/parameter/VRCFaceBlendH', 0.5);
}, 1000);
