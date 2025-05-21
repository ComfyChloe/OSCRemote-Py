const OSCRelayClient = require('./client');

async function runOSCTests() {
    const client = new OSCRelayClient('ws://localhost:9002');

    // Test message handler
    client.onMessage(message => {
        console.log('[Test Client] Received OSC Message:', {
            timestamp: new Date().toISOString(),
            ...message
        });
    });

    console.log('[Test Client] Starting connection...');
    await client.connect();

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
}

// Run tests
runOSCTests().catch(console.error);
