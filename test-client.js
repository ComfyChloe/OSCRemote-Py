const OSCRelayClient = require('./client');
const net = require('net');

async function runOSCTests() {
    const client = new OSCRelayClient('ws://localhost:9002');

    try {
        // Test message handler
        client.onMessage(message => {
            console.log('[Test Client] Received OSC Message:', {
                timestamp: new Date().toISOString(),
                ...message
            });
        });

        console.log('[Test Client] Starting connection...');
        await client.connect();

        // Only run tests if connected successfully
        if (client.connected) {
            // Standard VRChat parameter test cases
            const testCases = [
                { path: '/avatar/parameters/VRCFaceBlendH', value: 0.5 },
                { path: '/avatar/parameters/VRCEmote', value: 1 },
                { path: '/avatar/parameters/VRCFaceBlendV', value: 0.7 },
                { path: '/avatar/parameters/IsLocal', value: true },
            ];

            console.log('[Test Client] Running test cases...');
            testCases.forEach(({ path, value }) => {
                client.send(path, value);
                console.log(`[Test Client] Sent test message to ${path}:`, value);
            });
        } else {
            console.error('[Test Client] Not connected - skipping tests');
        }
    } catch (error) {
        console.error('[Test Client] Test failed:', error.message);
        process.exit(1);
    }
}

// Ensure server is running before starting tests
const testConnection = net.connect({ port: 9002 }, () => {
    testConnection.end();
    runOSCTests().catch(console.error);
});

testConnection.on('error', () => {
    console.error('[Test Client] Error: OSC Relay server is not running on port 9002');
    process.exit(1);
});
